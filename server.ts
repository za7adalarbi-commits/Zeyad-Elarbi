/**
 * ============================================================================
 * YUOP Streetwear — الخادم الرئيسي (Express + SQLite + Vite)
 * يجمع بين واجهات المتجر العامة، لوحة التحكم المحمية بنظام الصلاحيات (RBAC)،
 * نقطة استقبال WhatsApp Cloud API Webhook، وخدمة ملفات الإيصالات المحمية.
 * ============================================================================
 */
import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  castStaffRole,
  createDatabase,
  hashPassword,
  mapLandingPageRow,
  mapProductRow,
  mapPromoCodeRow,
  mapSocialLinkRow,
  mapStoreSettingsRow,
  mapTemplateRow,
  parseStaffPermissions,
  verifyPassword,
} from './src/server/db.ts';
import { OrderService, type StaffActor } from './src/server/services/orderService.ts';
import { createWhatsAppTransport, getWhatsAppConfigStatus } from './src/server/services/whatsappService.ts';
import { hasPermission, normalizeLandingSlug, verifyMetaWebhookSignature } from './src/shared/orderRules.ts';
import {
  ORDER_STATUSES,
  PERMISSIONS,
  ROLE_PERMISSIONS_MAP,
  STAFF_ROLES,
  type OrderStatus,
  type Permission,
  type StaffRole,
} from './src/shared/types.ts';

const PORT = Number(process.env.PORT || 3000);
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || './uploads/receipts');
const DB_PATH = process.env.DATABASE_PATH || './data/yuop.db';

const db = createDatabase(DB_PATH, UPLOADS_DIR);
const waTransport = createWhatsAppTransport();
const orderService = new OrderService(db, waTransport, UPLOADS_DIR);

const app = express();

// نلتقط النص الخام (rawBody) لطلبات Webhook للتحقق من توقيع Meta SHA-256 بدقة
app.use(
  express.json({
    limit: '12mb',
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// دالة مساعدة لاستخراج الكوكيز بدون مكتبات إضافية
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      result[k] = v;
    }
  }
  return result;
}

interface AuthedRequest extends Request {
  staff?: StaffActor & { email: string };
  rawBody?: Buffer;
}

// استخراج جلسة الموظف المصرح له من الهيدر أو الكوكي
function resolveStaffFromRequest(req: AuthedRequest): (StaffActor & { email: string }) | null {
  const authHeader = req.headers.authorization;
  const cookies = parseCookies(req.headers.cookie);
  const token =
    (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null) ||
    cookies['yuop_staff_token'];

  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.custom_permissions, u.is_active, s.expires_at
       FROM staff_sessions s
       JOIN staff_users u ON u.id = s.staff_id
       WHERE s.token = ?`
    )
    .get(token) as Record<string, unknown> | undefined;

  if (!row || !row.is_active) return null;
  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    db.prepare('DELETE FROM staff_sessions WHERE token = ?').run(token);
    return null;
  }

  return {
    id: Number(row.id),
    name: String(row.name),
    email: String(row.email),
    role: castStaffRole(row.role),
    custom_permissions: parseStaffPermissions(row.custom_permissions),
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const staff = resolveStaffFromRequest(req);
  if (!staff) {
    return res.status(401).json({ error: 'غير مصرح. يرجى تسجيل الدخول بحساب موظف معتمد.' });
  }
  req.staff = staff;
  next();
}

function requirePermission(permission: Permission) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.staff) {
      return res.status(401).json({ error: 'غير مصرح.' });
    }
    if (!hasPermission(req.staff.role, permission, req.staff.custom_permissions)) {
      return res.status(403).json({ error: `ليس لديك الصلاحية المطلوبة (${permission}).` });
    }
    next();
  };
}

function handleError(res: Response, err: unknown) {
  const msg = err instanceof Error ? err.message : 'حدث خطأ غير متوقع في الخادم.';
  if (msg.startsWith('FORBIDDEN:')) {
    return res.status(403).json({ error: msg.replace('FORBIDDEN:', '').trim() });
  }
  if (msg.startsWith('NOT_FOUND:')) {
    return res.status(404).json({ error: msg.replace('NOT_FOUND:', '').trim() });
  }
  if (msg.startsWith('VALIDATION:') || msg.startsWith('INVALID:')) {
    return res.status(400).json({ error: msg.replace(/^(VALIDATION|INVALID):/, '').trim() });
  }
  console.error('[YUOP API Error]:', err);
  return res.status(500).json({ error: msg });
}

// ============================================================================
// 1. واجهات المتجر العامة للعملاء (Storefront Public API)
// ============================================================================

app.get('/api/store/config', (_req, res) => {
  const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
  const productRows = db
    .prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY is_featured DESC, id ASC')
    .all() as Array<Record<string, unknown>>;
  const socialRows = db
    .prepare('SELECT * FROM social_links WHERE is_active = 1 ORDER BY sort_order ASC, id ASC')
    .all() as Array<Record<string, unknown>>;
  const landingRows = db
    .prepare('SELECT * FROM landing_pages WHERE is_published = 1 ORDER BY id DESC')
    .all() as Array<Record<string, unknown>>;

  res.json({
    settings: mapStoreSettingsRow(settingsRow),
    products: productRows.map(mapProductRow),
    social_links: socialRows.map(mapSocialLinkRow),
    landing_pages: landingRows.map(mapLandingPageRow),
  });
});

app.get('/api/store/landing-pages/:slug', (req, res) => {
  const slug = normalizeLandingSlug(String(req.params.slug || ''));
  const row = db
    .prepare('SELECT * FROM landing_pages WHERE slug = ? AND is_published = 1')
    .get(slug) as Record<string, unknown> | undefined;
  if (!row) {
    return res.status(404).json({ error: 'صفحة الهبوط غير موجودة أو غير منشورة.' });
  }
  db.prepare('UPDATE landing_pages SET views_count = views_count + 1 WHERE id = ?').run(Number(row.id));
  const updated = db.prepare('SELECT * FROM landing_pages WHERE id = ?').get(Number(row.id)) as Record<string, unknown>;
  res.json({ landing_page: mapLandingPageRow(updated) });
});

app.post('/api/store/validate-promo', (req, res) => {
  try {
    const code = String(req.body?.code || '');
    const subtotal = Number(req.body?.subtotal || 0);
    const result = orderService.validatePromoCode(code, subtotal);
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/store/orders', async (req, res) => {
  try {
    const result = await orderService.createOrder(req.body);
    res.status(result.deduplicated ? 200 : 201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/store/orders/track', (req, res) => {
  const orderNumber = String(req.query.orderNumber || '');
  const token = String(req.query.token || '');
  const phone = String(req.query.phone || '');

  if (!orderNumber) {
    return res.status(400).json({ error: 'يرجى إدخال رقم الطلب.' });
  }

  let order = null;
  if (token) {
    const candidate = orderService.getOrderByTracking(orderNumber, token);
    if (candidate && candidate.tracking_token === token) {
      order = candidate;
    }
  } else if (phone) {
    order = orderService.getOrderByNumberAndPhone(orderNumber, phone);
  }

  if (!order) {
    return res.status(404).json({ error: 'لم يتم العثور على الطلب. تأكد من رقم الطلب ورقم الهاتف.' });
  }

  // إخفاء سجلات المراجعة الداخلية عن العميل في صفحة التتبع
  res.json({
    order: {
      ...order,
      audit_logs: [],
      whatsapp_messages: order.whatsapp_messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        status: m.status,
        created_at: m.created_at,
      })),
    },
  });
});

app.post('/api/store/orders/:orderNumber/receipt', (req, res) => {
  try {
    const orderNumber = String(req.params.orderNumber || '');
    const token = String(req.body?.tracking_token || '');
    const phone = String(req.body?.phone || '');
    const base64Data = String(req.body?.image_base64 || '');

    const candidate = token
      ? orderService.getOrderByTracking(orderNumber, token)
      : phone
        ? orderService.getOrderByNumberAndPhone(orderNumber, phone)
        : null;

    if (!candidate || (token && candidate.tracking_token !== token)) {
      return res.status(403).json({ error: 'غير مصرح برفع إيصال لهذا الطلب.' });
    }

    const result = orderService.attachPaymentReceipt({
      orderId: candidate.id,
      base64Data,
      source: 'web',
      actorName: candidate.customer_name,
    });

    res.status(201).json({ receipt: result.receipt, order: result.order });
  } catch (err) {
    handleError(res, err);
  }
});

// تقديم صور الإيصالات بشكل محمي (للموظفين المصرح لهم أو للعميل صاحب tracking_token فقط)
app.get('/api/receipts/:filename', (req: AuthedRequest, res) => {
  const safeName = path.basename(String(req.params.filename || ''));
  const token = String(req.query.token || '');
  const staff = resolveStaffFromRequest(req);

  let allowed = Boolean(staff && hasPermission(staff.role, 'view_orders', staff.custom_permissions));
  if (!allowed && token) {
    const match = db
      .prepare('SELECT id FROM orders WHERE tracking_token = ?')
      .get(token);
    if (match) allowed = true;
  }

  if (!allowed) {
    return res.status(403).json({ error: 'غير مصرح بالوصول إلى صورة الإيصال.' });
  }

  const fullPath = path.join(UPLOADS_DIR, safeName);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'صورة الإيصال غير موجودة.' });
  }

  res.sendFile(fullPath);
});

// ============================================================================
// 2. نقطة استقبال Meta WhatsApp Cloud API Webhook الرسمية (القسم الثاني عشر)
// ============================================================================

app.get('/api/webhooks/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const verifyToken = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === 'subscribe' && expectedToken && verifyToken === expectedToken) {
    return res.status(200).send(String(challenge || ''));
  }
  return res.status(403).json({ error: 'Webhook verification failed' });
});

app.post('/api/webhooks/whatsapp', async (req: AuthedRequest, res) => {
  const appSecret = process.env.WHATSAPP_APP_SECRET || '';
  const sigHeader = req.headers['x-hub-signature-256'] as string | undefined;

  if (!appSecret) {
    return res.status(503).json({
      error: 'WHATSAPP_APP_SECRET غير مضبوط في الخادم. لا يمكن قبول أحداث Webhook بدون التحقق من التوقيع.',
    });
  }

  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  if (!verifyMetaWebhookSignature(rawBody, sigHeader, appSecret)) {
    return res.status(401).json({ error: 'توقيع Webhook غير صالح (Invalid X-Hub-Signature-256).' });
  }

  try {
    const result = await orderService.processWhatsAppWebhook(req.body || {});
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[Webhook Processing Error]:', err);
    res.status(500).json({ error: 'Webhook processing error' });
  }
});

// ============================================================================
// 3. تسجيل دخول الموظفين وإدارة الجلسات (Admin Auth)
// ============================================================================

app.post('/api/admin/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور.' });
  }

  const user = db
    .prepare('SELECT * FROM staff_users WHERE LOWER(email) = ? AND is_active = 1')
    .get(email) as Record<string, unknown> | undefined;

  if (!user || !verifyPassword(password, String(user.password_hash))) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  db.prepare(
    'INSERT INTO staff_sessions (token, staff_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(token, Number(user.id), expires.toISOString(), now.toISOString());

  res.setHeader(
    'Set-Cookie',
    `yuop_staff_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
  );

  const role = castStaffRole(user.role);
  const customPerms = parseStaffPermissions(user.custom_permissions);
  const effectivePermissions =
    role === 'Super Admin'
      ? [...PERMISSIONS]
      : customPerms && customPerms.length > 0
        ? customPerms
        : ROLE_PERMISSIONS_MAP[role] || [];

  res.json({
    token,
    user: {
      id: Number(user.id),
      name: String(user.name),
      email: String(user.email),
      role,
      custom_permissions: customPerms,
      effective_permissions: effectivePermissions,
    },
  });
});

app.post('/api/admin/auth/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['yuop_staff_token'];
  if (token) {
    db.prepare('DELETE FROM staff_sessions WHERE token = ?').run(token);
  }
  res.setHeader('Set-Cookie', 'yuop_staff_token=; Path=/; HttpOnly; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/auth/me', (req: AuthedRequest, res) => {
  const staff = resolveStaffFromRequest(req);
  if (!staff) {
    return res.json({ user: null });
  }
  const effectivePermissions =
    staff.role === 'Super Admin'
      ? [...PERMISSIONS]
      : staff.custom_permissions && staff.custom_permissions.length > 0
        ? staff.custom_permissions
        : ROLE_PERMISSIONS_MAP[staff.role] || [];

  res.json({
    user: {
      ...staff,
      effective_permissions: effectivePermissions,
    },
  });
});

// ============================================================================
// 4. مسارات لوحة التحكم المحمية (Protected Admin APIs)
// ============================================================================

app.get('/api/admin/dashboard', requireAuth, requirePermission('view_dashboard'), (_req, res) => {
  const stats = orderService.getDashboardStats();
  const lowStockAlerts = orderService.getLowStockAlerts(3);
  const recentLogs = db
    .prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 15')
    .all();
  res.json({ stats, recent_logs: recentLogs, low_stock_alerts: lowStockAlerts });
});

app.get('/api/admin/orders', requireAuth, requirePermission('view_orders'), (req, res) => {
  const orders = orderService.listOrders({
    search: req.query.search ? String(req.query.search) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    payment_method: req.query.payment_method ? String(req.query.payment_method) : undefined,
    payment_status: req.query.payment_status ? String(req.query.payment_status) : undefined,
    shipping_company: req.query.shipping_company ? String(req.query.shipping_company) : undefined,
    date_from: req.query.date_from ? String(req.query.date_from) : undefined,
    date_to: req.query.date_to ? String(req.query.date_to) : undefined,
  });
  res.json({ orders });
});

app.get('/api/admin/orders/:id', requireAuth, requirePermission('view_orders'), (req, res) => {
  const order = orderService.getOrderById(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود.' });
  res.json({ order });
});

app.post('/api/admin/orders/:id/payment/confirm', requireAuth, requirePermission('review_payments'), async (req: AuthedRequest, res) => {
  try {
    const order = await orderService.confirmPayment(Number(req.params.id), req.staff!);
    res.json({ order });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/admin/orders/:id/payment/reject', requireAuth, requirePermission('review_payments'), async (req: AuthedRequest, res) => {
  try {
    const reason = String(req.body?.reason || '');
    const order = await orderService.rejectPayment(Number(req.params.id), reason, req.staff!);
    res.json({ order });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/admin/orders/:id/payment/collect-cod', requireAuth, requirePermission('collect_cod'), (req: AuthedRequest, res) => {
  try {
    const order = orderService.collectCodPayment(Number(req.params.id), req.staff!);
    res.json({ order });
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/admin/orders/:id/status', requireAuth, requirePermission('manage_orders_status'), async (req: AuthedRequest, res) => {
  try {
    const newStatus = String(req.body?.status || '') as OrderStatus;
    if (!ORDER_STATUSES.includes(newStatus)) {
      return res.status(400).json({ error: 'حالة الطلب غير صالحة.' });
    }
    const result = await orderService.updateOrderStatus({
      orderId: Number(req.params.id),
      newStatus,
      actor: req.staff!,
      notes: req.body?.notes ? String(req.body.notes) : undefined,
      cancellationReason: req.body?.cancellation_reason ? String(req.body.cancellation_reason) : undefined,
      deliveryFailureReason: req.body?.delivery_failure_reason ? String(req.body.delivery_failure_reason) : undefined,
    });
    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/admin/orders/:id/shipping', requireAuth, requirePermission('manage_shipping'), async (req: AuthedRequest, res) => {
  try {
    const order = await orderService.updateShippingDetails({
      orderId: Number(req.params.id),
      actor: req.staff!,
      shipping_company: req.body?.shipping_company ?? null,
      courier_name: req.body?.courier_name ?? null,
      courier_phone: req.body?.courier_phone ?? null,
      tracking_number: req.body?.tracking_number ?? null,
      tracking_url: req.body?.tracking_url ?? null,
      shipped_at: req.body?.shipped_at ?? null,
      expected_delivery_at: req.body?.expected_delivery_at ?? null,
      delivery_notes: req.body?.delivery_notes ?? null,
      delivery_failure_reason: req.body?.delivery_failure_reason ?? null,
      sendWhatsAppUpdate: Boolean(req.body?.send_whatsapp),
    });
    res.json({ order });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/admin/orders/:id/whatsapp/send-tracking', requireAuth, requirePermission('send_whatsapp'), async (req: AuthedRequest, res) => {
  try {
    const msg = await orderService.dispatchTemplateMessage({
      orderId: Number(req.params.id),
      templateKey: 'order_shipped',
      actorName: req.staff!.name,
      actorRole: req.staff!.role,
      forceSend: true,
    });
    const order = orderService.getOrderById(Number(req.params.id));
    res.json({ message: msg, order });
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/admin/whatsapp/messages/:messageId/retry', requireAuth, requirePermission('send_whatsapp'), async (req: AuthedRequest, res) => {
  try {
    const message = await orderService.retryWhatsAppMessage(Number(req.params.messageId), req.staff!);
    res.json({ message });
  } catch (err) {
    handleError(res, err);
  }
});

// إدارة المنتجات وتخصيص المتجر
app.get('/api/admin/products', requireAuth, requirePermission('view_dashboard'), (_req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY id DESC').all() as Array<Record<string, unknown>>;
  res.json({ products: rows.map(mapProductRow) });
});

app.post('/api/admin/products', requireAuth, requirePermission('manage_products'), (req: AuthedRequest, res) => {
  try {
    const b = req.body || {};
    if (!b.name_ar || !b.name_en || !b.price || !b.category) {
      return res.status(400).json({ error: 'يرجى إدخال اسم المنتج والفئة والسعر.' });
    }
    const now = new Date().toISOString();
    const slug = `${String(b.name_en).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;
    const info = db
      .prepare(
        `INSERT INTO products (
          slug, name_ar, name_en, category, price, compare_at_price,
          description_ar, description_en, fabric_details,
          image_url, secondary_image_url, sizes_stock,
          is_featured, is_active, badge_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        slug,
        String(b.name_ar),
        String(b.name_en),
        String(b.category),
        Number(b.price),
        b.compare_at_price ? Number(b.compare_at_price) : null,
        String(b.description_ar || ''),
        String(b.description_en || ''),
        String(b.fabric_details || '100% قطن ثقيل'),
        String(b.image_url || '/src/assets/images/product_hoodie_obsidian_1794549969578.jpg'),
        b.secondary_image_url ? String(b.secondary_image_url) : null,
        JSON.stringify(b.sizes_stock || { S: 10, M: 10, L: 10, XL: 10 }),
        b.is_featured ? 1 : 0,
        b.is_active !== false ? 1 : 0,
        b.badge_text ? String(b.badge_text) : null,
        now
      );

    db.prepare(
      'INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
    ).run(req.staff!.name, req.staff!.role, 'إضافة منتج', `تم إضافة منتج: ${String(b.name_ar)}`, now);

    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(info.lastInsertRowid)) as Record<string, unknown>;
    res.status(201).json({ product: mapProductRow(row) });
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/admin/products/:id', requireAuth, requirePermission('manage_products'), (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'المنتج غير موجود.' });
    const b = req.body || {};

    db.prepare(
      `UPDATE products SET
        name_ar = ?, name_en = ?, category = ?, price = ?, compare_at_price = ?,
        description_ar = ?, description_en = ?, fabric_details = ?,
        image_url = ?, sizes_stock = ?, is_featured = ?, is_active = ?, badge_text = ?
       WHERE id = ?`
    ).run(
      String(b.name_ar ?? existing.name_ar),
      String(b.name_en ?? existing.name_en),
      String(b.category ?? existing.category),
      b.price !== undefined ? Number(b.price) : Number(existing.price),
      b.compare_at_price !== undefined ? (b.compare_at_price ? Number(b.compare_at_price) : null) : (existing.compare_at_price !== null ? Number(existing.compare_at_price) : null),
      String(b.description_ar ?? existing.description_ar),
      String(b.description_en ?? existing.description_en),
      String(b.fabric_details ?? existing.fabric_details),
      String(b.image_url ?? existing.image_url),
      b.sizes_stock ? JSON.stringify(b.sizes_stock) : String(existing.sizes_stock),
      b.is_featured !== undefined ? (b.is_featured ? 1 : 0) : Number(existing.is_featured),
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : Number(existing.is_active),
      b.badge_text !== undefined ? (b.badge_text ? String(b.badge_text) : null) : (existing.badge_text ? String(existing.badge_text) : null),
      id
    );

    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ product: mapProductRow(row) });
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/admin/products/:id', requireAuth, requirePermission('manage_products'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  db.prepare(
    'INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
  ).run(req.staff!.name, req.staff!.role, 'حذف منتج', `تم حذف المنتج رقم #${id}`, new Date().toISOString());
  res.json({ ok: true });
});

app.get('/api/admin/store-settings', requireAuth, requirePermission('view_dashboard'), (_req, res) => {
  const row = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
  res.json({ settings: mapStoreSettingsRow(row) });
});

app.patch('/api/admin/store-settings', requireAuth, requirePermission('manage_store_settings'), (req: AuthedRequest, res) => {
  const existing = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
  const b = req.body || {};
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE store_settings SET
      store_name = ?, tagline_ar = ?, tagline_en = ?, announcement_enabled = ?,
      announcement_text_ar = ?, announcement_text_en = ?,
      hero_kicker_ar = ?, hero_kicker_en = ?, hero_title_ar = ?, hero_title_en = ?,
      hero_subtitle_ar = ?, hero_subtitle_en = ?, hero_cta_ar = ?, hero_cta_en = ?,
      hero_image_url = ?, accent_color = ?, default_theme = ?, shipping_fee = ?, free_shipping_threshold = ?,
      support_whatsapp = ?, support_email = ?,
      vodafone_cash_number = ?, vodafone_cash_instructions_ar = ?,
      instapay_address = ?, instapay_instructions_ar = ?,
      cod_enabled = ?, vodafone_enabled = ?, instapay_enabled = ?,
      footer_about_ar = ?, footer_about_en = ?, updated_at = ?
    WHERE id = 1
  `).run(
    String(b.store_name ?? existing.store_name),
    String(b.tagline_ar ?? existing.tagline_ar),
    String(b.tagline_en ?? existing.tagline_en),
    b.announcement_enabled !== undefined ? (b.announcement_enabled ? 1 : 0) : Number(existing.announcement_enabled),
    String(b.announcement_text_ar ?? existing.announcement_text_ar),
    String(b.announcement_text_en ?? existing.announcement_text_en),
    String(b.hero_kicker_ar ?? existing.hero_kicker_ar),
    String(b.hero_kicker_en ?? existing.hero_kicker_en),
    String(b.hero_title_ar ?? existing.hero_title_ar),
    String(b.hero_title_en ?? existing.hero_title_en),
    String(b.hero_subtitle_ar ?? existing.hero_subtitle_ar),
    String(b.hero_subtitle_en ?? existing.hero_subtitle_en),
    String(b.hero_cta_ar ?? existing.hero_cta_ar),
    String(b.hero_cta_en ?? existing.hero_cta_en),
    String(b.hero_image_url ?? existing.hero_image_url),
    String(b.accent_color ?? existing.accent_color),
    b.default_theme === 'dark' || b.default_theme === 'light' ? b.default_theme : String(existing.default_theme || 'light'),
    b.shipping_fee !== undefined ? Number(b.shipping_fee) : Number(existing.shipping_fee),
    b.free_shipping_threshold !== undefined ? Number(b.free_shipping_threshold) : Number(existing.free_shipping_threshold),
    String(b.support_whatsapp ?? existing.support_whatsapp),
    String(b.support_email ?? existing.support_email),
    String(b.vodafone_cash_number ?? existing.vodafone_cash_number),
    String(b.vodafone_cash_instructions_ar ?? existing.vodafone_cash_instructions_ar),
    String(b.instapay_address ?? existing.instapay_address),
    String(b.instapay_instructions_ar ?? existing.instapay_instructions_ar),
    b.cod_enabled !== undefined ? (b.cod_enabled ? 1 : 0) : Number(existing.cod_enabled),
    b.vodafone_enabled !== undefined ? (b.vodafone_enabled ? 1 : 0) : Number(existing.vodafone_enabled),
    b.instapay_enabled !== undefined ? (b.instapay_enabled ? 1 : 0) : Number(existing.instapay_enabled),
    String(b.footer_about_ar ?? existing.footer_about_ar),
    String(b.footer_about_en ?? existing.footer_about_en),
    now
  );

  db.prepare(
    'INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
  ).run(req.staff!.name, req.staff!.role, 'تخصيص المتجر', 'تم تحديث إعدادات ومظهر متجر YUOP', now);

  const updated = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
  res.json({ settings: mapStoreSettingsRow(updated) });
});

// إدارة صفحات الهبوط التسويقية (Landing Page Builder)
app.get('/api/admin/landing-pages', requireAuth, requirePermission('manage_landing_pages'), (_req, res) => {
  const rows = db.prepare('SELECT * FROM landing_pages ORDER BY id DESC').all() as Array<Record<string, unknown>>;
  res.json({ landing_pages: rows.map(mapLandingPageRow) });
});

app.post('/api/admin/landing-pages', requireAuth, requirePermission('manage_landing_pages'), (req: AuthedRequest, res) => {
  try {
    const b = req.body || {};
    const slug = normalizeLandingSlug(String(b.slug || b.title_en || `drop-${Date.now()}`));
    if (!slug || !b.title_ar) {
      return res.status(400).json({ error: 'يرجى إدخال عنوان صفحة الهبوط والرابط المختصر (Slug).' });
    }
    const existing = db.prepare('SELECT id FROM landing_pages WHERE slug = ?').get(slug);
    if (existing) {
      return res.status(400).json({ error: 'الرابط المختصر (Slug) مستخدم لصفحة أخرى بالفعل.' });
    }
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO landing_pages (
          slug, title_ar, title_en, kicker_ar, kicker_en, subtitle_ar, subtitle_en,
          hero_image_url, cta_text_ar, cta_text_en, theme_style,
          highlights_json, featured_product_ids_json, is_published, show_in_footer, views_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        slug,
        String(b.title_ar),
        String(b.title_en || b.title_ar),
        String(b.kicker_ar || 'إصدار خاص'),
        String(b.kicker_en || 'CAMPAIGN DROP'),
        String(b.subtitle_ar || ''),
        String(b.subtitle_en || ''),
        String(b.hero_image_url || '/src/assets/images/hero_yuop_editorial_1794551310693.jpg'),
        String(b.cta_text_ar || 'تسوق الحملة الآن'),
        String(b.cta_text_en || 'Shop Campaign'),
        b.theme_style === 'light' ? 'light' : 'dark',
        JSON.stringify(Array.isArray(b.highlights) ? b.highlights : []),
        JSON.stringify(Array.isArray(b.featured_product_ids) ? b.featured_product_ids.map(Number) : []),
        b.is_published !== false ? 1 : 0,
        b.show_in_footer !== false ? 1 : 0,
        now,
        now
      );

    db.prepare(
      'INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
    ).run(req.staff!.name, req.staff!.role, 'إنشاء صفحة هبوط', `تم إنشاء صفحة الهبوط /lp/${slug}`, now);

    const row = db.prepare('SELECT * FROM landing_pages WHERE id = ?').get(Number(info.lastInsertRowid)) as Record<string, unknown>;
    res.status(201).json({ landing_page: mapLandingPageRow(row) });
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/admin/landing-pages/:id', requireAuth, requirePermission('manage_landing_pages'), (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM landing_pages WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'صفحة الهبوط غير موجودة.' });
    const b = req.body || {};
    const slug = b.slug ? normalizeLandingSlug(String(b.slug)) : String(existing.slug);
    const dup = db.prepare('SELECT id FROM landing_pages WHERE slug = ? AND id != ?').get(slug, id);
    if (dup) return res.status(400).json({ error: 'الرابط المختصر (Slug) مستخدم لصفحة أخرى.' });

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE landing_pages SET
        slug = ?, title_ar = ?, title_en = ?, kicker_ar = ?, kicker_en = ?,
        subtitle_ar = ?, subtitle_en = ?, hero_image_url = ?, cta_text_ar = ?, cta_text_en = ?,
        theme_style = ?, highlights_json = ?, featured_product_ids_json = ?,
        is_published = ?, show_in_footer = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      slug,
      String(b.title_ar ?? existing.title_ar),
      String(b.title_en ?? existing.title_en),
      String(b.kicker_ar ?? existing.kicker_ar),
      String(b.kicker_en ?? existing.kicker_en),
      String(b.subtitle_ar ?? existing.subtitle_ar),
      String(b.subtitle_en ?? existing.subtitle_en),
      String(b.hero_image_url ?? existing.hero_image_url),
      String(b.cta_text_ar ?? existing.cta_text_ar),
      String(b.cta_text_en ?? existing.cta_text_en),
      b.theme_style === 'light' || b.theme_style === 'dark' ? b.theme_style : String(existing.theme_style),
      Array.isArray(b.highlights) ? JSON.stringify(b.highlights) : String(existing.highlights_json),
      Array.isArray(b.featured_product_ids) ? JSON.stringify(b.featured_product_ids.map(Number)) : String(existing.featured_product_ids_json),
      b.is_published !== undefined ? (b.is_published ? 1 : 0) : Number(existing.is_published),
      b.show_in_footer !== undefined ? (b.show_in_footer ? 1 : 0) : Number(existing.show_in_footer),
      now,
      id
    );

    const row = db.prepare('SELECT * FROM landing_pages WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ landing_page: mapLandingPageRow(row) });
  } catch (err) {
    handleError(res, err);
  }
});

app.delete('/api/admin/landing-pages/:id', requireAuth, requirePermission('manage_landing_pages'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM landing_pages WHERE id = ?').run(id);
  db.prepare(
    'INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
  ).run(req.staff!.name, req.staff!.role, 'حذف صفحة هبوط', `تم حذف صفحة الهبوط رقم #${id}`, new Date().toISOString());
  res.json({ ok: true });
});

// إدارة روابط التواصل الاجتماعي (Social Media Manager)
app.get('/api/admin/social-links', requireAuth, requirePermission('manage_social_links'), (_req, res) => {
  const rows = db.prepare('SELECT * FROM social_links ORDER BY sort_order ASC, id ASC').all() as Array<Record<string, unknown>>;
  res.json({ social_links: rows.map(mapSocialLinkRow) });
});

app.post('/api/admin/social-links', requireAuth, requirePermission('manage_social_links'), (req: AuthedRequest, res) => {
  const b = req.body || {};
  if (!b.platform || !b.url) {
    return res.status(400).json({ error: 'يرجى تحديد المنصة ورابط الحساب.' });
  }
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO social_links (platform, label, handle, url, sort_order, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(b.platform),
      String(b.label || b.platform),
      b.handle ? String(b.handle) : null,
      String(b.url).trim(),
      Number(b.sort_order ?? 10),
      b.is_active !== false ? 1 : 0,
      now
    );

  db.prepare(
    'INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
  ).run(req.staff!.name, req.staff!.role, 'تحديث السوشيال ميديا', `إضافة رابط ${String(b.platform)}`, now);

  const row = db.prepare('SELECT * FROM social_links WHERE id = ?').get(Number(info.lastInsertRowid)) as Record<string, unknown>;
  res.status(201).json({ social_link: mapSocialLinkRow(row) });
});

app.patch('/api/admin/social-links/:id', requireAuth, requirePermission('manage_social_links'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM social_links WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'الرابط غير موجود.' });
  const b = req.body || {};
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE social_links SET platform = ?, label = ?, handle = ?, url = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?`
  ).run(
    String(b.platform ?? existing.platform),
    String(b.label ?? existing.label),
    b.handle !== undefined ? (b.handle ? String(b.handle) : null) : (existing.handle ? String(existing.handle) : null),
    String(b.url ?? existing.url),
    b.sort_order !== undefined ? Number(b.sort_order) : Number(existing.sort_order),
    b.is_active !== undefined ? (b.is_active ? 1 : 0) : Number(existing.is_active),
    now,
    id
  );

  const row = db.prepare('SELECT * FROM social_links WHERE id = ?').get(id) as Record<string, unknown>;
  res.json({ social_link: mapSocialLinkRow(row) });
});

app.delete('/api/admin/social-links/:id', requireAuth, requirePermission('manage_social_links'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM social_links WHERE id = ?').run(id);
  db.prepare(
    'INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
  ).run(req.staff!.name, req.staff!.role, 'حذف رابط سوشيال', `تم حذف رابط السوشيال رقم #${id}`, new Date().toISOString());
  res.json({ ok: true });
});

// إدارة أكواد الخصم (Promo Codes)
app.get('/api/admin/promo-codes', requireAuth, requirePermission('manage_promos'), (_req, res) => {
  const rows = db.prepare('SELECT * FROM promo_codes ORDER BY id DESC').all() as Array<Record<string, unknown>>;
  res.json({ promo_codes: rows.map(mapPromoCodeRow) });
});

app.post('/api/admin/promo-codes', requireAuth, requirePermission('manage_promos'), (req: AuthedRequest, res) => {
  try {
    const b = req.body || {};
    const code = String(b.code || '').trim().toUpperCase();
    const discountValue = Number(b.discount_value || 0);
    if (!code || discountValue <= 0) {
      return res.status(400).json({ error: 'يرجى إدخال كود خصم وقيمة خصم صالحة.' });
    }
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO promo_codes (code, discount_type, discount_value, min_order_amount, max_uses, used_count, is_active, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .run(
        code,
        b.discount_type === 'fixed' ? 'fixed' : 'percent',
        discountValue,
        Number(b.min_order_amount || 0),
        b.max_uses ? Number(b.max_uses) : null,
        b.is_active !== false ? 1 : 0,
        b.expires_at ? String(b.expires_at) : null,
        now
      );

    db.prepare(
      'INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
    ).run(req.staff!.name, req.staff!.role, 'إضافة كود خصم', `تم إنشاء كود ${code}`, now);

    const row = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(Number(info.lastInsertRowid)) as Record<string, unknown>;
    res.status(201).json({ promo_code: mapPromoCodeRow(row) });
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/admin/promo-codes/:id', requireAuth, requirePermission('manage_promos'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'كود الخصم غير موجود.' });
  const b = req.body || {};
  db.prepare('UPDATE promo_codes SET is_active = ? WHERE id = ?').run(
    b.is_active !== undefined ? (b.is_active ? 1 : 0) : Number(existing.is_active),
    id
  );
  const row = db.prepare('SELECT * FROM promo_codes WHERE id = ?').get(id) as Record<string, unknown>;
  res.json({ promo_code: mapPromoCodeRow(row) });
});

app.delete('/api/admin/promo-codes/:id', requireAuth, requirePermission('manage_promos'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM promo_codes WHERE id = ?').run(id);
  db.prepare(
    'INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
  ).run(req.staff!.name, req.staff!.role, 'حذف كود خصم', `تم حذف كود الخصم رقم #${id}`, new Date().toISOString());
  res.json({ ok: true });
});

// دليل العملاء CRM
app.get('/api/admin/customers', requireAuth, requirePermission('view_orders'), (_req, res) => {
  res.json({ customers: orderService.listCustomers() });
});

// إدارة قوالب WhatsApp وإعدادات Cloud API
app.get('/api/admin/templates', requireAuth, requirePermission('manage_whatsapp_templates'), (_req, res) => {
  const rows = db.prepare('SELECT * FROM notification_templates ORDER BY id ASC').all() as Array<Record<string, unknown>>;
  res.json({ templates: rows.map(mapTemplateRow) });
});

app.patch('/api/admin/templates/:key', requireAuth, requirePermission('manage_whatsapp_templates'), (req: AuthedRequest, res) => {
  const key = String(req.params.key);
  const existing = db.prepare('SELECT * FROM notification_templates WHERE template_key = ?').get(key) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'القالب غير موجود.' });
  const b = req.body || {};
  const now = new Date().toISOString();

  db.prepare(
    'UPDATE notification_templates SET body = ?, is_enabled = ?, meta_template_name = ?, updated_at = ? WHERE template_key = ?'
  ).run(
    b.body !== undefined ? String(b.body) : String(existing.body),
    b.is_enabled !== undefined ? (b.is_enabled ? 1 : 0) : Number(existing.is_enabled),
    b.meta_template_name !== undefined
      ? (b.meta_template_name ? String(b.meta_template_name) : null)
      : (existing.meta_template_name ? String(existing.meta_template_name) : null),
    now,
    key
  );

  db.prepare(
    'INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
  ).run(req.staff!.name, req.staff!.role, 'تعديل قالب WhatsApp', `تم تحديث قالب (${String(existing.title_ar)})`, now);

  const row = db.prepare('SELECT * FROM notification_templates WHERE template_key = ?').get(key) as Record<string, unknown>;
  res.json({ template: mapTemplateRow(row) });
});

app.get('/api/admin/whatsapp/config', requireAuth, requirePermission('manage_whatsapp_api'), (req, res) => {
  const host = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const inferredUrl = process.env.APP_URL || (host ? `${proto}://${host}` : 'http://localhost:3000');
  res.json({ config: getWhatsAppConfigStatus(inferredUrl) });
});

app.post('/api/admin/whatsapp/test', requireAuth, requirePermission('manage_whatsapp_api'), async (_req, res) => {
  const result = await waTransport.testConnection();
  res.status(result.ok ? 200 : 400).json(result);
});

app.get('/api/admin/whatsapp/messages', requireAuth, requirePermission('view_orders'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT m.*, o.order_number
       FROM whatsapp_messages m
       LEFT JOIN orders o ON o.id = m.order_id
       ORDER BY m.id DESC LIMIT 100`
    )
    .all();
  res.json({ messages: rows });
});

// سجل العمليات Audit Log
app.get('/api/admin/audit-logs', requireAuth, requirePermission('view_audit_logs'), (req, res) => {
  const limit = Math.min(200, Number(req.query.limit || 100));
  const actionFilter = req.query.action_type ? String(req.query.action_type) : '';
  const logs = actionFilter
    ? db.prepare('SELECT * FROM audit_logs WHERE action_type = ? ORDER BY id DESC LIMIT ?').all(actionFilter, limit)
    : db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
  res.json({ logs });
});

// إدارة الموظفين والصلاحيات (RBAC)
app.get('/api/admin/staff', requireAuth, requirePermission('manage_staff'), (_req, res) => {
  const rows = db
    .prepare('SELECT id, name, email, role, custom_permissions, is_active, created_at FROM staff_users ORDER BY id ASC')
    .all() as Array<Record<string, unknown>>;
  res.json({
    staff: rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      email: String(r.email),
      role: castStaffRole(r.role),
      custom_permissions: parseStaffPermissions(r.custom_permissions),
      is_active: Boolean(r.is_active),
      created_at: String(r.created_at),
    })),
    roles: STAFF_ROLES,
    permissions: PERMISSIONS,
    role_defaults: ROLE_PERMISSIONS_MAP,
  });
});

app.post('/api/admin/staff', requireAuth, requirePermission('manage_staff'), (req: AuthedRequest, res) => {
  const b = req.body || {};
  const role = String(b.role || '') as StaffRole;
  if (!b.name || !b.email || !b.password || !STAFF_ROLES.includes(role)) {
    return res.status(400).json({ error: 'يرجى إدخال الاسم والبريد وكلمة المرور والدور الوظيفي.' });
  }
  const now = new Date().toISOString();
  try {
    const info = db
      .prepare(
        `INSERT INTO staff_users (name, email, password_hash, role, custom_permissions, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        String(b.name).trim(),
        String(b.email).trim().toLowerCase(),
        hashPassword(String(b.password)),
        role,
        Array.isArray(b.custom_permissions) ? JSON.stringify(b.custom_permissions) : null,
        now
      );
    db.prepare(
      'INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
    ).run(req.staff!.name, req.staff!.role, 'إضافة موظف', `تم إضافة الموظف ${String(b.name)} بدور ${role}`, now);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (err) {
    handleError(res, err);
  }
});

app.patch('/api/admin/staff/:id', requireAuth, requirePermission('manage_staff'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM staff_users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'الموظف غير موجود.' });
  const b = req.body || {};

  db.prepare(
    'UPDATE staff_users SET role = ?, custom_permissions = ?, is_active = ? WHERE id = ?'
  ).run(
    String(b.role ?? existing.role),
    b.custom_permissions !== undefined
      ? (Array.isArray(b.custom_permissions) ? JSON.stringify(b.custom_permissions) : null)
      : (existing.custom_permissions ? String(existing.custom_permissions) : null),
    b.is_active !== undefined ? (b.is_active ? 1 : 0) : Number(existing.is_active),
    id
  );
  res.json({ ok: true });
});

// ============================================================================
// 5. إعداد Vite Middleware في التطوير أو الملفات الثابتة في الإنتاج
// ============================================================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('./dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`YUOP Store & Admin Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start YUOP server:', err);
  process.exit(1);
});

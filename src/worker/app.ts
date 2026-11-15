/**
 * ============================================================================
 * YUOP Streetwear — تطبيق Hono API الكامل (Cloudflare Workers + D1 + R2)
 * يطبق جميع نقاط النهاية للمتجر ولوحة التحكم و Meta WhatsApp Webhook
 * مع مصادقة آمنة، حماية CSRF، تحديد محاولات الدخول (Rate Limiting)، وصلاحيات RBAC.
 * ============================================================================
 */
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  ORDER_STATUSES,
  PERMISSIONS,
  ROLE_PERMISSIONS_MAP,
  SOCIAL_PLATFORMS,
  STAFF_ROLES,
  type OrderStatus,
  type PaymentMethod,
  type Permission,
  type StaffRole,
} from '../shared/types.ts';
import { hasPermission, normalizeLandingSlug } from '../shared/orderRules.ts';
import {
  constantTimeEqualStrings,
  extractVerifiedSessionToken,
  hashPasswordWeb,
  randomHex,
  signSessionToken,
  verifyMetaWebhookSignatureAsync,
  verifyPasswordWeb,
  type LegacyPasswordVerifier,
} from './crypto.ts';
import {
  castStaffRole,
  createD1DbClient,
  mapLandingPageRow,
  mapProductRow,
  mapPromoCodeRow,
  mapSocialLinkRow,
  mapStoreSettingsRow,
  mapTemplateRow,
  parseStaffPermissions,
  type DbClient,
} from './dbAdapter.ts';
import {
  createR2ReceiptStorage,
  inferContentTypeFromFileName,
  type ReceiptStorage,
} from './r2Storage.ts';
import { OrderService, type StaffActor } from './services/orderService.ts';
import { createWhatsAppTransport, getWhatsAppConfigStatus } from './services/whatsappService.ts';
import type { WorkerBindings } from './types.ts';

export interface WorkerAppDependencies {
  createDb?: (env: WorkerBindings) => DbClient;
  createStorage?: (env: WorkerBindings) => ReceiptStorage;
  legacyPasswordVerifier?: LegacyPasswordVerifier;
  customFetch?: typeof fetch;
}

interface AppVariables {
  db: DbClient;
  storage: ReceiptStorage;
  orderService: OrderService;
  staff: StaffActor | null;
  authViaCookie: boolean;
}

const SESSION_COOKIE_NAME = 'yuop_staff_session';
const MAX_LOGIN_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function mapErrorStatus(err: unknown): { status: 400 | 401 | 403 | 404 | 429 | 500; message: string } {
  const msg = err instanceof Error ? err.message : 'حدث خطأ داخلي في الخادم';
  if (msg.startsWith('VALIDATION:')) return { status: 400, message: msg.replace('VALIDATION:', '').trim() };
  if (msg.startsWith('UNAUTHORIZED:')) return { status: 401, message: msg.replace('UNAUTHORIZED:', '').trim() };
  if (msg.startsWith('FORBIDDEN:')) return { status: 403, message: msg.replace('FORBIDDEN:', '').trim() };
  if (msg.startsWith('NOT_FOUND:')) return { status: 404, message: msg.replace('NOT_FOUND:', '').trim() };
  if (msg.startsWith('INVALID:')) return { status: 400, message: msg.replace('INVALID:', '').trim() };
  return { status: 500, message: msg };
}

function effectivePermissions(actor: StaffActor): Permission[] {
  if (actor.role === 'Super Admin') return [...PERMISSIONS];
  if (actor.custom_permissions && actor.custom_permissions.length > 0) return actor.custom_permissions;
  return ROLE_PERMISSIONS_MAP[actor.role] || [];
}

function getClientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'local'
  );
}

function isHttpsRequest(c: Context): boolean {
  const proto = c.req.header('x-forwarded-proto') || '';
  if (proto.toLowerCase() === 'https') return true;
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

function setSessionCookie(c: Context, tokenValue: string) {
  const isHttps = isHttpsRequest(c);
  setCookie(c, SESSION_COOKIE_NAME, tokenValue, {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    sameSite: isHttps ? 'None' : 'Lax',
    secure: isHttps,
  });
}

function clearSessionCookie(c: Context) {
  const isHttps = isHttpsRequest(c);
  deleteCookie(c, SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: '/',
    sameSite: isHttps ? 'None' : 'Lax',
    secure: isHttps,
  });
}

async function checkAndRecordRateLimit(
  db: DbClient,
  rateKey: string
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const nowMs = Date.now();
  const row = await db.first<{ attempts: number; window_start: string; locked_until: string | null }>(
    'SELECT attempts, window_start, locked_until FROM auth_rate_limits WHERE rate_key = ?',
    rateKey
  );
  if (!row) return { allowed: true };

  if (row.locked_until) {
    const lockedMs = new Date(row.locked_until).getTime();
    if (lockedMs > nowMs) {
      return { allowed: false, retryAfterSec: Math.ceil((lockedMs - nowMs) / 1000) };
    }
    await db.run('DELETE FROM auth_rate_limits WHERE rate_key = ?', rateKey);
    return { allowed: true };
  }

  const windowStartMs = new Date(row.window_start).getTime();
  if (nowMs - windowStartMs > RATE_LIMIT_WINDOW_MS) {
    await db.run('DELETE FROM auth_rate_limits WHERE rate_key = ?', rateKey);
    return { allowed: true };
  }

  return { allowed: true };
}

async function incrementFailedAttempt(db: DbClient, rateKey: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const row = await db.first<{ attempts: number; window_start: string }>(
    'SELECT attempts, window_start FROM auth_rate_limits WHERE rate_key = ?',
    rateKey
  );
  if (!row || Date.now() - new Date(row.window_start).getTime() > RATE_LIMIT_WINDOW_MS) {
    await db.run(
      `INSERT INTO auth_rate_limits (rate_key, attempts, window_start, locked_until)
       VALUES (?, 1, ?, NULL)
       ON CONFLICT(rate_key) DO UPDATE SET attempts = 1, window_start = excluded.window_start, locked_until = NULL`,
      rateKey,
      nowIso
    );
    return;
  }

  const nextAttempts = Number(row.attempts) + 1;
  const lockedUntil =
    nextAttempts >= MAX_LOGIN_ATTEMPTS ? new Date(Date.now() + RATE_LIMIT_WINDOW_MS).toISOString() : null;
  await db.run(
    'UPDATE auth_rate_limits SET attempts = ?, locked_until = ? WHERE rate_key = ?',
    nextAttempts,
    lockedUntil,
    rateKey
  );
}

async function clearRateLimit(db: DbClient, rateKey: string): Promise<void> {
  await db.run('DELETE FROM auth_rate_limits WHERE rate_key = ?', rateKey);
}

async function resolveStaffSession(
  c: Context<{ Bindings: WorkerBindings; Variables: AppVariables }>,
  db: DbClient
): Promise<{ actor: StaffActor | null; viaCookie: boolean }> {
  const authHeader = c.req.header('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const cookieToken = getCookie(c, SESSION_COOKIE_NAME) || null;
  const presented = bearerToken || cookieToken;
  const viaCookie = !bearerToken && Boolean(cookieToken);

  if (!presented) return { actor: null, viaCookie: false };

  const rawToken = await extractVerifiedSessionToken(presented, c.env.SESSION_SECRET);
  if (!rawToken) return { actor: null, viaCookie };

  const session = await db.first<Record<string, unknown>>(
    `SELECT s.token, s.expires_at, u.id, u.name, u.role, u.custom_permissions, u.is_active
     FROM staff_sessions s
     JOIN staff_users u ON u.id = s.staff_id
     WHERE s.token = ?`,
    rawToken
  );

  if (!session) return { actor: null, viaCookie };
  if (new Date(String(session.expires_at)).getTime() < Date.now() || !session.is_active) {
    await db.run('DELETE FROM staff_sessions WHERE token = ?', rawToken);
    return { actor: null, viaCookie };
  }

  return {
    actor: {
      id: Number(session.id),
      name: String(session.name),
      role: castStaffRole(session.role),
      custom_permissions: parseStaffPermissions(session.custom_permissions),
    },
    viaCookie,
  };
}

export function createWorkerApp(deps: WorkerAppDependencies = {}) {
  const app = new Hono<{ Bindings: WorkerBindings; Variables: AppVariables }>();

  // حقن طبقة قاعدة البيانات والتخزين وخدمات الطلبات في كل طلب
  app.use('/api/*', async (c, next) => {
    const db = deps.createDb ? deps.createDb(c.env) : createD1DbClient(c.env.DB);
    const storage = deps.createStorage ? deps.createStorage(c.env) : createR2ReceiptStorage(c.env.RECEIPTS_BUCKET);
    const waTransport = createWhatsAppTransport(c.env, deps.customFetch);
    const orderService = new OrderService(db, waTransport, storage, c.env);

    c.set('db', db);
    c.set('storage', storage);
    c.set('orderService', orderService);
    c.set('staff', null);
    c.set('authViaCookie', false);

    await next();
  });

  // حماية CSRF للعمليات المعدلة عبر الكوكيز في مسارات الإدارة
  app.use('/api/admin/*', async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return await next();
    }
    const path = new URL(c.req.url).pathname;
    if (path === '/api/admin/auth/login' || path === '/api/admin/auth/setup') {
      return await next();
    }

    const db = c.get('db');
    const resolved = await resolveStaffSession(c, db);
    c.set('staff', resolved.actor);
    c.set('authViaCookie', resolved.viaCookie);

    if (resolved.viaCookie) {
      const origin = c.req.header('origin');
      const referer = c.req.header('referer');
      const reqHost = new URL(c.req.url).host;
      const checkHost = (val: string | undefined) => {
        if (!val) return true;
        try {
          return new URL(val).host === reqHost;
        } catch {
          return false;
        }
      };
      if ((origin && !checkHost(origin)) || (!origin && referer && !checkHost(referer))) {
        return c.json({ error: 'طلب غير مصرح به (فشل التحقق من مصدر الطلب CSRF).' }, 403);
      }
    }

    await next();
  });

  // --------------------------------------------------------------------------
  // فحص الصحة العام
  // --------------------------------------------------------------------------
  app.get('/api/health', async (c) => {
    try {
      const db = c.get('db');
      await db.first('SELECT 1 as ok');
      return c.json({
        ok: true,
        runtime: 'cloudflare-workers-hono',
        environment: c.env.ENVIRONMENT || 'production',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : 'DB error' }, 500);
    }
  });

  // --------------------------------------------------------------------------
  // 1. مسارات المتجر العامة (Public Storefront APIs)
  // --------------------------------------------------------------------------
  app.get('/api/store/config', async (c) => {
    const db = c.get('db');
    const settingsRow = await db.first<Record<string, unknown>>('SELECT * FROM store_settings WHERE id = 1');
    if (!settingsRow) {
      return c.json({ error: 'إعدادات المتجر غير مهيأة بعد.' }, 500);
    }
    const [productRows, socialRows, landingRows] = await Promise.all([
      db.all<Record<string, unknown>>('SELECT * FROM products WHERE is_active = 1 ORDER BY is_featured DESC, id ASC'),
      db.all<Record<string, unknown>>('SELECT * FROM social_links WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'),
      db.all<Record<string, unknown>>(
        'SELECT * FROM landing_pages WHERE is_published = 1 AND show_in_footer = 1 ORDER BY id DESC'
      ),
    ]);

    return c.json({
      settings: mapStoreSettingsRow(settingsRow),
      products: productRows.map(mapProductRow),
      social_links: socialRows.map(mapSocialLinkRow),
      landing_pages: landingRows.map(mapLandingPageRow),
    });
  });

  app.get('/api/store/landing-pages/:slug', async (c) => {
    const db = c.get('db');
    const slug = normalizeLandingSlug(c.req.param('slug') || '');
    const lpRow = await db.first<Record<string, unknown>>(
      'SELECT * FROM landing_pages WHERE slug = ? AND is_published = 1',
      slug
    );
    if (!lpRow) {
      return c.json({ error: 'صفحة الهبوط غير موجودة أو غير منشورة.' }, 404);
    }
    await db.run('UPDATE landing_pages SET views_count = views_count + 1 WHERE id = ?', Number(lpRow.id));
    const updatedRow = await db.first<Record<string, unknown>>('SELECT * FROM landing_pages WHERE id = ?', Number(lpRow.id));
    const productRows = await db.all<Record<string, unknown>>(
      'SELECT * FROM products WHERE is_active = 1 ORDER BY is_featured DESC, id ASC'
    );
    return c.json({
      landing_page: mapLandingPageRow(updatedRow || lpRow),
      products: productRows.map(mapProductRow),
    });
  });

  app.post('/api/store/validate-promo', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { code?: string; subtotal?: number };
      const orderService = c.get('orderService');
      const result = await orderService.validatePromoCode(String(body.code || ''), Number(body.subtotal || 0));
      return c.json({ valid: true, ...result });
    } catch (err) {
      const mapped = mapErrorStatus(err);
      return c.json({ valid: false, error: mapped.message }, mapped.status);
    }
  });

  app.post('/api/store/orders', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Parameters<OrderService['createOrder']>[0];
      const orderService = c.get('orderService');
      const result = await orderService.createOrder(body);
      return c.json(result, result.deduplicated ? 200 : 201);
    } catch (err) {
      const mapped = mapErrorStatus(err);
      return c.json({ error: mapped.message }, mapped.status);
    }
  });

  app.get('/api/store/orders/track', async (c) => {
    const orderNumber = String(c.req.query('orderNumber') || c.req.query('order_number') || '').trim();
    const phone = String(c.req.query('phone') || '').trim();
    const token = String(c.req.query('token') || '').trim();

    if (!orderNumber) {
      return c.json({ error: 'يرجى إدخال رقم الطلب.' }, 400);
    }

    const orderService = c.get('orderService');
    const order = token
      ? await orderService.getOrderByTracking(orderNumber, token)
      : phone
        ? await orderService.getOrderByNumberAndPhone(orderNumber, phone)
        : null;

    if (!order) {
      return c.json({ error: 'لم يتم العثور على طلب مطابق للبيانات المدخلة.' }, 404);
    }

    return c.json({
      order: {
        ...order,
        audit_logs: [],
        whatsapp_messages: [],
      },
    });
  });

  app.post('/api/store/orders/:orderNumber/receipt', async (c) => {
    try {
      const orderNumber = c.req.param('orderNumber');
      const body = (await c.req.json().catch(() => ({}))) as {
        tracking_token?: string;
        phone?: string;
        image_base64?: string;
      };

      const orderService = c.get('orderService');
      const order = body.tracking_token
        ? await orderService.getOrderByTracking(orderNumber, body.tracking_token)
        : body.phone
          ? await orderService.getOrderByNumberAndPhone(orderNumber, body.phone)
          : null;

      if (!order) {
        return c.json({ error: 'تعذر التحقق من الطلب. تأكد من رقم الطلب ورقم الهاتف.' }, 404);
      }

      const result = await orderService.attachPaymentReceipt({
        orderId: order.id,
        base64Data: body.image_base64,
        source: 'web',
        actorName: order.customer_name,
      });

      return c.json({
        receipt: result.receipt,
        order: { ...result.order, audit_logs: [], whatsapp_messages: [] },
      });
    } catch (err) {
      const mapped = mapErrorStatus(err);
      return c.json({ error: mapped.message }, mapped.status);
    }
  });

  // تقديم صور الإيصالات المخزنة في R2 للموظف المصرح له أو حامل توكن التتبع فقط
  app.get('/api/receipts/:filename', async (c) => {
    const fileName = c.req.param('filename') || '';
    if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return c.json({ error: 'اسم الملف غير صالح.' }, 400);
    }

    const db = c.get('db');
    const storage = c.get('storage');
    const token = String(c.req.query('token') || '');
    const resolved = await resolveStaffSession(c, db);
    const staff = resolved.actor;

    if (!staff) {
      if (!token) {
        return c.json({ error: 'غير مصرح بعرض الإيصال.' }, 401);
      }
      const match = await db.first<{ id: number }>(
        `SELECT pr.id FROM payment_receipts pr
         JOIN orders o ON o.id = pr.order_id
         WHERE (pr.file_path LIKE ? OR pr.file_path = ?) AND o.tracking_token = ?`,
        `%${fileName}`,
        fileName,
        token
      );
      if (!match) {
        return c.json({ error: 'غير مصرح بعرض الإيصال.' }, 403);
      }
    }

    // البحث في المسار القياسي receipt/ أو الاسم المباشر لدعم التوافق العكسي
    let obj = await storage.get(`receipts/${fileName}`);
    if (!obj) {
      obj = await storage.get(fileName);
    }
    if (!obj) {
      return c.json({ error: 'ملف الإيصال غير موجود.' }, 404);
    }

    const contentType = obj.contentType || inferContentTypeFromFileName(fileName);
    return new Response(obj.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  });

  // --------------------------------------------------------------------------
  // 2. مسارات Meta WhatsApp Cloud API Webhook الرسمية (القسم الثاني عشر)
  // --------------------------------------------------------------------------
  app.get('/api/webhooks/whatsapp', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge');
    const expected = c.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && expected && token && constantTimeEqualStrings(token, expected)) {
      return c.text(String(challenge || ''), 200);
    }
    return c.json({ error: 'Webhook verification failed' }, 403);
  });

  app.post('/api/webhooks/whatsapp', async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header('x-hub-signature-256');
    const appSecret = c.env.WHATSAPP_APP_SECRET || '';

    if (appSecret) {
      const valid = await verifyMetaWebhookSignatureAsync(rawBody, signature, appSecret);
      if (!valid) {
        return c.json({ error: 'Invalid X-Hub-Signature-256' }, 401);
      }
    } else if ((c.env.ENVIRONMENT || 'production') === 'production') {
      return c.json({ error: 'WHATSAPP_APP_SECRET is required in production' }, 503);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody || '{}') as Record<string, unknown>;
    } catch {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    try {
      const orderService = c.get('orderService');
      const result = await orderService.processWhatsAppWebhook(payload);
      return c.json({ status: 'ok', ...result }, 200);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Webhook processing failed' }, 500);
    }
  });

  // --------------------------------------------------------------------------
  // 3. تأسيس المدير الأول لمرة واحدة + مصادقة الموظفين (Auth & First-Admin Setup)
  // --------------------------------------------------------------------------
  app.get('/api/admin/auth/setup-status', async (c) => {
    const db = c.get('db');
    const row = await db.first<{ c: number }>('SELECT COUNT(*) as c FROM staff_users');
    const count = Number(row?.c || 0);
    return c.json({
      setupRequired: count === 0,
      tokenRequired: Boolean(c.env.ADMIN_SETUP_TOKEN),
    });
  });

  app.post('/api/admin/auth/setup', async (c) => {
    const db = c.get('db');
    const ip = getClientIp(c);
    const rateKey = `setup:${ip}`;
    const limitCheck = await checkAndRecordRateLimit(db, rateKey);
    if (!limitCheck.allowed) {
      return c.json(
        { error: `تم تجاوز الحد المسموح لمحاولات التأسيس. حاول بعد ${limitCheck.retryAfterSec || 60} ثانية.` },
        429
      );
    }

    const row = await db.first<{ c: number }>('SELECT COUNT(*) as c FROM staff_users');
    if (Number(row?.c || 0) > 0) {
      return c.json({ error: 'تم إعداد حساب المدير مسبقًا. استخدم شاشة تسجيل الدخول.' }, 403);
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      email?: string;
      password?: string;
      setup_token?: string;
    };

    const requiredSetupToken = c.env.ADMIN_SETUP_TOKEN;
    if (requiredSetupToken) {
      if (!body.setup_token || !constantTimeEqualStrings(body.setup_token.trim(), requiredSetupToken)) {
        await incrementFailedAttempt(db, rateKey);
        return c.json({ error: 'رمز التأسيس (ADMIN_SETUP_TOKEN) غير صحيح.' }, 403);
      }
    }

    const name = body.name?.trim() || '';
    const email = body.email?.trim().toLowerCase() || '';
    const password = body.password || '';

    if (name.length < 2 || !email.includes('@') || password.length < 8) {
      return c.json(
        { error: 'يرجى إدخال اسم صالح وبريد إلكتروني صحيح وكلمة مرور لا تقل عن 8 أحرف.' },
        400
      );
    }

    await clearRateLimit(db, rateKey);
    const now = new Date().toISOString();
    const passwordHash = await hashPasswordWeb(password);

    const insertRes = await db.run(
      `INSERT INTO staff_users (name, email, password_hash, role, custom_permissions, is_active, created_at)
       VALUES (?, ?, ?, 'Super Admin', NULL, 1, ?)`,
      name,
      email,
      passwordHash,
      now
    );
    const staffId = insertRes.meta.last_row_id;

    const rawToken = `yuop_stf_${randomHex(24)}`;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.run(
      'INSERT INTO staff_sessions (token, staff_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      rawToken,
      staffId,
      expiresAt,
      now
    );

    await db.run(
      `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
       VALUES (NULL, NULL, ?, 'Super Admin', 'تأسيس حساب المدير الأول', ?, ?)`,
      name,
      `تم إنشاء حساب المدير الأعلى الأول (${email}) عبر بوابة التأسيس الآمنة`,
      now
    );

    const signedToken = await signSessionToken(rawToken, c.env.SESSION_SECRET);
    setSessionCookie(c, signedToken);

    const actor: StaffActor = {
      id: staffId,
      name,
      role: 'Super Admin',
      custom_permissions: null,
    };

    return c.json(
      {
        token: signedToken,
        user: {
          ...actor,
          email,
          effective_permissions: effectivePermissions(actor),
        },
      },
      201
    );
  });

  app.post('/api/admin/auth/login', async (c) => {
    const db = c.get('db');
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const ip = getClientIp(c);
    const rateKey = `login:${ip}:${email || 'unknown'}`;

    const limitCheck = await checkAndRecordRateLimit(db, rateKey);
    if (!limitCheck.allowed) {
      return c.json(
        { error: `تم حظر المحاولات مؤقتًا لكثرة المحاولات الخاطئة. حاول بعد ${limitCheck.retryAfterSec || 60} ثانية.` },
        429
      );
    }

    const user = await db.first<Record<string, unknown>>(
      'SELECT * FROM staff_users WHERE LOWER(email) = ?',
      email
    );

    const passwordValid =
      user && Boolean(user.is_active)
        ? await verifyPasswordWeb(password, String(user.password_hash), deps.legacyPasswordVerifier)
        : false;

    if (!user || !user.is_active || !passwordValid) {
      await incrementFailedAttempt(db, rateKey);
      return c.json({ error: 'بيانات الدخول غير صحيحة أو الحساب غير مفعل.' }, 401);
    }

    await clearRateLimit(db, rateKey);

    // ترقية صيغة التجزئة تلقائيًا إلى PBKDF2-SHA256 إذا كانت بصيغة scrypt قديمة
    if (!String(user.password_hash).startsWith('pbkdf2_sha256$')) {
      const upgradedHash = await hashPasswordWeb(password);
      await db.run('UPDATE staff_users SET password_hash = ? WHERE id = ?', upgradedHash, Number(user.id));
    }

    const rawToken = `yuop_stf_${randomHex(24)}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.run(
      'INSERT INTO staff_sessions (token, staff_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      rawToken,
      Number(user.id),
      expiresAt,
      now
    );

    const signedToken = await signSessionToken(rawToken, c.env.SESSION_SECRET);
    setSessionCookie(c, signedToken);

    const actor: StaffActor = {
      id: Number(user.id),
      name: String(user.name),
      role: castStaffRole(user.role),
      custom_permissions: parseStaffPermissions(user.custom_permissions),
    };

    return c.json({
      token: signedToken,
      user: {
        ...actor,
        email: String(user.email),
        effective_permissions: effectivePermissions(actor),
      },
    });
  });

  app.post('/api/admin/auth/logout', async (c) => {
    const db = c.get('db');
    const authHeader = c.req.header('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const cookieToken = getCookie(c, SESSION_COOKIE_NAME) || null;
    const presented = bearerToken || cookieToken;
    if (presented) {
      const rawToken = await extractVerifiedSessionToken(presented, c.env.SESSION_SECRET);
      if (rawToken) {
        await db.run('DELETE FROM staff_sessions WHERE token = ?', rawToken);
      }
    }
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  app.get('/api/admin/auth/me', async (c) => {
    const db = c.get('db');
    const resolved = await resolveStaffSession(c, db);
    if (!resolved.actor) {
      return c.json({ user: null });
    }
    const staff = resolved.actor;
    const row = await db.first<{ email: string }>('SELECT email FROM staff_users WHERE id = ?', staff.id);
    return c.json({
      user: {
        ...staff,
        email: row?.email || '',
        effective_permissions: effectivePermissions(staff),
      },
    });
  });

  // --------------------------------------------------------------------------
  // 4. مسارات لوحة التحكم المحمية بالصلاحيات (Protected Admin RBAC APIs)
  // --------------------------------------------------------------------------
  async function requireStaff(
    c: Context<{ Bindings: WorkerBindings; Variables: AppVariables }>,
    perm?: Permission
  ): Promise<{ staff: StaffActor } | { response: Response }> {
    let staff = c.get('staff');
    if (!staff) {
      const resolved = await resolveStaffSession(c, c.get('db'));
      staff = resolved.actor;
      c.set('staff', staff);
    }
    if (!staff) {
      return { response: c.json({ error: 'غير مصرح. يرجى تسجيل الدخول بحساب موظف معتمد.' }, 401) };
    }
    if (perm && !hasPermission(staff.role, perm, staff.custom_permissions)) {
      return { response: c.json({ error: 'ليس لديك الصلاحية الكافية لتنفيذ هذا الإجراء.' }, 403) };
    }
    return { staff };
  }

  app.get('/api/admin/dashboard', async (c) => {
    const auth = await requireStaff(c, 'view_dashboard');
    if ('response' in auth) return auth.response;

    const orderService = c.get('orderService');
    const db = c.get('db');
    const [stats, recentLogs, lowStockAlerts] = await Promise.all([
      orderService.getDashboardStats(),
      db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 12'),
      orderService.getLowStockAlerts(4),
    ]);

    return c.json({
      stats,
      recent_logs: recentLogs,
      low_stock_alerts: lowStockAlerts,
    });
  });

  app.get('/api/admin/orders', async (c) => {
    const auth = await requireStaff(c, 'view_orders');
    if ('response' in auth) return auth.response;

    const orderService = c.get('orderService');
    const orders = await orderService.listOrders({
      search: c.req.query('search') || undefined,
      status: c.req.query('status') || undefined,
      payment_method: c.req.query('payment_method') || undefined,
      payment_status: c.req.query('payment_status') || undefined,
      shipping_company: c.req.query('shipping_company') || undefined,
      date_from: c.req.query('date_from') || undefined,
      date_to: c.req.query('date_to') || undefined,
    });
    return c.json({ orders });
  });

  app.get('/api/admin/orders/:id', async (c) => {
    const auth = await requireStaff(c, 'view_orders');
    if ('response' in auth) return auth.response;

    const orderId = Number(c.req.param('id'));
    const orderService = c.get('orderService');
    const order = await orderService.getOrderById(orderId);
    if (!order) return c.json({ error: 'الطلب غير موجود.' }, 404);
    return c.json({ order });
  });

  app.post('/api/admin/orders/:id/payment/confirm', async (c) => {
    const auth = await requireStaff(c, 'review_payments');
    if ('response' in auth) return auth.response;
    try {
      const orderService = c.get('orderService');
      const order = await orderService.confirmPayment(Number(c.req.param('id')), auth.staff);
      return c.json({ order });
    } catch (err) {
      const mapped = mapErrorStatus(err);
      return c.json({ error: mapped.message }, mapped.status);
    }
  });

  app.post('/api/admin/orders/:id/payment/reject', async (c) => {
    const auth = await requireStaff(c, 'review_payments');
    if ('response' in auth) return auth.response;
    try {
      const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
      const orderService = c.get('orderService');
      const order = await orderService.rejectPayment(Number(c.req.param('id')), String(body.reason || ''), auth.staff);
      return c.json({ order });
    } catch (err) {
      const mapped = mapErrorStatus(err);
      return c.json({ error: mapped.message }, mapped.status);
    }
  });

  app.post('/api/admin/orders/:id/payment/collect-cod', async (c) => {
    const auth = await requireStaff(c, 'collect_cod');
    if ('response' in auth) return auth.response;
    try {
      const orderService = c.get('orderService');
      const order = await orderService.collectCodPayment(Number(c.req.param('id')), auth.staff);
      return c.json({ order });
    } catch (err) {
      const mapped = mapErrorStatus(err);
      return c.json({ error: mapped.message }, mapped.status);
    }
  });

  app.patch('/api/admin/orders/:id/status', async (c) => {
    const auth = await requireStaff(c, 'manage_orders_status');
    if ('response' in auth) return auth.response;
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        status?: OrderStatus;
        notes?: string;
        cancellation_reason?: string;
        delivery_failure_reason?: string;
      };
      if (!body.status || !ORDER_STATUSES.includes(body.status)) {
        return c.json({ error: 'حالة الطلب المرسلة غير صالحة.' }, 400);
      }
      const orderService = c.get('orderService');
      const result = await orderService.updateOrderStatus({
        orderId: Number(c.req.param('id')),
        newStatus: body.status,
        actor: auth.staff,
        notes: body.notes,
        cancellationReason: body.cancellation_reason,
        deliveryFailureReason: body.delivery_failure_reason,
      });
      return c.json(result);
    } catch (err) {
      const mapped = mapErrorStatus(err);
      return c.json({ error: mapped.message }, mapped.status);
    }
  });

  app.patch('/api/admin/orders/:id/shipping', async (c) => {
    const auth = await requireStaff(c, 'manage_shipping');
    if ('response' in auth) return auth.response;
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const orderService = c.get('orderService');
      const order = await orderService.updateShippingDetails({
        orderId: Number(c.req.param('id')),
        actor: auth.staff,
        shipping_company: (body.shipping_company as string | null | undefined) ?? undefined,
        courier_name: (body.courier_name as string | null | undefined) ?? undefined,
        courier_phone: (body.courier_phone as string | null | undefined) ?? undefined,
        tracking_number: (body.tracking_number as string | null | undefined) ?? undefined,
        tracking_url: (body.tracking_url as string | null | undefined) ?? undefined,
        shipped_at: (body.shipped_at as string | null | undefined) ?? undefined,
        expected_delivery_at: (body.expected_delivery_at as string | null | undefined) ?? undefined,
        delivery_notes: (body.delivery_notes as string | null | undefined) ?? undefined,
        delivery_failure_reason: (body.delivery_failure_reason as string | null | undefined) ?? undefined,
        sendWhatsAppUpdate: Boolean(body.send_whatsapp),
      });
      return c.json({ order });
    } catch (err) {
      const mapped = mapErrorStatus(err);
      return c.json({ error: mapped.message }, mapped.status);
    }
  });

  app.post('/api/admin/orders/:id/whatsapp/send-tracking', async (c) => {
    const auth = await requireStaff(c, 'send_whatsapp');
    if ('response' in auth) return auth.response;
    try {
      const orderId = Number(c.req.param('id'));
      const orderService = c.get('orderService');
      const msg = await orderService.dispatchTemplateMessage({
        orderId,
        templateKey: 'order_shipped',
        actorName: auth.staff.name,
        actorRole: auth.staff.role,
        forceSend: true,
      });
      const order = await orderService.getOrderById(orderId);
      return c.json({ message: msg, order });
    } catch (err) {
      const mapped = mapErrorStatus(err);
      return c.json({ error: mapped.message }, mapped.status);
    }
  });

  app.post('/api/admin/whatsapp/messages/:messageId/retry', async (c) => {
    const auth = await requireStaff(c, 'send_whatsapp');
    if ('response' in auth) return auth.response;
    try {
      const orderService = c.get('orderService');
      const message = await orderService.retryWhatsAppMessage(Number(c.req.param('messageId')), auth.staff);
      return c.json({ message });
    } catch (err) {
      const mapped = mapErrorStatus(err);
      return c.json({ error: mapped.message }, mapped.status);
    }
  });

  // --- إدارة المنتجات ---
  app.get('/api/admin/products', async (c) => {
    const auth = await requireStaff(c, 'view_dashboard');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const rows = await db.all<Record<string, unknown>>('SELECT * FROM products ORDER BY id DESC');
    return c.json({ products: rows.map(mapProductRow) });
  });

  app.post('/api/admin/products', async (c) => {
    const auth = await requireStaff(c, 'manage_products');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!b.name_ar || !b.name_en || !b.price || !b.category) {
      return c.json({ error: 'يرجى إدخال اسم المنتج والفئة والسعر.' }, 400);
    }
    const slug = `${String(b.slug || b.name_en)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    const res = await db.run(
      `INSERT INTO products (
        slug, name_ar, name_en, category, price, compare_at_price,
        description_ar, description_en, fabric_details, image_url, secondary_image_url,
        sizes_stock, is_featured, is_active, badge_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      slug,
      String(b.name_ar),
      String(b.name_en),
      String(b.category),
      Number(b.price),
      b.compare_at_price ? Number(b.compare_at_price) : null,
      String(b.description_ar || ''),
      String(b.description_en || ''),
      String(b.fabric_details || '100% قطن مصري ثقيل'),
      String(b.image_url || '/src/assets/images/product_hoodie_obsidian_1794549969578.jpg'),
      b.secondary_image_url ? String(b.secondary_image_url) : null,
      JSON.stringify(b.sizes_stock || { S: 5, M: 10, L: 10, XL: 5 }),
      b.is_featured === false ? 0 : 1,
      b.is_active === false ? 0 : 1,
      b.badge_text ? String(b.badge_text) : null,
      now
    );

    await db.run(
      `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
       VALUES (NULL, NULL, ?, ?, 'إضافة منتج', ?, ?)`,
      auth.staff.name,
      auth.staff.role,
      `تمت إضافة المنتج (${String(b.name_ar)}) بسعر ${Number(b.price)} ج.م`,
      now
    );

    const row = await db.first<Record<string, unknown>>('SELECT * FROM products WHERE id = ?', res.meta.last_row_id);
    return c.json({ product: mapProductRow(row!) }, 201);
  });

  app.patch('/api/admin/products/:id', async (c) => {
    const auth = await requireStaff(c, 'manage_products');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const existing = await db.first<Record<string, unknown>>('SELECT * FROM products WHERE id = ?', id);
    if (!existing) return c.json({ error: 'المنتج غير موجود.' }, 404);

    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    await db.run(
      `UPDATE products SET
        name_ar = ?, name_en = ?, category = ?, price = ?, compare_at_price = ?,
        description_ar = ?, description_en = ?, fabric_details = ?, image_url = ?,
        secondary_image_url = ?, sizes_stock = ?, is_featured = ?, is_active = ?, badge_text = ?
       WHERE id = ?`,
      b.name_ar !== undefined ? String(b.name_ar) : String(existing.name_ar),
      b.name_en !== undefined ? String(b.name_en) : String(existing.name_en),
      b.category !== undefined ? String(b.category) : String(existing.category),
      b.price !== undefined ? Number(b.price) : Number(existing.price),
      b.compare_at_price !== undefined ? (b.compare_at_price ? Number(b.compare_at_price) : null) : existing.compare_at_price,
      b.description_ar !== undefined ? String(b.description_ar) : String(existing.description_ar),
      b.description_en !== undefined ? String(b.description_en) : String(existing.description_en),
      b.fabric_details !== undefined ? String(b.fabric_details) : String(existing.fabric_details),
      b.image_url !== undefined ? String(b.image_url) : String(existing.image_url),
      b.secondary_image_url !== undefined ? (b.secondary_image_url ? String(b.secondary_image_url) : null) : existing.secondary_image_url,
      b.sizes_stock !== undefined ? JSON.stringify(b.sizes_stock) : String(existing.sizes_stock),
      b.is_featured !== undefined ? (b.is_featured ? 1 : 0) : Number(existing.is_featured),
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : Number(existing.is_active),
      b.badge_text !== undefined ? (b.badge_text ? String(b.badge_text) : null) : existing.badge_text,
      id
    );

    const updated = await db.first<Record<string, unknown>>('SELECT * FROM products WHERE id = ?', id);
    return c.json({ product: mapProductRow(updated!) });
  });

  app.delete('/api/admin/products/:id', async (c) => {
    const auth = await requireStaff(c, 'manage_products');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    await db.run('DELETE FROM products WHERE id = ?', Number(c.req.param('id')));
    return c.json({ ok: true });
  });

  // --- تخصيص المتجر بالكامل ---
  app.get('/api/admin/store-settings', async (c) => {
    const auth = await requireStaff(c, 'view_dashboard');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const row = await db.first<Record<string, unknown>>('SELECT * FROM store_settings WHERE id = 1');
    return c.json({ settings: mapStoreSettingsRow(row!) });
  });

  app.patch('/api/admin/store-settings', async (c) => {
    const auth = await requireStaff(c, 'manage_store_settings');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const cur = await db.first<Record<string, unknown>>('SELECT * FROM store_settings WHERE id = 1');
    if (!cur) return c.json({ error: 'إعدادات المتجر غير موجودة.' }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();

    await db.run(
      `UPDATE store_settings SET
        store_name = ?, tagline_ar = ?, tagline_en = ?, announcement_enabled = ?,
        announcement_text_ar = ?, announcement_text_en = ?, hero_kicker_ar = ?, hero_kicker_en = ?,
        hero_title_ar = ?, hero_title_en = ?, hero_subtitle_ar = ?, hero_subtitle_en = ?,
        hero_cta_ar = ?, hero_cta_en = ?, hero_image_url = ?, accent_color = ?, default_theme = ?,
        shipping_fee = ?, free_shipping_threshold = ?, support_whatsapp = ?, support_email = ?,
        vodafone_cash_number = ?, vodafone_cash_instructions_ar = ?,
        instapay_address = ?, instapay_instructions_ar = ?,
        cod_enabled = ?, vodafone_enabled = ?, instapay_enabled = ?,
        footer_about_ar = ?, footer_about_en = ?, updated_at = ?
       WHERE id = 1`,
      b.store_name !== undefined ? String(b.store_name) : String(cur.store_name),
      b.tagline_ar !== undefined ? String(b.tagline_ar) : String(cur.tagline_ar),
      b.tagline_en !== undefined ? String(b.tagline_en) : String(cur.tagline_en),
      b.announcement_enabled !== undefined ? (b.announcement_enabled ? 1 : 0) : Number(cur.announcement_enabled),
      b.announcement_text_ar !== undefined ? String(b.announcement_text_ar) : String(cur.announcement_text_ar),
      b.announcement_text_en !== undefined ? String(b.announcement_text_en) : String(cur.announcement_text_en),
      b.hero_kicker_ar !== undefined ? String(b.hero_kicker_ar) : String(cur.hero_kicker_ar),
      b.hero_kicker_en !== undefined ? String(b.hero_kicker_en) : String(cur.hero_kicker_en),
      b.hero_title_ar !== undefined ? String(b.hero_title_ar) : String(cur.hero_title_ar),
      b.hero_title_en !== undefined ? String(b.hero_title_en) : String(cur.hero_title_en),
      b.hero_subtitle_ar !== undefined ? String(b.hero_subtitle_ar) : String(cur.hero_subtitle_ar),
      b.hero_subtitle_en !== undefined ? String(b.hero_subtitle_en) : String(cur.hero_subtitle_en),
      b.hero_cta_ar !== undefined ? String(b.hero_cta_ar) : String(cur.hero_cta_ar),
      b.hero_cta_en !== undefined ? String(b.hero_cta_en) : String(cur.hero_cta_en),
      b.hero_image_url !== undefined ? String(b.hero_image_url) : String(cur.hero_image_url),
      b.accent_color !== undefined ? String(b.accent_color) : String(cur.accent_color),
      b.default_theme === 'dark' || b.default_theme === 'light' ? b.default_theme : String(cur.default_theme || 'light'),
      b.shipping_fee !== undefined ? Number(b.shipping_fee) : Number(cur.shipping_fee),
      b.free_shipping_threshold !== undefined ? Number(b.free_shipping_threshold) : Number(cur.free_shipping_threshold),
      b.support_whatsapp !== undefined ? String(b.support_whatsapp) : String(cur.support_whatsapp),
      b.support_email !== undefined ? String(b.support_email) : String(cur.support_email),
      b.vodafone_cash_number !== undefined ? String(b.vodafone_cash_number) : String(cur.vodafone_cash_number),
      b.vodafone_cash_instructions_ar !== undefined ? String(b.vodafone_cash_instructions_ar) : String(cur.vodafone_cash_instructions_ar),
      b.instapay_address !== undefined ? String(b.instapay_address) : String(cur.instapay_address),
      b.instapay_instructions_ar !== undefined ? String(b.instapay_instructions_ar) : String(cur.instapay_instructions_ar),
      b.cod_enabled !== undefined ? (b.cod_enabled ? 1 : 0) : Number(cur.cod_enabled),
      b.vodafone_enabled !== undefined ? (b.vodafone_enabled ? 1 : 0) : Number(cur.vodafone_enabled),
      b.instapay_enabled !== undefined ? (b.instapay_enabled ? 1 : 0) : Number(cur.instapay_enabled),
      b.footer_about_ar !== undefined ? String(b.footer_about_ar) : String(cur.footer_about_ar),
      b.footer_about_en !== undefined ? String(b.footer_about_en) : String(cur.footer_about_en),
      now
    );

    await db.run(
      `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
       VALUES (NULL, NULL, ?, ?, 'تحديث تخصيص المتجر', 'تم تعديل إعدادات ومظهر متجر YUOP', ?)`,
      auth.staff.name,
      auth.staff.role,
      now
    );

    const updated = await db.first<Record<string, unknown>>('SELECT * FROM store_settings WHERE id = 1');
    return c.json({ settings: mapStoreSettingsRow(updated!) });
  });

  // --- إدارة صفحات الهبوط ---
  app.get('/api/admin/landing-pages', async (c) => {
    const auth = await requireStaff(c, 'manage_landing_pages');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const rows = await db.all<Record<string, unknown>>('SELECT * FROM landing_pages ORDER BY id DESC');
    return c.json({ landing_pages: rows.map(mapLandingPageRow) });
  });

  app.post('/api/admin/landing-pages', async (c) => {
    const auth = await requireStaff(c, 'manage_landing_pages');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const cleanSlug = normalizeLandingSlug(String(b.slug || b.title_en || b.title_ar || ''));
    if (!cleanSlug || !b.title_ar) {
      return c.json({ error: 'يرجى إدخال عنوان صفحة الهبوط والرابط المختصر (Slug).' }, 400);
    }
    const existing = await db.first<{ id: number }>('SELECT id FROM landing_pages WHERE slug = ?', cleanSlug);
    if (existing) {
      return c.json({ error: 'يوجد صفحة هبوط بنفس الرابط المختصر بالفعل.' }, 400);
    }

    const now = new Date().toISOString();
    const res = await db.run(
      `INSERT INTO landing_pages (
        slug, title_ar, title_en, kicker_ar, kicker_en, subtitle_ar, subtitle_en,
        hero_image_url, cta_text_ar, cta_text_en, theme_style, highlights_json, featured_product_ids_json,
        is_published, show_in_footer, views_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      cleanSlug,
      String(b.title_ar),
      String(b.title_en || b.title_ar),
      String(b.kicker_ar || 'حملة حصرية'),
      String(b.kicker_en || 'LIMITED CAMPAIGN'),
      String(b.subtitle_ar || ''),
      String(b.subtitle_en || ''),
      String(b.hero_image_url || '/src/assets/images/hero_yuop_streetwear_1794549969761.jpg'),
      String(b.cta_text_ar || 'تسوق التشكيلة'),
      String(b.cta_text_en || 'Shop Now'),
      b.theme_style === 'light' ? 'light' : 'dark',
      JSON.stringify(Array.isArray(b.highlights) ? b.highlights : []),
      JSON.stringify(Array.isArray(b.featured_product_ids) ? b.featured_product_ids.map(Number) : []),
      b.is_published === false ? 0 : 1,
      b.show_in_footer === false ? 0 : 1,
      now,
      now
    );

    const created = await db.first<Record<string, unknown>>(
      'SELECT * FROM landing_pages WHERE id = ?',
      res.meta.last_row_id
    );
    return c.json({ landing_page: mapLandingPageRow(created!) }, 201);
  });

  app.patch('/api/admin/landing-pages/:id', async (c) => {
    const auth = await requireStaff(c, 'manage_landing_pages');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const cur = await db.first<Record<string, unknown>>('SELECT * FROM landing_pages WHERE id = ?', id);
    if (!cur) return c.json({ error: 'صفحة الهبوط غير موجودة.' }, 404);

    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const nextSlug = b.slug !== undefined ? normalizeLandingSlug(String(b.slug)) : String(cur.slug);
    if (!nextSlug) return c.json({ error: 'الرابط المختصر غير صالح.' }, 400);

    const now = new Date().toISOString();
    await db.run(
      `UPDATE landing_pages SET
        slug = ?, title_ar = ?, title_en = ?, kicker_ar = ?, kicker_en = ?,
        subtitle_ar = ?, subtitle_en = ?, hero_image_url = ?, cta_text_ar = ?, cta_text_en = ?,
        theme_style = ?, highlights_json = ?, featured_product_ids_json = ?,
        is_published = ?, show_in_footer = ?, updated_at = ?
       WHERE id = ?`,
      nextSlug,
      b.title_ar !== undefined ? String(b.title_ar) : String(cur.title_ar),
      b.title_en !== undefined ? String(b.title_en) : String(cur.title_en),
      b.kicker_ar !== undefined ? String(b.kicker_ar) : String(cur.kicker_ar),
      b.kicker_en !== undefined ? String(b.kicker_en) : String(cur.kicker_en),
      b.subtitle_ar !== undefined ? String(b.subtitle_ar) : String(cur.subtitle_ar),
      b.subtitle_en !== undefined ? String(b.subtitle_en) : String(cur.subtitle_en),
      b.hero_image_url !== undefined ? String(b.hero_image_url) : String(cur.hero_image_url),
      b.cta_text_ar !== undefined ? String(b.cta_text_ar) : String(cur.cta_text_ar),
      b.cta_text_en !== undefined ? String(b.cta_text_en) : String(cur.cta_text_en),
      b.theme_style === 'light' || b.theme_style === 'dark' ? b.theme_style : String(cur.theme_style),
      b.highlights !== undefined ? JSON.stringify(b.highlights) : String(cur.highlights_json),
      b.featured_product_ids !== undefined
        ? JSON.stringify((b.featured_product_ids as number[]).map(Number))
        : String(cur.featured_product_ids_json),
      b.is_published !== undefined ? (b.is_published ? 1 : 0) : Number(cur.is_published),
      b.show_in_footer !== undefined ? (b.show_in_footer ? 1 : 0) : Number(cur.show_in_footer),
      now,
      id
    );

    const updated = await db.first<Record<string, unknown>>('SELECT * FROM landing_pages WHERE id = ?', id);
    return c.json({ landing_page: mapLandingPageRow(updated!) });
  });

  app.delete('/api/admin/landing-pages/:id', async (c) => {
    const auth = await requireStaff(c, 'manage_landing_pages');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    await db.run('DELETE FROM landing_pages WHERE id = ?', Number(c.req.param('id')));
    return c.json({ ok: true });
  });

  // --- إدارة السوشيال ميديا ---
  app.get('/api/admin/social-links', async (c) => {
    const auth = await requireStaff(c, 'manage_social_links');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const rows = await db.all<Record<string, unknown>>('SELECT * FROM social_links ORDER BY sort_order ASC, id ASC');
    return c.json({ social_links: rows.map(mapSocialLinkRow) });
  });

  app.post('/api/admin/social-links', async (c) => {
    const auth = await requireStaff(c, 'manage_social_links');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const platform = String(b.platform || 'website');
    if (!SOCIAL_PLATFORMS.includes(platform as (typeof SOCIAL_PLATFORMS)[number])) {
      return c.json({ error: 'منصة التواصل غير مدعومة.' }, 400);
    }
    if (!b.label || !b.url) {
      return c.json({ error: 'يرجى إدخال اسم العرض والرابط.' }, 400);
    }

    const now = new Date().toISOString();
    const res = await db.run(
      `INSERT INTO social_links (platform, label, handle, url, sort_order, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      platform,
      String(b.label),
      b.handle ? String(b.handle) : null,
      String(b.url),
      Number(b.sort_order || 0),
      b.is_active === false ? 0 : 1,
      now
    );

    const created = await db.first<Record<string, unknown>>(
      'SELECT * FROM social_links WHERE id = ?',
      res.meta.last_row_id
    );
    return c.json({ social_link: mapSocialLinkRow(created!) }, 201);
  });

  app.patch('/api/admin/social-links/:id', async (c) => {
    const auth = await requireStaff(c, 'manage_social_links');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const cur = await db.first<Record<string, unknown>>('SELECT * FROM social_links WHERE id = ?', id);
    if (!cur) return c.json({ error: 'الحساب غير موجود.' }, 404);

    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();
    await db.run(
      `UPDATE social_links SET platform = ?, label = ?, handle = ?, url = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?`,
      b.platform !== undefined ? String(b.platform) : String(cur.platform),
      b.label !== undefined ? String(b.label) : String(cur.label),
      b.handle !== undefined ? (b.handle ? String(b.handle) : null) : cur.handle,
      b.url !== undefined ? String(b.url) : String(cur.url),
      b.sort_order !== undefined ? Number(b.sort_order) : Number(cur.sort_order),
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : Number(cur.is_active),
      now,
      id
    );

    const updated = await db.first<Record<string, unknown>>('SELECT * FROM social_links WHERE id = ?', id);
    return c.json({ social_link: mapSocialLinkRow(updated!) });
  });

  app.delete('/api/admin/social-links/:id', async (c) => {
    const auth = await requireStaff(c, 'manage_social_links');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    await db.run('DELETE FROM social_links WHERE id = ?', Number(c.req.param('id')));
    return c.json({ ok: true });
  });

  // --- إدارة أكواد الخصم ---
  app.get('/api/admin/promo-codes', async (c) => {
    const auth = await requireStaff(c, 'manage_promos');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const rows = await db.all<Record<string, unknown>>('SELECT * FROM promo_codes ORDER BY id DESC');
    return c.json({ promo_codes: rows.map(mapPromoCodeRow) });
  });

  app.post('/api/admin/promo-codes', async (c) => {
    const auth = await requireStaff(c, 'manage_promos');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const code = String(b.code || '').trim().toUpperCase();
    if (!code || !b.discount_value) {
      return c.json({ error: 'يرجى إدخال كود الخصم وقيمة الخصم.' }, 400);
    }
    const dup = await db.first<{ id: number }>('SELECT id FROM promo_codes WHERE UPPER(code) = ?', code);
    if (dup) {
      return c.json({ error: 'كود الخصم موجود مسبقًا.' }, 400);
    }

    const res = await db.run(
      `INSERT INTO promo_codes (code, discount_type, discount_value, min_order_amount, max_uses, used_count, is_active, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      code,
      b.discount_type === 'fixed' ? 'fixed' : 'percent',
      Number(b.discount_value),
      Number(b.min_order_amount || 0),
      b.max_uses ? Number(b.max_uses) : null,
      b.is_active === false ? 0 : 1,
      b.expires_at ? String(b.expires_at) : null,
      new Date().toISOString()
    );

    const created = await db.first<Record<string, unknown>>(
      'SELECT * FROM promo_codes WHERE id = ?',
      res.meta.last_row_id
    );
    return c.json({ promo_code: mapPromoCodeRow(created!) }, 201);
  });

  app.patch('/api/admin/promo-codes/:id', async (c) => {
    const auth = await requireStaff(c, 'manage_promos');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const cur = await db.first<Record<string, unknown>>('SELECT * FROM promo_codes WHERE id = ?', id);
    if (!cur) return c.json({ error: 'الكود غير موجود.' }, 404);

    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    await db.run(
      `UPDATE promo_codes SET is_active = ?, discount_value = ?, min_order_amount = ?, max_uses = ? WHERE id = ?`,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : Number(cur.is_active),
      b.discount_value !== undefined ? Number(b.discount_value) : Number(cur.discount_value),
      b.min_order_amount !== undefined ? Number(b.min_order_amount) : Number(cur.min_order_amount),
      b.max_uses !== undefined ? (b.max_uses ? Number(b.max_uses) : null) : cur.max_uses,
      id
    );

    const updated = await db.first<Record<string, unknown>>('SELECT * FROM promo_codes WHERE id = ?', id);
    return c.json({ promo_code: mapPromoCodeRow(updated!) });
  });

  app.delete('/api/admin/promo-codes/:id', async (c) => {
    const auth = await requireStaff(c, 'manage_promos');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    await db.run('DELETE FROM promo_codes WHERE id = ?', Number(c.req.param('id')));
    return c.json({ ok: true });
  });

  // --- دليل العملاء ---
  app.get('/api/admin/customers', async (c) => {
    const auth = await requireStaff(c, 'view_orders');
    if ('response' in auth) return auth.response;
    const orderService = c.get('orderService');
    return c.json({ customers: await orderService.listCustomers() });
  });

  // --- قوالب WhatsApp وإعداداته ---
  app.get('/api/admin/templates', async (c) => {
    const auth = await requireStaff(c, 'manage_whatsapp_templates');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const rows = await db.all<Record<string, unknown>>('SELECT * FROM notification_templates ORDER BY id ASC');
    return c.json({ templates: rows.map(mapTemplateRow) });
  });

  app.patch('/api/admin/templates/:key', async (c) => {
    const auth = await requireStaff(c, 'manage_whatsapp_templates');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const key = c.req.param('key');
    const cur = await db.first<Record<string, unknown>>(
      'SELECT * FROM notification_templates WHERE template_key = ?',
      key
    );
    if (!cur) return c.json({ error: 'القالب غير موجود.' }, 404);

    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();
    await db.run(
      `UPDATE notification_templates SET body = ?, is_enabled = ?, meta_template_name = ?, updated_at = ? WHERE template_key = ?`,
      b.body !== undefined ? String(b.body) : String(cur.body),
      b.is_enabled !== undefined ? (b.is_enabled ? 1 : 0) : Number(cur.is_enabled),
      b.meta_template_name !== undefined ? (b.meta_template_name ? String(b.meta_template_name) : null) : cur.meta_template_name,
      now,
      key
    );

    const updated = await db.first<Record<string, unknown>>(
      'SELECT * FROM notification_templates WHERE template_key = ?',
      key
    );
    return c.json({ template: mapTemplateRow(updated!) });
  });

  app.get('/api/admin/whatsapp/config', async (c) => {
    const auth = await requireStaff(c, 'manage_whatsapp_api');
    if ('response' in auth) return auth.response;
    const origin = new URL(c.req.url).origin;
    return c.json({ config: getWhatsAppConfigStatus(c.env, origin) });
  });

  app.post('/api/admin/whatsapp/test', async (c) => {
    const auth = await requireStaff(c, 'manage_whatsapp_api');
    if ('response' in auth) return auth.response;
    const waTransport = createWhatsAppTransport(c.env, deps.customFetch);
    const result = await waTransport.testConnection();
    return c.json(result, result.ok ? 200 : 400);
  });

  app.get('/api/admin/whatsapp/messages', async (c) => {
    const auth = await requireStaff(c, 'view_orders');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const messages = await db.all(
      `SELECT m.*, o.order_number FROM whatsapp_messages m
       LEFT JOIN orders o ON o.id = m.order_id
       ORDER BY m.id DESC LIMIT 100`
    );
    return c.json({ messages });
  });

  // --- Audit Logs ---
  app.get('/api/admin/audit-logs', async (c) => {
    const auth = await requireStaff(c, 'view_audit_logs');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const actionType = String(c.req.query('action_type') || '').trim();
    const search = String(c.req.query('search') || '').trim();
    let logs: unknown[] = [];
    if (actionType && search) {
      logs = await db.all(
        `SELECT * FROM audit_logs
         WHERE action_type = ? AND (COALESCE(order_number, '') LIKE ? OR employee_name LIKE ? OR details LIKE ?)
         ORDER BY id DESC LIMIT 150`,
        actionType,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );
    } else if (actionType) {
      logs = await db.all(
        `SELECT * FROM audit_logs WHERE action_type = ? ORDER BY id DESC LIMIT 150`,
        actionType
      );
    } else if (search) {
      logs = await db.all(
        `SELECT * FROM audit_logs
         WHERE COALESCE(order_number, '') LIKE ? OR employee_name LIKE ? OR action_type LIKE ? OR details LIKE ?
         ORDER BY id DESC LIMIT 150`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`
      );
    } else {
      logs = await db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 150');
    }
    return c.json({ logs });
  });

  // --- إدارة الموظفين والصلاحيات (RBAC) ---
  app.get('/api/admin/staff', async (c) => {
    const auth = await requireStaff(c, 'manage_staff');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const rows = await db.all<Record<string, unknown>>(
      'SELECT id, name, email, role, custom_permissions, is_active, created_at FROM staff_users ORDER BY id ASC'
    );
    return c.json({
      staff: rows.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        email: String(r.email),
        role: String(r.role),
        custom_permissions: parseStaffPermissions(r.custom_permissions),
        is_active: Boolean(r.is_active),
        created_at: String(r.created_at),
      })),
      roles: STAFF_ROLES,
      permissions: PERMISSIONS,
      role_defaults: ROLE_PERMISSIONS_MAP,
    });
  });

  app.post('/api/admin/staff', async (c) => {
    const auth = await requireStaff(c, 'manage_staff');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const b = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      email?: string;
      password?: string;
      role?: StaffRole;
      custom_permissions?: Permission[] | null;
    };

    if (!b.name || !b.email || !b.password || !b.role || !STAFF_ROLES.includes(b.role)) {
      return c.json({ error: 'يرجى استكمال الاسم والبريد وكلمة المرور والدور الوظيفي.' }, 400);
    }
    if (b.password.length < 6) {
      return c.json({ error: 'كلمة المرور يجب ألا تقل عن 6 أحرف.' }, 400);
    }

    const email = b.email.trim().toLowerCase();
    const dup = await db.first<{ id: number }>('SELECT id FROM staff_users WHERE LOWER(email) = ?', email);
    if (dup) return c.json({ error: 'البريد الإلكتروني مسجل مسبقًا.' }, 400);

    const passwordHash = await hashPasswordWeb(b.password);
    const now = new Date().toISOString();
    const res = await db.run(
      `INSERT INTO staff_users (name, email, password_hash, role, custom_permissions, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      b.name.trim(),
      email,
      passwordHash,
      b.role,
      b.custom_permissions ? JSON.stringify(b.custom_permissions) : null,
      now
    );

    const created = await db.first<Record<string, unknown>>(
      'SELECT id, name, email, role, custom_permissions, is_active, created_at FROM staff_users WHERE id = ?',
      res.meta.last_row_id
    );
    return c.json(
      {
        id: res.meta.last_row_id,
        user: {
          ...created,
          custom_permissions: parseStaffPermissions(created!.custom_permissions),
          is_active: Boolean(created!.is_active),
        },
      },
      201
    );
  });

  app.patch('/api/admin/staff/:id', async (c) => {
    const auth = await requireStaff(c, 'manage_staff');
    if ('response' in auth) return auth.response;
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const cur = await db.first<Record<string, unknown>>('SELECT * FROM staff_users WHERE id = ?', id);
    if (!cur) return c.json({ error: 'الموظف غير موجود.' }, 404);

    const b = (await c.req.json().catch(() => ({}))) as {
      role?: StaffRole;
      is_active?: boolean;
      custom_permissions?: Permission[] | null;
      password?: string;
    };

    const nextRole = b.role && STAFF_ROLES.includes(b.role) ? b.role : String(cur.role);
    const nextPass = b.password ? await hashPasswordWeb(b.password) : String(cur.password_hash);
    const nextPerms =
      b.custom_permissions !== undefined
        ? b.custom_permissions
          ? JSON.stringify(b.custom_permissions)
          : null
        : cur.custom_permissions;

    await db.run(
      `UPDATE staff_users SET role = ?, is_active = ?, custom_permissions = ?, password_hash = ? WHERE id = ?`,
      nextRole,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : Number(cur.is_active),
      nextPerms,
      nextPass,
      id
    );

    return c.json({ ok: true });
  });

  return app;
}

export const workerApiApp = createWorkerApp();

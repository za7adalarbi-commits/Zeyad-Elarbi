/**
 * ============================================================================
 * YUOP Streetwear — خدمة إدارة الطلبات والمدفوعات والشحن والـ Webhook
 * تدير كافة عمليات الموقع ولوحة التحكم باستخدام معاملات SQLite الذرية،
 * وتوثق كل عملية في سجل المراجعة (Audit Log) مع ربط مباشر بـ WhatsApp Cloud API.
 * ============================================================================
 */
import type { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildOrderIdempotencyHash,
  calculateOrderTotals,
  canRoleUpdateStatusTo,
  evaluatePromoCode,
  getInitialOrderAndPaymentState,
  hasPermission,
  normalizeWhatsAppPhone,
  renderWhatsAppTemplate,
  shouldSendStatusNotification,
  STATUS_TO_TEMPLATE_KEY,
  validatePaymentConfirmation,
  validatePaymentRejection,
} from '../../shared/orderRules.ts';
import type {
  AuditLogEntry,
  CustomerSummary,
  DashboardStats,
  LowStockAlert,
  OrderDetail,
  OrderItem,
  OrderStatus,
  OrderStatusHistoryEntry,
  OrderSummary,
  PaymentMethod,
  PaymentReceipt,
  PaymentRecord,
  Permission,
  ShippingDetails,
  StaffRole,
  WhatsAppMessageRecord,
} from '../../shared/types.ts';
import { mapPromoCodeRow, mapStoreSettingsRow, mapTemplateRow } from '../db.ts';
import type { WhatsAppTransport } from './whatsappService.ts';
import { sendOrderEmailNotification } from './emailService.ts';

export interface StaffActor {
  id: number;
  name: string;
  role: StaffRole;
  custom_permissions: Permission[] | null;
}

export interface CreateOrderInput {
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  governorate: string;
  delivery_address: string;
  notes?: string;
  payment_method: PaymentMethod;
  promo_code?: string;
  items: Array<{ product_id: number; size: string; quantity: number }>;
}

export class OrderService {
  private db: DatabaseSync;
  private wa: WhatsAppTransport;
  private uploadsDir: string;

  constructor(db: DatabaseSync, wa: WhatsAppTransport, uploadsDir: string) {
    this.db = db;
    this.wa = wa;
    this.uploadsDir = uploadsDir;
  }

  private getSettings() {
    const row = this.db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
    return mapStoreSettingsRow(row);
  }

  private getTemplate(templateKey: string) {
    const row = this.db
      .prepare('SELECT * FROM notification_templates WHERE template_key = ?')
      .get(templateKey) as Record<string, unknown> | undefined;
    return row ? mapTemplateRow(row) : null;
  }

  private insertAuditLog(params: {
    orderId: number | null;
    orderNumber: string | null;
    employeeName: string;
    employeeRole: string | null;
    actionType: string;
    details: string;
  }) {
    this.db
      .prepare(
        `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.orderId,
        params.orderNumber,
        params.employeeName,
        params.employeeRole,
        params.actionType,
        params.details,
        new Date().toISOString()
      );
  }

  private ensureConversation(normalizedPhone: string, customerId: number | null, orderId: number | null): number {
    const existing = this.db
      .prepare('SELECT id FROM whatsapp_conversations WHERE wa_phone = ?')
      .get(normalizedPhone) as { id: number } | undefined;
    const now = new Date().toISOString();
    if (existing) {
      if (orderId) {
        this.db
          .prepare('UPDATE whatsapp_conversations SET last_order_id = ?, updated_at = ? WHERE id = ?')
          .run(orderId, now, existing.id);
      }
      return existing.id;
    }
    const res = this.db
      .prepare(
        `INSERT INTO whatsapp_conversations (customer_id, wa_phone, last_order_id, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(customerId, normalizedPhone, orderId, now);
    return Number(res.lastInsertRowid);
  }

  /**
   * إرسال رسالة WhatsApp بناءً على قالب مخزن مع تسجيل النتيجة (Sent أو Failed) في قاعدة البيانات
   */
  async dispatchTemplateMessage(params: {
    orderId: number;
    templateKey: string;
    actorName: string;
    actorRole: string;
    extraVars?: Record<string, string | number | null | undefined>;
    forceSend?: boolean;
  }): Promise<WhatsAppMessageRecord | null> {
    const template = this.getTemplate(params.templateKey);
    if (!template || (!template.is_enabled && !params.forceSend)) {
      return null;
    }

    const order = this.getOrderById(params.orderId);
    if (!order) return null;

    const settings = this.getSettings();
    const renderedBody = renderWhatsAppTemplate(template.body, {
      ORDER_ID: order.order_number,
      CUSTOMER_NAME: order.customer_name,
      TOTAL_AMOUNT: order.total_amount,
      PAYMENT_METHOD: order.payment_method,
      SHIPPING_COMPANY: order.shipping?.shipping_company || '—',
      TRACKING_NUMBER: order.shipping?.tracking_number || '—',
      TRACKING_URL: order.shipping?.tracking_url || '—',
      REJECTION_REASON: order.payment?.rejection_reason || '—',
      CANCELLATION_REASON: params.extraVars?.CANCELLATION_REASON || 'بناءً على طلب الإدارة أو العميل',
      VODAFONE_NUMBER: settings.vodafone_cash_number,
      INSTAPAY_ADDRESS: settings.instapay_address,
      ...params.extraVars,
    });

    const normalizedPhone = normalizeWhatsAppPhone(order.customer_phone);
    const convId = this.ensureConversation(normalizedPhone, order.customer_id, order.id);
    const now = new Date().toISOString();

    const insertRes = this.db
      .prepare(
        `INSERT INTO whatsapp_messages (
          conversation_id, order_id, direction, message_type, template_key,
          recipient_phone, body, status, retry_count, created_at, updated_at
        ) VALUES (?, ?, 'outbound', 'text', ?, ?, ?, 'Pending', 0, ?, ?)`
      )
      .run(convId, order.id, params.templateKey, normalizedPhone, renderedBody, now, now);

    const msgId = Number(insertRes.lastInsertRowid);
    const sendResult = await this.wa.sendText(normalizedPhone, renderedBody);
    const doneAt = new Date().toISOString();

    if (sendResult.ok) {
      this.db
        .prepare(
          `UPDATE whatsapp_messages
           SET status = 'Sent', meta_message_id = ?, error_message = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(sendResult.metaMessageId || null, doneAt, msgId);

      this.insertAuditLog({
        orderId: order.id,
        orderNumber: order.order_number,
        employeeName: params.actorName,
        employeeRole: params.actorRole,
        actionType: 'إرسال رسالة WhatsApp',
        details: `تم إرسال قالب (${template.title_ar}) إلى ${normalizedPhone}`,
      });
    } else {
      this.db
        .prepare(
          `UPDATE whatsapp_messages
           SET status = 'Failed', error_message = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(sendResult.error || 'فشل الإرسال', doneAt, msgId);

      this.insertAuditLog({
        orderId: order.id,
        orderNumber: order.order_number,
        employeeName: params.actorName,
        employeeRole: params.actorRole,
        actionType: 'فشل إرسال رسالة WhatsApp',
        details: `تعذر إرسال (${template.title_ar}): ${sendResult.error || 'خطأ غير معروف'}`,
      });
    }

    return this.db.prepare('SELECT * FROM whatsapp_messages WHERE id = ?').get(msgId) as unknown as WhatsAppMessageRecord;
  }

  /**
   * إعادة محاولة إرسال رسالة WhatsApp فاشلة فقط دون تكرار تحديث حالة الطلب (السيناريو السادس)
   */
  async retryWhatsAppMessage(messageId: number, actor: StaffActor): Promise<WhatsAppMessageRecord> {
    if (!hasPermission(actor.role, 'send_whatsapp', actor.custom_permissions)) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية إعادة إرسال رسائل واتساب.');
    }

    const msg = this.db
      .prepare('SELECT * FROM whatsapp_messages WHERE id = ?')
      .get(messageId) as unknown as WhatsAppMessageRecord | undefined;

    if (!msg) {
      throw new Error('NOT_FOUND: الرسالة غير موجودة.');
    }
    if (msg.direction !== 'outbound') {
      throw new Error('INVALID: لا يمكن إعادة إرسال رسالة واردة.');
    }

    const order = msg.order_id ? this.getOrderById(msg.order_id) : null;
    const sendResult = await this.wa.sendText(msg.recipient_phone, msg.body);
    const now = new Date().toISOString();

    if (sendResult.ok) {
      this.db
        .prepare(
          `UPDATE whatsapp_messages
           SET status = 'Sent', meta_message_id = ?, error_message = NULL, retry_count = retry_count + 1, updated_at = ?
           WHERE id = ?`
        )
        .run(sendResult.metaMessageId || null, now, msg.id);

      this.insertAuditLog({
        orderId: order?.id ?? null,
        orderNumber: order?.order_number ?? null,
        employeeName: actor.name,
        employeeRole: actor.role,
        actionType: 'إعادة إرسال الرسالة',
        details: `نجحت إعادة إرسال رسالة WhatsApp رقم #${msg.id} إلى ${msg.recipient_phone}`,
      });
    } else {
      this.db
        .prepare(
          `UPDATE whatsapp_messages
           SET status = 'Failed', error_message = ?, retry_count = retry_count + 1, updated_at = ?
           WHERE id = ?`
        )
        .run(sendResult.error || 'فشل إعادة الإرسال', now, msg.id);

      this.insertAuditLog({
        orderId: order?.id ?? null,
        orderNumber: order?.order_number ?? null,
        employeeName: actor.name,
        employeeRole: actor.role,
        actionType: 'فشل إرسال الرسالة',
        details: `فشلت محاولة إعادة إرسال رسالة WhatsApp رقم #${msg.id}: ${sendResult.error}`,
      });
    }

    return this.db.prepare('SELECT * FROM whatsapp_messages WHERE id = ?').get(msg.id) as unknown as WhatsAppMessageRecord;
  }

  /**
   * إنشاء طلب جديد مع التحقق من المخزون ومنع الطلبات المكررة داخل معاملة ذرية (القسم التاسع عشر)
   */
  async createOrder(input: CreateOrderInput): Promise<{ order: OrderDetail; deduplicated: boolean }> {
    const cleanName = input.customer_name?.trim();
    const cleanPhone = input.customer_phone?.trim();
    const cleanAddress = input.delivery_address?.trim();
    const cleanGov = input.governorate?.trim();

    if (!cleanName || !cleanPhone || !cleanAddress || !cleanGov) {
      throw new Error('VALIDATION: يرجى استكمال الاسم ورقم الهاتف والمحافظة والعنوان بالكامل.');
    }
    if (!input.items || input.items.length === 0) {
      throw new Error('VALIDATION: سلة التسوق فارغة.');
    }

    const normalizedPhone = normalizeWhatsAppPhone(cleanPhone);
    if (normalizedPhone.length < 10) {
      throw new Error('VALIDATION: يرجى إدخال رقم هاتف واتساب صحيح.');
    }

    const settings = this.getSettings();
    if (input.payment_method === 'Cash on Delivery' && !settings.cod_enabled) {
      throw new Error('VALIDATION: الدفع عند الاستلام غير متاح حاليًا.');
    }
    if (input.payment_method === 'Vodafone Cash' && !settings.vodafone_enabled) {
      throw new Error('VALIDATION: فودافون كاش غير متاح حاليًا.');
    }
    if (input.payment_method === 'InstaPay' && !settings.instapay_enabled) {
      throw new Error('VALIDATION: إنستا باي غير متاح حاليًا.');
    }

    const idempotencyHash = buildOrderIdempotencyHash({
      phone: cleanPhone,
      paymentMethod: input.payment_method,
      items: input.items,
    });

    // منع إنشاء طلبات مكررة متطابقة لنفس العميل خلال آخر 60 ثانية
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const recentDup = this.db
      .prepare('SELECT id FROM orders WHERE idempotency_hash = ? AND created_at >= ? ORDER BY id DESC LIMIT 1')
      .get(idempotencyHash, cutoff) as { id: number } | undefined;

    if (recentDup) {
      const existingOrder = this.getOrderById(recentDup.id);
      if (existingOrder) {
        return { order: existingOrder, deduplicated: true };
      }
    }

    const createdOrderId = (() => {
      this.db.exec('BEGIN IMMEDIATE;');
      try {
        const now = new Date().toISOString();
        const validatedItems: Array<{
          product_id: number;
          name_ar: string;
          name_en: string;
          size: string;
          quantity: number;
          unit_price: number;
          image_url: string;
        }> = [];

        for (const reqItem of input.items) {
          if (!reqItem.quantity || reqItem.quantity <= 0) {
            throw new Error('VALIDATION: الكمية يجب أن تكون 1 أو أكثر.');
          }
          const productRow = this.db
            .prepare('SELECT * FROM products WHERE id = ? AND is_active = 1')
            .get(reqItem.product_id) as Record<string, unknown> | undefined;

          if (!productRow) {
            throw new Error('VALIDATION: أحد المنتجات المختارة غير متوفر.');
          }
          const stockMap = JSON.parse(String(productRow.sizes_stock || '{}')) as Record<string, number>;
          const available = Number(stockMap[reqItem.size] ?? 0);
          if (available < reqItem.quantity) {
            throw new Error(`VALIDATION: المقاس ${reqItem.size} من ${String(productRow.name_ar)} غير متوفر بالكمية المطلوبة.`);
          }

          stockMap[reqItem.size] = available - reqItem.quantity;
          this.db
            .prepare('UPDATE products SET sizes_stock = ? WHERE id = ?')
            .run(JSON.stringify(stockMap), Number(productRow.id));

          validatedItems.push({
            product_id: Number(productRow.id),
            name_ar: String(productRow.name_ar),
            name_en: String(productRow.name_en),
            size: reqItem.size,
            quantity: reqItem.quantity,
            unit_price: Number(productRow.price),
            image_url: String(productRow.image_url),
          });
        }

        const rawSubtotal = validatedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
        let appliedPromoCode: string | null = null;
        let discountAmount = 0;

        if (input.promo_code && input.promo_code.trim()) {
          const codeNormalized = input.promo_code.trim().toUpperCase();
          const promoRow = this.db
            .prepare('SELECT * FROM promo_codes WHERE UPPER(code) = ?')
            .get(codeNormalized) as Record<string, unknown> | undefined;
          const promo = promoRow ? mapPromoCodeRow(promoRow) : null;
          const check = evaluatePromoCode(promo, rawSubtotal, now);
          if (!check.ok || !promo) {
            throw new Error(`VALIDATION: ${check.error || 'كود الخصم غير صالح.'}`);
          }
          appliedPromoCode = promo.code;
          discountAmount = check.discountAmount;
          this.db
            .prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?')
            .run(promo.id);
        }

        const totals = calculateOrderTotals(
          validatedItems,
          settings.shipping_fee,
          settings.free_shipping_threshold,
          discountAmount
        );

        // إنشاء أو تحديث بيانات العميل
        const existingCustomer = this.db
          .prepare('SELECT id FROM customers WHERE normalized_phone = ?')
          .get(normalizedPhone) as { id: number } | undefined;

        let customerId: number;
        if (existingCustomer) {
          customerId = existingCustomer.id;
          this.db
            .prepare(
              `UPDATE customers SET name = ?, phone = ?, email = COALESCE(?, email), governorate = ?, address = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(cleanName, cleanPhone, input.customer_email || null, cleanGov, cleanAddress, now, customerId);
        } else {
          const cRes = this.db
            .prepare(
              `INSERT INTO customers (name, phone, normalized_phone, email, governorate, address, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(cleanName, cleanPhone, normalizedPhone, input.customer_email || null, cleanGov, cleanAddress, now, now);
          customerId = Number(cRes.lastInsertRowid);
        }

        const { orderStatus, paymentStatus } = getInitialOrderAndPaymentState(input.payment_method);
        const trackingToken = `trk_${crypto.randomBytes(12).toString('hex')}`;
        const maxIdRow = this.db.prepare('SELECT COALESCE(MAX(id), 1000) as m FROM orders').get() as { m: number };
        const nextNum = Math.max(1004, Number(maxIdRow.m) + 1001);
        const orderNumber = `YUOP-${nextNum}`;

        const oRes = this.db
          .prepare(
            `INSERT INTO orders (
              order_number, customer_id, customer_name, customer_phone, normalized_phone, customer_email,
              governorate, delivery_address, notes, status, payment_method, payment_status,
              subtotal, discount_amount, promo_code, shipping_fee, total_amount, tracking_token, idempotency_hash, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            orderNumber,
            customerId,
            cleanName,
            cleanPhone,
            normalizedPhone,
            input.customer_email || null,
            cleanGov,
            cleanAddress,
            input.notes || null,
            orderStatus,
            input.payment_method,
            paymentStatus,
            totals.subtotal,
            totals.discountAmount,
            appliedPromoCode,
            totals.shippingFee,
            totals.totalAmount,
            trackingToken,
            idempotencyHash,
            now,
            now
          );

        const orderId = Number(oRes.lastInsertRowid);

        for (const item of validatedItems) {
          this.db
            .prepare(
              `INSERT INTO order_items (order_id, product_id, product_name_ar, product_name_en, size, quantity, unit_price, line_total, image_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              orderId,
              item.product_id,
              item.name_ar,
              item.name_en,
              item.size,
              item.quantity,
              item.unit_price,
              item.unit_price * item.quantity,
              item.image_url
            );
        }

        this.db
          .prepare(
            `INSERT INTO payments (order_id, method, status, amount, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(orderId, input.payment_method, paymentStatus, totals.totalAmount, now);

        this.db
          .prepare('INSERT INTO shipping_details (order_id, updated_at) VALUES (?, ?)')
          .run(orderId, now);

        this.db
          .prepare(
            `INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at)
             VALUES (?, NULL, ?, 'العميل', ?, ?)`
          )
          .run(orderId, orderStatus, `تم إنشاء الطلب بطريقة دفع: ${input.payment_method}`, now);

        this.insertAuditLog({
          orderId,
          orderNumber,
          employeeName: cleanName,
          employeeRole: 'Customer',
          actionType: 'إنشاء الطلب',
          details: `طلب جديد بقيمة ${totals.totalAmount} ج.م · الدفع: ${input.payment_method}`,
        });

        this.db.exec('COMMIT;');
        return orderId;
      } catch (err) {
        try {
          this.db.exec('ROLLBACK;');
        } catch {
          // ignore
        }
        throw err;
      }
    })();

    // إرسال إشعارات WhatsApp و Gmail SMTP بعد نجاح حفظ الطلب في قاعدة البيانات
    await this.dispatchTemplateMessage({
      orderId: createdOrderId,
      templateKey: 'order_created',
      actorName: 'النظام',
      actorRole: 'System',
    });

    if (input.payment_method === 'Vodafone Cash' || input.payment_method === 'InstaPay') {
      await this.dispatchTemplateMessage({
        orderId: createdOrderId,
        templateKey: 'payment_instructions',
        actorName: 'النظام',
        actorRole: 'System',
      });
    }

    const order = this.getOrderById(createdOrderId)!;

    if (order.customer_email) {
      await sendOrderEmailNotification({
        to: order.customer_email,
        subject: `تأكيد استلام طلبك #${order.order_number} — YUOP`,
        text: `أهلًا ${order.customer_name}، تم استلام طلبك رقم #${order.order_number} بقيمة ${order.total_amount} ج.م.\nطريقة الدفع: ${order.payment_method}`,
      });
    }

    return { order, deduplicated: false };
  }

  /**
   * حفظ صورة الإيصال على القرص بشكل آمن وربطها بالطلب (سواء من الموقع أو من WhatsApp)
   */
  attachPaymentReceipt(params: {
    orderId: number;
    base64Data?: string;
    existingFilePath?: string;
    existingFileName?: string;
    source: 'web' | 'whatsapp';
    whatsappMediaId?: string;
    actorName?: string;
  }): { receipt: PaymentReceipt; order: OrderDetail } {
    const orderRow = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(params.orderId) as Record<string, unknown> | undefined;
    if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');
    if (String(orderRow.payment_method) === 'Cash on Delivery') {
      throw new Error('VALIDATION: طلبات الدفع عند الاستلام لا تتطلب إيصال تحويل.');
    }

    const paymentRow = this.db.prepare('SELECT * FROM payments WHERE order_id = ?').get(params.orderId) as Record<string, unknown>;
    if (String(paymentRow.status) === 'Paid') {
      throw new Error('VALIDATION: تم تأكيد الدفع لهذا الطلب مسبقًا.');
    }

    let savedFilePath = params.existingFilePath || '';
    let savedFileName = params.existingFileName || '';

    if (params.base64Data) {
      const match = params.base64Data.match(/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,(.+)$/i);
      const rawBase64 = match ? match[2] : params.base64Data;
      const ext = match
        ? match[1].toLowerCase().includes('png')
          ? 'png'
          : match[1].toLowerCase().includes('webp')
            ? 'webp'
            : match[1].toLowerCase().includes('svg')
              ? 'svg'
              : 'jpg'
        : 'jpg';

      const buffer = Buffer.from(rawBase64, 'base64');
      if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024) {
        throw new Error('VALIDATION: حجم صورة الإيصال غير صالح (الحد الأقصى 5 ميجابايت).');
      }

      // التحقق من البصمة السحرية للملفات (Magic Bytes) لضمان أنها صورة حقيقية
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      const isWebp = buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';
      const isSvg = ext === 'svg' && buffer.toString('utf8').includes('<svg');
      if (!isPng && !isJpg && !isWebp && !isSvg) {
        throw new Error('VALIDATION: صيغة الملف غير مدعومة. يرجى رفع صورة PNG أو JPG أو WEBP.');
      }

      fs.mkdirSync(this.uploadsDir, { recursive: true });
      savedFileName = `receipt_${String(orderRow.order_number)}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
      savedFilePath = path.join(this.uploadsDir, savedFileName);
      fs.writeFileSync(savedFilePath, buffer);
    }

    if (!savedFilePath || !savedFileName) {
      throw new Error('VALIDATION: لم يتم إرفاق صورة الإيصال.');
    }

    const trackingToken = String(orderRow.tracking_token);
    const publicUrl = `/api/receipts/${savedFileName}?token=${encodeURIComponent(trackingToken)}`;

    let newReceiptId = 0;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const now = new Date().toISOString();
      const maxAttempt = (
        this.db
          .prepare('SELECT COALESCE(MAX(attempt_number), 0) as m FROM payment_receipts WHERE order_id = ?')
          .get(params.orderId) as { m: number }
      ).m;

      const attemptNumber = maxAttempt + 1;
      const rRes = this.db
        .prepare(
          `INSERT INTO payment_receipts (
            order_id, payment_id, attempt_number, file_path, public_url, source, whatsapp_media_id, status, received_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Under Review', ?)`
        )
        .run(
          params.orderId,
          Number(paymentRow.id),
          attemptNumber,
          savedFilePath,
          publicUrl,
          params.source,
          params.whatsappMediaId || null,
          now
        );
      newReceiptId = Number(rRes.lastInsertRowid);

      const prevOrderStatus = String(orderRow.status) as OrderStatus;
      this.db
        .prepare(`UPDATE payments SET status = 'Under Review', updated_at = ? WHERE id = ?`)
        .run(now, Number(paymentRow.id));

      this.db
        .prepare(`UPDATE orders SET status = 'Payment Review', payment_status = 'Under Review', updated_at = ? WHERE id = ?`)
        .run(now, params.orderId);

      if (prevOrderStatus !== 'Payment Review') {
        this.db
          .prepare(
            `INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at)
             VALUES (?, ?, 'Payment Review', ?, ?, ?)`
          )
          .run(
            params.orderId,
            prevOrderStatus,
            params.actorName || 'العميل',
            `تم استلام إيصال الدفع (محاولة #${attemptNumber}) عبر ${params.source === 'whatsapp' ? 'WhatsApp' : 'الموقع'}`,
            now
          );
      }

      this.insertAuditLog({
        orderId: params.orderId,
        orderNumber: String(orderRow.order_number),
        employeeName: params.actorName || String(orderRow.customer_name),
        employeeRole: params.source === 'whatsapp' ? 'WhatsApp Webhook' : 'Customer',
        actionType: 'استلام إيصال',
        details: `تم استلام إيصال جديد (محاولة #${attemptNumber}) عبر ${params.source === 'whatsapp' ? 'واتساب' : 'الموقع'}`,
      });

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore
      }
      throw err;
    }

    const receipt = this.db
      .prepare('SELECT * FROM payment_receipts WHERE id = ?')
      .get(newReceiptId) as unknown as PaymentReceipt;
    return { receipt, order: this.getOrderById(params.orderId)! };
  }

  /**
   * تأكيد الدفع (Confirm Payment) — القسم سادسًا
   * يتحقق من الصلاحيات ويمنع التأكيد المزدوج ويرسل رسالة WhatsApp بعد نجاح الحفظ.
   */
  async confirmPayment(orderId: number, actor: StaffActor): Promise<OrderDetail> {
    if (!hasPermission(actor.role, 'review_payments', actor.custom_permissions)) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية مراجعة وتأكيد المدفوعات.');
    }

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const orderRow = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown> | undefined;
      if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');

      const paymentRow = this.db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId) as Record<string, unknown>;
      const check = validatePaymentConfirmation(
        String(paymentRow.status) as OrderDetail['payment_status'],
        String(orderRow.payment_method) as PaymentMethod
      );
      if (!check.ok) {
        throw new Error(`VALIDATION: ${check.error}`);
      }

      const now = new Date().toISOString();
      const prevStatus = String(orderRow.status) as OrderStatus;

      this.db
        .prepare(
          `UPDATE payments
           SET status = 'Paid', confirmed_by = ?, confirmed_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(actor.name, now, now, Number(paymentRow.id));

      this.db
        .prepare(
          `UPDATE payment_receipts
           SET status = 'Approved', reviewed_by = ?, reviewed_at = ?
           WHERE order_id = ? AND status = 'Under Review'`
        )
        .run(actor.name, now, orderId);

      this.db
        .prepare(`UPDATE orders SET status = 'Confirmed', payment_status = 'Paid', updated_at = ? WHERE id = ?`)
        .run(now, orderId);

      this.db
        .prepare(
          `INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at)
           VALUES (?, ?, 'Confirmed', ?, 'تم التحقق من التحويل وتأكيد استلام الدفع', ?)`
        )
        .run(orderId, prevStatus, actor.name, now);

      this.insertAuditLog({
        orderId,
        orderNumber: String(orderRow.order_number),
        employeeName: actor.name,
        employeeRole: actor.role,
        actionType: 'تأكيد الدفع',
        details: `تم تأكيد استلام الدفع (${String(orderRow.payment_method)}) بقيمة ${Number(orderRow.total_amount)} ج.م`,
      });

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore
      }
      throw err;
    }

    await this.dispatchTemplateMessage({
      orderId,
      templateKey: 'payment_confirmed',
      actorName: actor.name,
      actorRole: actor.role,
    });

    return this.getOrderById(orderId)!;
  }

  /**
   * رفض الدفع (Reject Payment) مع إلزامية كتابة السبب — القسم سادسًا
   */
  async rejectPayment(orderId: number, reason: string, actor: StaffActor): Promise<OrderDetail> {
    if (!hasPermission(actor.role, 'review_payments', actor.custom_permissions)) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية رفض المدفوعات.');
    }

    const cleanReason = reason?.trim() || '';

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const orderRow = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown> | undefined;
      if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');

      const paymentRow = this.db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId) as Record<string, unknown>;
      const check = validatePaymentRejection(String(paymentRow.status) as OrderDetail['payment_status'], cleanReason);
      if (!check.ok) {
        throw new Error(`VALIDATION: ${check.error}`);
      }

      const now = new Date().toISOString();
      const prevStatus = String(orderRow.status) as OrderStatus;

      this.db
        .prepare(
          `UPDATE payments
           SET status = 'Payment Rejected', rejected_by = ?, rejected_at = ?, rejection_reason = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(actor.name, now, cleanReason, now, Number(paymentRow.id));

      this.db
        .prepare(
          `UPDATE payment_receipts
           SET status = 'Rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?
           WHERE order_id = ? AND status = 'Under Review'`
        )
        .run(cleanReason, actor.name, now, orderId);

      this.db
        .prepare(`UPDATE orders SET status = 'Payment Rejected', payment_status = 'Payment Rejected', updated_at = ? WHERE id = ?`)
        .run(now, orderId);

      this.db
        .prepare(
          `INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at)
           VALUES (?, ?, 'Payment Rejected', ?, ?, ?)`
        )
        .run(orderId, prevStatus, actor.name, `سبب الرفض: ${cleanReason}`, now);

      this.insertAuditLog({
        orderId,
        orderNumber: String(orderRow.order_number),
        employeeName: actor.name,
        employeeRole: actor.role,
        actionType: 'رفض الدفع',
        details: `تم رفض الدفع · سبب الرفض: ${cleanReason}`,
      });

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore
      }
      throw err;
    }

    await this.dispatchTemplateMessage({
      orderId,
      templateKey: 'payment_rejected',
      actorName: actor.name,
      actorRole: actor.role,
      extraVars: { REJECTION_REASON: cleanReason },
    });

    return this.getOrderById(orderId)!;
  }

  /**
   * تسجيل تحصيل مبلغ الدفع عند الاستلام (Cash on Delivery) بعد التسليم — القسم سابعًا
   */
  collectCodPayment(orderId: number, actor: StaffActor): OrderDetail {
    if (!hasPermission(actor.role, 'collect_cod', actor.custom_permissions)) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية تسجيل تحصيل الدفع عند الاستلام.');
    }

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const orderRow = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown> | undefined;
      if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');
      if (String(orderRow.payment_method) !== 'Cash on Delivery') {
        throw new Error('VALIDATION: هذا الطلب ليس بنظام الدفع عند الاستلام.');
      }

      const paymentRow = this.db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId) as Record<string, unknown>;
      if (String(paymentRow.status) === 'Paid') {
        throw new Error('VALIDATION: تم تسجيل تحصيل المبلغ مسبقًا.');
      }

      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE payments
           SET status = 'Paid', cod_collected_by = ?, cod_collected_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(actor.name, now, now, Number(paymentRow.id));

      this.db
        .prepare(`UPDATE orders SET payment_status = 'Paid', updated_at = ? WHERE id = ?`)
        .run(now, orderId);

      this.insertAuditLog({
        orderId,
        orderNumber: String(orderRow.order_number),
        employeeName: actor.name,
        employeeRole: actor.role,
        actionType: 'تحصيل الدفع عند الاستلام',
        details: `تم تحصيل مبلغ ${Number(orderRow.total_amount)} ج.م نقدًا عند التسليم`,
      });

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore
      }
      throw err;
    }

    return this.getOrderById(orderId)!;
  }

  /**
   * تغيير حالة الطلب وإرسال إشعار WhatsApp تلقائي عند التغيير الفعلي فقط — القسم ثامنًا وتاسعًا
   */
  async updateOrderStatus(params: {
    orderId: number;
    newStatus: OrderStatus;
    actor: StaffActor;
    notes?: string;
    cancellationReason?: string;
    deliveryFailureReason?: string;
  }): Promise<{ order: OrderDetail; statusChanged: boolean }> {
    if (!canRoleUpdateStatusTo(params.actor.role, params.newStatus, params.actor.custom_permissions)) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية تغيير حالة الطلب إلى هذه المرحلة.');
    }

    let previousStatus: OrderStatus = 'New Order';
    let changed = false;

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const orderRow = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(params.orderId) as Record<string, unknown> | undefined;
      if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');

      previousStatus = String(orderRow.status) as OrderStatus;
      changed = previousStatus !== params.newStatus;

      if (!changed) {
        this.db.exec('COMMIT;');
        return { order: this.getOrderById(params.orderId)!, statusChanged: false };
      }

      const now = new Date().toISOString();
      this.db
        .prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?')
        .run(params.newStatus, now, params.orderId);

      if (params.newStatus === 'Shipped') {
        this.db
          .prepare('UPDATE shipping_details SET shipped_at = COALESCE(shipped_at, ?), updated_at = ? WHERE order_id = ?')
          .run(now, now, params.orderId);
      }
      if (params.newStatus === 'Delivery Failed' && params.deliveryFailureReason) {
        this.db
          .prepare('UPDATE shipping_details SET delivery_failure_reason = ?, updated_at = ? WHERE order_id = ?')
          .run(params.deliveryFailureReason.trim(), now, params.orderId);
      }

      const noteText =
        params.newStatus === 'Cancelled' && params.cancellationReason
          ? `سبب الإلغاء: ${params.cancellationReason.trim()}`
          : params.newStatus === 'Delivery Failed' && params.deliveryFailureReason
            ? `سبب تعذر التسليم: ${params.deliveryFailureReason.trim()}`
            : params.notes || null;

      this.db
        .prepare(
          `INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(params.orderId, previousStatus, params.newStatus, params.actor.name, noteText, now);

      const actionType =
        params.newStatus === 'Cancelled'
          ? 'إلغاء الطلب'
          : params.newStatus === 'Delivered'
            ? 'تسليم الطلب'
            : 'تغيير حالة الطلب';

      this.insertAuditLog({
        orderId: params.orderId,
        orderNumber: String(orderRow.order_number),
        employeeName: params.actor.name,
        employeeRole: params.actor.role,
        actionType,
        details: `من (${previousStatus}) إلى (${params.newStatus})${noteText ? ` — ${noteText}` : ''}`,
      });

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore
      }
      throw err;
    }

    // إرسال إشعار واتساب فقط عند التغيير الفعلي للحالة وبعد نجاح حفظ قاعدة البيانات
    if (shouldSendStatusNotification(previousStatus, params.newStatus)) {
      const templateKey = STATUS_TO_TEMPLATE_KEY[params.newStatus]!;
      await this.dispatchTemplateMessage({
        orderId: params.orderId,
        templateKey,
        actorName: params.actor.name,
        actorRole: params.actor.role,
        extraVars: {
          CANCELLATION_REASON: params.cancellationReason || 'لم يذكر سبب محدد',
        },
      });
    }

    return { order: this.getOrderById(params.orderId)!, statusChanged: true };
  }

  /**
   * تحديث بيانات الشحن والتوصيل وإرسال رابط التتبع عبر WhatsApp — القسم عاشرًا
   */
  async updateShippingDetails(params: {
    orderId: number;
    actor: StaffActor;
    shipping_company?: string | null;
    courier_name?: string | null;
    courier_phone?: string | null;
    tracking_number?: string | null;
    tracking_url?: string | null;
    shipped_at?: string | null;
    expected_delivery_at?: string | null;
    delivery_notes?: string | null;
    delivery_failure_reason?: string | null;
    sendWhatsAppUpdate?: boolean;
  }): Promise<OrderDetail> {
    if (!hasPermission(params.actor.role, 'manage_shipping', params.actor.custom_permissions)) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية تعديل بيانات الشحن والتوصيل.');
    }

    const orderRow = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(params.orderId) as Record<string, unknown> | undefined;
    if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');

    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db
        .prepare(
          `UPDATE shipping_details SET
            shipping_company = ?, courier_name = ?, courier_phone = ?,
            tracking_number = ?, tracking_url = ?, shipped_at = ?,
            expected_delivery_at = ?, delivery_notes = ?, delivery_failure_reason = ?,
            updated_at = ?
           WHERE order_id = ?`
        )
        .run(
          params.shipping_company ?? null,
          params.courier_name ?? null,
          params.courier_phone ?? null,
          params.tracking_number ?? null,
          params.tracking_url ?? null,
          params.shipped_at ?? null,
          params.expected_delivery_at ?? null,
          params.delivery_notes ?? null,
          params.delivery_failure_reason ?? null,
          now,
          params.orderId
        );

      this.db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(now, params.orderId);

      this.insertAuditLog({
        orderId: params.orderId,
        orderNumber: String(orderRow.order_number),
        employeeName: params.actor.name,
        employeeRole: params.actor.role,
        actionType: 'تحديث بيانات الشحن',
        details: `شركة الشحن: ${params.shipping_company || '—'} · رقم التتبع: ${params.tracking_number || '—'}`,
      });

      this.db.exec('COMMIT;');
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // ignore
      }
      throw err;
    }

    if (params.sendWhatsAppUpdate) {
      await this.dispatchTemplateMessage({
        orderId: params.orderId,
        templateKey: 'order_shipped',
        actorName: params.actor.name,
        actorRole: params.actor.role,
        forceSend: true,
      });
    }

    return this.getOrderById(params.orderId)!;
  }

  /**
   * معالجة أحداث Meta WhatsApp Webhook مع منع التكرار (Idempotency)
   * يدعم استقبال الرسائل، الصور (الإيصالات)، ردود الأزرار التفاعلية، وتحديثات حالة الرسالة.
   */
  async processWhatsAppWebhook(payload: Record<string, unknown>): Promise<{ processed: number; skippedDuplicates: number }> {
    let processed = 0;
    let skippedDuplicates = 0;

    const entries = Array.isArray(payload.entry) ? (payload.entry as Array<Record<string, unknown>>) : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? (entry.changes as Array<Record<string, unknown>>) : [];
      for (const change of changes) {
        const value = (change.value || {}) as Record<string, unknown>;

        // 1. معالجة تحديثات حالة الرسائل المرسلة (sent / delivered / read / failed)
        const statuses = Array.isArray(value.statuses) ? (value.statuses as Array<Record<string, unknown>>) : [];
        for (const st of statuses) {
          const metaId = String(st.id || '');
          const statusVal = String(st.status || '');
          const eventId = `status:${metaId}:${statusVal}`;
          if (!metaId) continue;

          const exists = this.db
            .prepare('SELECT id FROM whatsapp_webhook_events WHERE event_id = ?')
            .get(eventId);
          if (exists) {
            skippedDuplicates++;
            continue;
          }

          this.db
            .prepare('INSERT INTO whatsapp_webhook_events (event_id, event_type, payload_json, processed_at) VALUES (?, ?, ?, ?)')
            .run(eventId, 'status', JSON.stringify(st), new Date().toISOString());

          const mappedStatus =
            statusVal === 'delivered'
              ? 'Delivered'
              : statusVal === 'read'
                ? 'Read'
                : statusVal === 'failed'
                  ? 'Failed'
                  : 'Sent';

          const errList = Array.isArray(st.errors) ? (st.errors as Array<{ title?: string; message?: string }>) : [];
          const errMsg = errList[0]?.message || errList[0]?.title || null;

          this.db
            .prepare(
              `UPDATE whatsapp_messages SET status = ?, error_message = COALESCE(?, error_message), updated_at = ?
               WHERE meta_message_id = ?`
            )
            .run(mappedStatus, errMsg, new Date().toISOString(), metaId);

          processed++;
        }

        // 2. معالجة الرسائل والصور الواردة من العملاء
        const messages = Array.isArray(value.messages) ? (value.messages as Array<Record<string, unknown>>) : [];
        for (const msg of messages) {
          const metaId = String(msg.id || crypto.randomUUID());
          const eventId = `msg:${metaId}`;
          const exists = this.db
            .prepare('SELECT id FROM whatsapp_webhook_events WHERE event_id = ?')
            .get(eventId);
          if (exists) {
            skippedDuplicates++;
            continue;
          }

          this.db
            .prepare('INSERT INTO whatsapp_webhook_events (event_id, event_type, payload_json, processed_at) VALUES (?, ?, ?, ?)')
            .run(eventId, 'message', JSON.stringify(msg), new Date().toISOString());

          const fromPhone = normalizeWhatsAppPhone(String(msg.from || ''));
          const msgType = String(msg.type || 'text');
          const now = new Date().toISOString();

          // البحث عن أحدث طلب مفتوح للعميل (بانتظار الدفع أو مرفوض الدفع) لربط الإيصال به تلقائيًا
          const targetOrder = this.db
            .prepare(
              `SELECT id, customer_id, order_number FROM orders
               WHERE normalized_phone = ? AND payment_method IN ('Vodafone Cash', 'InstaPay')
               AND status IN ('Awaiting Payment', 'Payment Rejected', 'Payment Review', 'New Order')
               ORDER BY id DESC LIMIT 1`
            )
            .get(fromPhone) as { id: number; customer_id: number; order_number: string } | undefined;

          const convId = this.ensureConversation(fromPhone, targetOrder?.customer_id ?? null, targetOrder?.id ?? null);
          this.db
            .prepare('UPDATE whatsapp_conversations SET last_customer_message_at = ?, updated_at = ? WHERE id = ?')
            .run(now, now, convId);

          let bodyText = '';
          let mediaUrl: string | null = null;

          if (msgType === 'text') {
            bodyText = String(((msg.text as Record<string, unknown>) || {}).body || '');
          } else if (msgType === 'interactive') {
            const interactive = (msg.interactive as Record<string, unknown>) || {};
            const btnReply = (interactive.button_reply || interactive.list_reply || {}) as Record<string, unknown>;
            bodyText = `رد تفاعلي: ${String(btnReply.title || btnReply.id || '')}`;
          } else if (msgType === 'image') {
            const imgObj = (msg.image as Record<string, unknown>) || {};
            const mediaId = String(imgObj.id || '');
            bodyText = String(imgObj.caption || 'تم إرسال صورة إيصال عبر واتساب');

            if (mediaId && targetOrder) {
              const dl = await this.wa.downloadMedia(mediaId, this.uploadsDir);
              if (dl.ok && dl.filePath && dl.fileName) {
                const { receipt } = this.attachPaymentReceipt({
                  orderId: targetOrder.id,
                  existingFilePath: dl.filePath,
                  existingFileName: dl.fileName,
                  source: 'whatsapp',
                  whatsappMediaId: mediaId,
                  actorName: 'العميل (WhatsApp)',
                });
                mediaUrl = receipt.public_url;
              }
            }
          } else {
            bodyText = `مرفق وارد (${msgType})`;
          }

          this.db
            .prepare(
              `INSERT INTO whatsapp_messages (
                conversation_id, order_id, direction, message_type, recipient_phone,
                body, media_url, status, meta_message_id, created_at, updated_at
              ) VALUES (?, ?, 'inbound', ?, ?, ?, ?, 'Received', ?, ?, ?)`
            )
            .run(
              convId,
              targetOrder?.id ?? null,
              msgType === 'image' ? 'image' : msgType === 'interactive' ? 'interactive' : 'text',
              fromPhone,
              bodyText,
              mediaUrl,
              metaId,
              now,
              now
            );

          processed++;
        }
      }
    }

    return { processed, skippedDuplicates };
  }

  /**
   * جلب تفاصيل طلب واحد كاملة مع الـ Timeline والإيصالات والشحن وسجل الرسائل والمراجعة
   */
  getOrderById(orderId: number): OrderDetail | null {
    const o = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown> | undefined;
    if (!o) return null;
    return this.hydrateOrderDetail(o);
  }

  getOrderByTracking(orderNumber: string, token?: string): OrderDetail | null {
    const cleanNum = orderNumber.trim().toUpperCase().replace(/^#/, '');
    const row = this.db
      .prepare('SELECT * FROM orders WHERE UPPER(order_number) = ?')
      .get(cleanNum) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (token && String(row.tracking_token) !== token) {
      // يمكن البحث برقم الطلب والهاتف أو التوكن
    }
    return this.hydrateOrderDetail(row);
  }

  getOrderByNumberAndPhone(orderNumber: string, phone: string): OrderDetail | null {
    const cleanNum = orderNumber.trim().toUpperCase().replace(/^#/, '');
    const normPhone = normalizeWhatsAppPhone(phone);
    const row = this.db
      .prepare('SELECT * FROM orders WHERE UPPER(order_number) = ? AND normalized_phone = ?')
      .get(cleanNum, normPhone) as Record<string, unknown> | undefined;
    return row ? this.hydrateOrderDetail(row) : null;
  }

  private hydrateOrderDetail(o: Record<string, unknown>): OrderDetail {
    const orderId = Number(o.id);
    const items = this.db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId) as unknown as OrderItem[];
    const payment = this.db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId) as unknown as PaymentRecord;
    const receipts = this.db
      .prepare('SELECT * FROM payment_receipts WHERE order_id = ? ORDER BY attempt_number DESC')
      .all(orderId) as unknown as PaymentReceipt[];
    const shipping = this.db.prepare('SELECT * FROM shipping_details WHERE order_id = ?').get(orderId) as unknown as ShippingDetails;
    const statusHistory = this.db
      .prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id ASC')
      .all(orderId) as unknown as OrderStatusHistoryEntry[];
    const whatsappMessages = this.db
      .prepare('SELECT * FROM whatsapp_messages WHERE order_id = ? ORDER BY id DESC')
      .all(orderId) as unknown as WhatsAppMessageRecord[];
    const auditLogs = this.db
      .prepare('SELECT * FROM audit_logs WHERE order_id = ? ORDER BY id DESC')
      .all(orderId) as unknown as AuditLogEntry[];

    return {
      id: orderId,
      order_number: String(o.order_number),
      customer_id: Number(o.customer_id),
      customer_name: String(o.customer_name),
      customer_phone: String(o.customer_phone),
      customer_email: o.customer_email ? String(o.customer_email) : null,
      governorate: String(o.governorate),
      delivery_address: String(o.delivery_address),
      notes: o.notes ? String(o.notes) : null,
      status: String(o.status) as OrderStatus,
      payment_method: String(o.payment_method) as PaymentMethod,
      payment_status: String(o.payment_status) as OrderDetail['payment_status'],
      subtotal: Number(o.subtotal),
      discount_amount: Number(o.discount_amount || 0),
      promo_code: o.promo_code ? String(o.promo_code) : null,
      shipping_fee: Number(o.shipping_fee),
      total_amount: Number(o.total_amount),
      tracking_token: String(o.tracking_token),
      shipping_company: shipping?.shipping_company || null,
      tracking_number: shipping?.tracking_number || null,
      receipt_count: receipts.length,
      latest_receipt_url: receipts[0]?.public_url || null,
      created_at: String(o.created_at),
      updated_at: String(o.updated_at),
      items,
      payment,
      receipts,
      shipping,
      status_history: statusHistory,
      whatsapp_messages: whatsappMessages,
      audit_logs: auditLogs,
    };
  }

  /**
   * البحث والفلاتر المتقدمة في إدارة الطلبات (القسم الخامس عشر)
   */
  listOrders(filters: {
    search?: string;
    status?: string;
    payment_method?: string;
    payment_status?: string;
    shipping_company?: string;
    date_from?: string;
    date_to?: string;
  }): OrderSummary[] {
    const conditions: string[] = ['1=1'];
    const params: Array<string | number> = [];

    if (filters.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      conditions.push(
        `(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR COALESCE(o.customer_email, '') LIKE ? OR COALESCE(s.tracking_number, '') LIKE ?)`
      );
      params.push(q, q, q, q, q);
    }
    if (filters.status && filters.status !== 'ALL') {
      conditions.push('o.status = ?');
      params.push(filters.status);
    }
    if (filters.payment_method && filters.payment_method !== 'ALL') {
      conditions.push('o.payment_method = ?');
      params.push(filters.payment_method);
    }
    if (filters.payment_status && filters.payment_status !== 'ALL') {
      conditions.push('o.payment_status = ?');
      params.push(filters.payment_status);
    }
    if (filters.shipping_company && filters.shipping_company.trim()) {
      conditions.push('LOWER(COALESCE(s.shipping_company, "")) LIKE ?');
      params.push(`%${filters.shipping_company.trim().toLowerCase()}%`);
    }
    if (filters.date_from) {
      conditions.push('date(o.created_at) >= date(?)');
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      conditions.push('date(o.created_at) <= date(?)');
      params.push(filters.date_to);
    }

    const sql = `
      SELECT o.*, s.shipping_company, s.tracking_number,
        (SELECT COUNT(*) FROM payment_receipts pr WHERE pr.order_id = o.id) as receipt_count,
        (SELECT public_url FROM payment_receipts pr WHERE pr.order_id = o.id ORDER BY pr.attempt_number DESC LIMIT 1) as latest_receipt_url
      FROM orders o
      LEFT JOIN shipping_details s ON s.order_id = o.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY o.id DESC
    `;

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      order_number: String(r.order_number),
      customer_id: Number(r.customer_id),
      customer_name: String(r.customer_name),
      customer_phone: String(r.customer_phone),
      customer_email: r.customer_email ? String(r.customer_email) : null,
      governorate: String(r.governorate),
      delivery_address: String(r.delivery_address),
      notes: r.notes ? String(r.notes) : null,
      status: String(r.status) as OrderStatus,
      payment_method: String(r.payment_method) as PaymentMethod,
      payment_status: String(r.payment_status) as OrderSummary['payment_status'],
      subtotal: Number(r.subtotal),
      discount_amount: Number(r.discount_amount || 0),
      promo_code: r.promo_code ? String(r.promo_code) : null,
      shipping_fee: Number(r.shipping_fee),
      total_amount: Number(r.total_amount),
      tracking_token: String(r.tracking_token),
      shipping_company: r.shipping_company ? String(r.shipping_company) : null,
      tracking_number: r.tracking_number ? String(r.tracking_number) : null,
      receipt_count: Number(r.receipt_count || 0),
      latest_receipt_url: r.latest_receipt_url ? String(r.latest_receipt_url) : null,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    }));
  }

  /**
   * التحقق من صلاحية كود الخصم في شاشة الدفع
   */
  validatePromoCode(code: string, subtotal: number) {
    const clean = code.trim().toUpperCase();
    if (!clean) {
      throw new Error('VALIDATION: يرجى إدخال كود الخصم.');
    }
    const row = this.db
      .prepare('SELECT * FROM promo_codes WHERE UPPER(code) = ?')
      .get(clean) as Record<string, unknown> | undefined;
    const promo = row ? mapPromoCodeRow(row) : null;
    const result = evaluatePromoCode(promo, subtotal);
    if (!result.ok || !promo) {
      throw new Error(`VALIDATION: ${result.error || 'كود الخصم غير صالح.'}`);
    }
    return {
      code: promo.code,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      discount_amount: result.discountAmount,
    };
  }

  /**
   * تنبيهات المخزون المنخفض للوحة التحكم (<= 3 قطع للمقاس)
   */
  getLowStockAlerts(threshold = 3): LowStockAlert[] {
    const rows = this.db
      .prepare('SELECT id, name_ar, name_en, sizes_stock FROM products WHERE is_active = 1')
      .all() as Array<Record<string, unknown>>;
    const alerts: LowStockAlert[] = [];
    for (const r of rows) {
      let stockMap: Record<string, number> = {};
      try {
        stockMap = JSON.parse(String(r.sizes_stock || '{}')) as Record<string, number>;
      } catch {
        stockMap = {};
      }
      for (const [size, qty] of Object.entries(stockMap)) {
        const num = Number(qty || 0);
        if (num <= threshold) {
          alerts.push({
            product_id: Number(r.id),
            product_name_ar: String(r.name_ar),
            product_name_en: String(r.name_en),
            size,
            stock: num,
          });
        }
      }
    }
    return alerts.sort((a, b) => a.stock - b.stock);
  }

  /**
   * دليل العملاء المتكامل (CRM) مع عدد الطلبات وإجمالي الإنفاق
   */
  listCustomers(): CustomerSummary[] {
    const rows = this.db
      .prepare(
        `SELECT c.*,
          COUNT(o.id) as orders_count,
          COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN o.total_amount ELSE 0 END), 0) as total_spent,
          MAX(o.created_at) as last_order_at
         FROM customers c
         LEFT JOIN orders o ON o.customer_id = c.id
         GROUP BY c.id
         ORDER BY total_spent DESC, c.id DESC`
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      phone: String(r.phone),
      email: r.email ? String(r.email) : null,
      governorate: String(r.governorate),
      address: String(r.address),
      orders_count: Number(r.orders_count || 0),
      total_spent: Number(r.total_spent || 0),
      last_order_at: r.last_order_at ? String(r.last_order_at) : null,
      created_at: String(r.created_at),
    }));
  }

  /**
   * إحصائيات لوحة التحكم الرئيسية الـ 12 المطلوبة (القسم الثالث عشر)
   */
  getDashboardStats(): DashboardStats {
    const count = (where: string) =>
      Number((this.db.prepare(`SELECT COUNT(*) as c FROM orders WHERE ${where}`).get() as { c: number }).c);

    const revRow = this.db
      .prepare(`SELECT COALESCE(SUM(total_amount), 0) as rev FROM orders WHERE payment_status = 'Paid' AND status != 'Cancelled'`)
      .get() as { rev: number };

    return {
      total_orders: count('1=1'),
      new_orders: count(`status IN ('New Order', 'Pending Confirmation')`),
      awaiting_payment: count(`status = 'Awaiting Payment'`),
      pending_confirmation: count(`status = 'Pending Confirmation'`),
      payment_review: count(`status = 'Payment Review'`),
      confirmed_payments: count(`payment_status = 'Paid'`),
      rejected_payments: count(`payment_status = 'Payment Rejected'`),
      cod_orders: count(`payment_method = 'Cash on Delivery'`),
      preparing_orders: count(`status = 'Preparing'`),
      shipped_orders: count(`status = 'Shipped'`),
      out_for_delivery_orders: count(`status = 'Out for Delivery'`),
      delivered_orders: count(`status = 'Delivered'`),
      cancelled_orders: count(`status = 'Cancelled'`),
      total_revenue_paid: Number(revRow.rev || 0),
    };
  }
}

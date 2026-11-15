/**
 * ============================================================================
 * YUOP Streetwear — خدمة إدارة الطلبات والمدفوعات والشحن (D1 + R2 Async)
 * تدير كافة عمليات الموقع ولوحة التحكم بشكل غير متزامن متوافق مع Cloudflare D1 & R2
 * ومع node:sqlite في بيئة التطوير المحلي.
 * ============================================================================
 */
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
import { randomHex } from '../crypto.ts';
import {
  mapPromoCodeRow,
  mapStoreSettingsRow,
  mapTemplateRow,
  type DbClient,
  type DbStatementInput,
} from '../dbAdapter.ts';
import { validateAndDecodeBase64Receipt, type ReceiptStorage } from '../r2Storage.ts';
import type { WorkerBindings } from '../types.ts';
import { sendOrderEmailNotification } from './emailService.ts';
import type { WhatsAppTransport } from './whatsappService.ts';

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
  private db: DbClient;
  private wa: WhatsAppTransport;
  private storage: ReceiptStorage;
  private env: Partial<WorkerBindings>;

  constructor(
    db: DbClient,
    wa: WhatsAppTransport,
    storage: ReceiptStorage,
    env: Partial<WorkerBindings> = {}
  ) {
    this.db = db;
    this.wa = wa;
    this.storage = storage;
    this.env = env;
  }

  private async getSettings() {
    const row = await this.db.first<Record<string, unknown>>('SELECT * FROM store_settings WHERE id = 1');
    if (!row) {
      throw new Error('INTERNAL: إعدادات المتجر غير مهيأة في قاعدة البيانات.');
    }
    return mapStoreSettingsRow(row);
  }

  private async getTemplate(templateKey: string) {
    const row = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM notification_templates WHERE template_key = ?',
      templateKey
    );
    return row ? mapTemplateRow(row) : null;
  }

  private async insertAuditLog(params: {
    orderId: number | null;
    orderNumber: string | null;
    employeeName: string;
    employeeRole: string | null;
    actionType: string;
    details: string;
  }) {
    await this.db.run(
      `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params.orderId,
      params.orderNumber,
      params.employeeName,
      params.employeeRole,
      params.actionType,
      params.details,
      new Date().toISOString()
    );
  }

  private async ensureConversation(
    normalizedPhone: string,
    customerId: number | null,
    orderId: number | null
  ): Promise<number> {
    const existing = await this.db.first<{ id: number }>(
      'SELECT id FROM whatsapp_conversations WHERE wa_phone = ?',
      normalizedPhone
    );
    const now = new Date().toISOString();
    if (existing) {
      if (orderId) {
        await this.db.run(
          'UPDATE whatsapp_conversations SET last_order_id = ?, updated_at = ? WHERE id = ?',
          orderId,
          now,
          existing.id
        );
      }
      return existing.id;
    }
    const res = await this.db.run(
      `INSERT INTO whatsapp_conversations (customer_id, wa_phone, last_order_id, updated_at)
       VALUES (?, ?, ?, ?)`,
      customerId,
      normalizedPhone,
      orderId,
      now
    );
    return res.meta.last_row_id;
  }

  async dispatchTemplateMessage(params: {
    orderId: number;
    templateKey: string;
    actorName: string;
    actorRole: string;
    extraVars?: Record<string, string | number | null | undefined>;
    forceSend?: boolean;
  }): Promise<WhatsAppMessageRecord | null> {
    const template = await this.getTemplate(params.templateKey);
    if (!template || (!template.is_enabled && !params.forceSend)) {
      return null;
    }

    const order = await this.getOrderById(params.orderId);
    if (!order) return null;

    const settings = await this.getSettings();
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
    const convId = await this.ensureConversation(normalizedPhone, order.customer_id, order.id);
    const now = new Date().toISOString();

    const insertRes = await this.db.run(
      `INSERT INTO whatsapp_messages (
        conversation_id, order_id, direction, message_type, template_key,
        recipient_phone, body, status, retry_count, created_at, updated_at
      ) VALUES (?, ?, 'outbound', 'text', ?, ?, ?, 'Pending', 0, ?, ?)`,
      convId,
      order.id,
      params.templateKey,
      normalizedPhone,
      renderedBody,
      now,
      now
    );

    const msgId = insertRes.meta.last_row_id;
    const sendResult = await this.wa.sendText(normalizedPhone, renderedBody);
    const doneAt = new Date().toISOString();

    if (sendResult.ok) {
      await this.db.run(
        `UPDATE whatsapp_messages
         SET status = 'Sent', meta_message_id = ?, error_message = NULL, updated_at = ?
         WHERE id = ?`,
        sendResult.metaMessageId || null,
        doneAt,
        msgId
      );

      await this.insertAuditLog({
        orderId: order.id,
        orderNumber: order.order_number,
        employeeName: params.actorName,
        employeeRole: params.actorRole,
        actionType: 'إرسال رسالة WhatsApp',
        details: `تم إرسال قالب (${template.title_ar}) إلى ${normalizedPhone}`,
      });
    } else {
      await this.db.run(
        `UPDATE whatsapp_messages
         SET status = 'Failed', error_message = ?, updated_at = ?
         WHERE id = ?`,
        sendResult.error || 'فشل الإرسال',
        doneAt,
        msgId
      );

      await this.insertAuditLog({
        orderId: order.id,
        orderNumber: order.order_number,
        employeeName: params.actorName,
        employeeRole: params.actorRole,
        actionType: 'فشل إرسال رسالة WhatsApp',
        details: `تعذر إرسال (${template.title_ar}): ${sendResult.error || 'خطأ غير معروف'}`,
      });
    }

    return (await this.db.first<WhatsAppMessageRecord>(
      'SELECT * FROM whatsapp_messages WHERE id = ?',
      msgId
    ))!;
  }

  async retryWhatsAppMessage(messageId: number, actor: StaffActor): Promise<WhatsAppMessageRecord> {
    if (!hasPermission(actor.role, 'send_whatsapp', actor.custom_permissions)) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية إعادة إرسال رسائل واتساب.');
    }

    const msg = await this.db.first<WhatsAppMessageRecord>(
      'SELECT * FROM whatsapp_messages WHERE id = ?',
      messageId
    );

    if (!msg) {
      throw new Error('NOT_FOUND: الرسالة غير موجودة.');
    }
    if (msg.direction !== 'outbound') {
      throw new Error('INVALID: لا يمكن إعادة إرسال رسالة واردة.');
    }

    const order = msg.order_id ? await this.getOrderById(msg.order_id) : null;
    const sendResult = await this.wa.sendText(msg.recipient_phone, msg.body);
    const now = new Date().toISOString();

    if (sendResult.ok) {
      await this.db.run(
        `UPDATE whatsapp_messages
         SET status = 'Sent', meta_message_id = ?, error_message = NULL, retry_count = retry_count + 1, updated_at = ?
         WHERE id = ?`,
        sendResult.metaMessageId || null,
        now,
        msg.id
      );

      await this.insertAuditLog({
        orderId: order?.id ?? null,
        orderNumber: order?.order_number ?? null,
        employeeName: actor.name,
        employeeRole: actor.role,
        actionType: 'إعادة إرسال الرسالة',
        details: `نجحت إعادة إرسال رسالة WhatsApp رقم #${msg.id} إلى ${msg.recipient_phone}`,
      });
    } else {
      await this.db.run(
        `UPDATE whatsapp_messages
         SET status = 'Failed', error_message = ?, retry_count = retry_count + 1, updated_at = ?
         WHERE id = ?`,
        sendResult.error || 'فشل إعادة الإرسال',
        now,
        msg.id
      );

      await this.insertAuditLog({
        orderId: order?.id ?? null,
        orderNumber: order?.order_number ?? null,
        employeeName: actor.name,
        employeeRole: actor.role,
        actionType: 'فشل إرسال الرسالة',
        details: `فشلت محاولة إعادة إرسال رسالة WhatsApp رقم #${msg.id}: ${sendResult.error}`,
      });
    }

    return (await this.db.first<WhatsAppMessageRecord>(
      'SELECT * FROM whatsapp_messages WHERE id = ?',
      msg.id
    ))!;
  }

  /**
   * إنشاء طلب جديد مع التحقق المتفائل من المخزون ومنع التكرار بطريقة آمنة لـ Cloudflare D1
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

    const settings = await this.getSettings();
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

    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const recentDup = await this.db.first<{ id: number }>(
      'SELECT id FROM orders WHERE idempotency_hash = ? AND created_at >= ? ORDER BY id DESC LIMIT 1',
      idempotencyHash,
      cutoff
    );

    if (recentDup) {
      const existingOrder = await this.getOrderById(recentDup.id);
      if (existingOrder) {
        return { order: existingOrder, deduplicated: true };
      }
    }

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

    // تتبع التعديلات على المخزون للتراجع النظيف في حال فشل عنصر لاحق
    const stockRollbackList: Array<{ product_id: number; size: string; quantity: number }> = [];

    try {
      for (const reqItem of input.items) {
        if (!reqItem.quantity || reqItem.quantity <= 0 || !Number.isInteger(reqItem.quantity)) {
          throw new Error('VALIDATION: الكمية يجب أن تكون رقمًا صحيحًا 1 أو أكثر.');
        }

        let updated = false;
        let selectedProduct: Record<string, unknown> | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const productRow = await this.db.first<Record<string, unknown>>(
            'SELECT * FROM products WHERE id = ? AND is_active = 1',
            reqItem.product_id
          );
          if (!productRow) {
            throw new Error('VALIDATION: أحد المنتجات المختارة غير متوفر.');
          }
          const rawStockStr = String(productRow.sizes_stock || '{}');
          const stockMap = JSON.parse(rawStockStr) as Record<string, number>;
          const available = Number(stockMap[reqItem.size] ?? 0);
          if (available < reqItem.quantity) {
            throw new Error(
              `VALIDATION: المقاس ${reqItem.size} من ${String(productRow.name_ar)} غير متوفر بالكمية المطلوبة.`
            );
          }
          stockMap[reqItem.size] = available - reqItem.quantity;
          const upd = await this.db.run(
            'UPDATE products SET sizes_stock = ? WHERE id = ? AND sizes_stock = ? AND is_active = 1',
            JSON.stringify(stockMap),
            Number(productRow.id),
            rawStockStr
          );
          if (upd.meta.changes === 1) {
            updated = true;
            selectedProduct = productRow;
            break;
          }
        }

        if (!updated || !selectedProduct) {
          throw new Error('VALIDATION: تعذر حجز المخزون بسبب تزامن الطلبات، يرجى المحاولة مجددًا.');
        }

        stockRollbackList.push({
          product_id: Number(selectedProduct.id),
          size: reqItem.size,
          quantity: reqItem.quantity,
        });

        validatedItems.push({
          product_id: Number(selectedProduct.id),
          name_ar: String(selectedProduct.name_ar),
          name_en: String(selectedProduct.name_en),
          size: reqItem.size,
          quantity: reqItem.quantity,
          unit_price: Number(selectedProduct.price),
          image_url: String(selectedProduct.image_url),
        });
      }

      const rawSubtotal = validatedItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
      let appliedPromoCode: string | null = null;
      let appliedPromoId: number | null = null;
      let discountAmount = 0;

      if (input.promo_code && input.promo_code.trim()) {
        const codeNormalized = input.promo_code.trim().toUpperCase();
        const promoRow = await this.db.first<Record<string, unknown>>(
          'SELECT * FROM promo_codes WHERE UPPER(code) = ?',
          codeNormalized
        );
        const promo = promoRow ? mapPromoCodeRow(promoRow) : null;
        const check = evaluatePromoCode(promo, rawSubtotal, now);
        if (!check.ok || !promo) {
          throw new Error(`VALIDATION: ${check.error || 'كود الخصم غير صالح.'}`);
        }
        appliedPromoCode = promo.code;
        appliedPromoId = promo.id;
        discountAmount = check.discountAmount;
      }

      const totals = calculateOrderTotals(
        validatedItems,
        settings.shipping_fee,
        settings.free_shipping_threshold,
        discountAmount
      );

      // إنشاء أو تحديث بيانات العميل
      const existingCustomer = await this.db.first<{ id: number }>(
        'SELECT id FROM customers WHERE normalized_phone = ?',
        normalizedPhone
      );

      let customerId: number;
      if (existingCustomer) {
        customerId = existingCustomer.id;
        await this.db.run(
          `UPDATE customers SET name = ?, phone = ?, email = COALESCE(?, email), governorate = ?, address = ?, updated_at = ?
           WHERE id = ?`,
          cleanName,
          cleanPhone,
          input.customer_email || null,
          cleanGov,
          cleanAddress,
          now,
          customerId
        );
      } else {
        const cRes = await this.db.run(
          `INSERT INTO customers (name, phone, normalized_phone, email, governorate, address, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          cleanName,
          cleanPhone,
          normalizedPhone,
          input.customer_email || null,
          cleanGov,
          cleanAddress,
          now,
          now
        );
        customerId = cRes.meta.last_row_id;
      }

      const { orderStatus, paymentStatus } = getInitialOrderAndPaymentState(input.payment_method);
      const trackingToken = `trk_${randomHex(12)}`;
      const maxIdRow = await this.db.first<{ m: number }>('SELECT COALESCE(MAX(id), 1000) as m FROM orders');
      const nextNum = Math.max(1004, Number(maxIdRow?.m || 1000) + 1001);
      const orderNumber = `YUOP-${nextNum}`;

      const oRes = await this.db.run(
        `INSERT INTO orders (
          order_number, customer_id, customer_name, customer_phone, normalized_phone, customer_email,
          governorate, delivery_address, notes, status, payment_method, payment_status,
          subtotal, discount_amount, promo_code, shipping_fee, total_amount, tracking_token, idempotency_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

      const createdOrderId = oRes.meta.last_row_id;

      // تجميع الإدخالات التابعة داخل D1 batch ذري واحد
      const statements: DbStatementInput[] = [];
      if (appliedPromoId !== null) {
        statements.push({
          sql: 'UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?',
          params: [appliedPromoId],
        });
      }

      for (const item of validatedItems) {
        statements.push({
          sql: `INSERT INTO order_items (order_id, product_id, product_name_ar, product_name_en, size, quantity, unit_price, line_total, image_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            createdOrderId,
            item.product_id,
            item.name_ar,
            item.name_en,
            item.size,
            item.quantity,
            item.unit_price,
            item.unit_price * item.quantity,
            item.image_url,
          ],
        });
      }

      statements.push({
        sql: `INSERT INTO payments (order_id, method, status, amount, updated_at) VALUES (?, ?, ?, ?, ?)`,
        params: [createdOrderId, input.payment_method, paymentStatus, totals.totalAmount, now],
      });

      statements.push({
        sql: 'INSERT INTO shipping_details (order_id, updated_at) VALUES (?, ?)',
        params: [createdOrderId, now],
      });

      statements.push({
        sql: `INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at)
              VALUES (?, NULL, ?, 'العميل', ?, ?)`,
        params: [createdOrderId, orderStatus, `تم إنشاء الطلب بطريقة دفع: ${input.payment_method}`, now],
      });

      statements.push({
        sql: `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
              VALUES (?, ?, ?, 'Customer', 'إنشاء الطلب', ?, ?)`,
        params: [
          createdOrderId,
          orderNumber,
          cleanName,
          `طلب جديد بقيمة ${totals.totalAmount} ج.م · الدفع: ${input.payment_method}`,
          now,
        ],
      });

      await this.db.batch(statements);

      // إرسال إشعارات WhatsApp و HTTP Email API بعد نجاح حفظ الطلب دون تعطيل الرد
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

      const order = (await this.getOrderById(createdOrderId))!;

      if (order.customer_email) {
        await sendOrderEmailNotification({
          env: this.env,
          db: this.db,
          orderId: order.id,
          to: order.customer_email,
          subject: `تأكيد استلام طلبك #${order.order_number} — YUOP`,
          text: `أهلًا ${order.customer_name}، تم استلام طلبك رقم #${order.order_number} بقيمة ${order.total_amount} ج.م.\nطريقة الدفع: ${order.payment_method}`,
        });
      }

      return { order, deduplicated: false };
    } catch (err) {
      // استرجاع المخزون المحجوز في حال فشل عملية لاحقة
      for (const rollback of stockRollbackList) {
        try {
          const row = await this.db.first<Record<string, unknown>>(
            'SELECT sizes_stock FROM products WHERE id = ?',
            rollback.product_id
          );
          if (row) {
            const map = JSON.parse(String(row.sizes_stock || '{}')) as Record<string, number>;
            map[rollback.size] = Number(map[rollback.size] ?? 0) + rollback.quantity;
            await this.db.run(
              'UPDATE products SET sizes_stock = ? WHERE id = ?',
              JSON.stringify(map),
              rollback.product_id
            );
          }
        } catch {
          // ignore
        }
      }
      throw err;
    }
  }

  /**
   * حفظ صورة الإيصال داخل Cloudflare R2 (أو مجلد الرفع المحلي) وربطها بالطلب
   */
  async attachPaymentReceipt(params: {
    orderId: number;
    base64Data?: string;
    existingFilePath?: string;
    existingFileName?: string;
    source: 'web' | 'whatsapp';
    whatsappMediaId?: string;
    actorName?: string;
  }): Promise<{ receipt: PaymentReceipt; order: OrderDetail }> {
    const orderRow = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM orders WHERE id = ?',
      params.orderId
    );
    if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');
    if (String(orderRow.payment_method) === 'Cash on Delivery') {
      throw new Error('VALIDATION: طلبات الدفع عند الاستلام لا تتطلب إيصال تحويل.');
    }

    const paymentRow = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM payments WHERE order_id = ?',
      params.orderId
    );
    if (!paymentRow) throw new Error('NOT_FOUND: سجل الدفع غير موجود.');
    if (String(paymentRow.status) === 'Paid') {
      throw new Error('VALIDATION: تم تأكيد الدفع لهذا الطلب مسبقًا.');
    }

    let savedFilePath = params.existingFilePath || '';
    let savedFileName = params.existingFileName || '';

    if (params.base64Data) {
      const validated = validateAndDecodeBase64Receipt(params.base64Data);
      savedFileName = `receipt_${String(orderRow.order_number)}_${Date.now()}_${randomHex(4)}.${validated.ext}`;
      savedFilePath = `receipts/${savedFileName}`;
      await this.storage.put(savedFilePath, validated.bytes, validated.contentType);
    }

    if (!savedFilePath || !savedFileName) {
      throw new Error('VALIDATION: لم يتم إرفاق صورة الإيصال.');
    }

    const trackingToken = String(orderRow.tracking_token);
    const publicUrl = `/api/receipts/${savedFileName}?token=${encodeURIComponent(trackingToken)}`;

    const now = new Date().toISOString();
    const maxRow = await this.db.first<{ m: number }>(
      'SELECT COALESCE(MAX(attempt_number), 0) as m FROM payment_receipts WHERE order_id = ?',
      params.orderId
    );
    const attemptNumber = Number(maxRow?.m ?? 0) + 1;

    const rRes = await this.db.run(
      `INSERT INTO payment_receipts (
        order_id, payment_id, attempt_number, file_path, public_url, source, whatsapp_media_id, status, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Under Review', ?)`,
      params.orderId,
      Number(paymentRow.id),
      attemptNumber,
      savedFilePath,
      publicUrl,
      params.source,
      params.whatsappMediaId || null,
      now
    );
    const newReceiptId = rRes.meta.last_row_id;

    const prevOrderStatus = String(orderRow.status) as OrderStatus;
    const statements: DbStatementInput[] = [
      {
        sql: `UPDATE payments SET status = 'Under Review', updated_at = ? WHERE id = ?`,
        params: [now, Number(paymentRow.id)],
      },
      {
        sql: `UPDATE orders SET status = 'Payment Review', payment_status = 'Under Review', updated_at = ? WHERE id = ?`,
        params: [now, params.orderId],
      },
      {
        sql: `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
              VALUES (?, ?, ?, ?, 'استلام إيصال', ?, ?)`,
        params: [
          params.orderId,
          String(orderRow.order_number),
          params.actorName || String(orderRow.customer_name),
          params.source === 'whatsapp' ? 'WhatsApp Webhook' : 'Customer',
          `تم استلام إيصال جديد (محاولة #${attemptNumber}) عبر ${params.source === 'whatsapp' ? 'واتساب' : 'الموقع'}`,
          now,
        ],
      },
    ];

    if (prevOrderStatus !== 'Payment Review') {
      statements.push({
        sql: `INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at)
              VALUES (?, ?, 'Payment Review', ?, ?, ?)`,
        params: [
          params.orderId,
          prevOrderStatus,
          params.actorName || 'العميل',
          `تم استلام إيصال الدفع (محاولة #${attemptNumber}) عبر ${params.source === 'whatsapp' ? 'WhatsApp' : 'الموقع'}`,
          now,
        ],
      });
    }

    await this.db.batch(statements);

    const receipt = (await this.db.first<PaymentReceipt>(
      'SELECT * FROM payment_receipts WHERE id = ?',
      newReceiptId
    ))!;
    return { receipt, order: (await this.getOrderById(params.orderId))! };
  }

  async confirmPayment(orderId: number, actor: StaffActor): Promise<OrderDetail> {
    if (!hasPermission(actor.role, 'review_payments', actor.custom_permissions)) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية مراجعة وتأكيد المدفوعات.');
    }

    const orderRow = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM orders WHERE id = ?',
      orderId
    );
    if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');

    const paymentRow = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM payments WHERE order_id = ?',
      orderId
    );
    if (!paymentRow) throw new Error('NOT_FOUND: سجل الدفع غير موجود.');

    const check = validatePaymentConfirmation(
      String(paymentRow.status) as OrderDetail['payment_status'],
      String(orderRow.payment_method) as PaymentMethod
    );
    if (!check.ok) {
      throw new Error(`VALIDATION: ${check.error}`);
    }

    const now = new Date().toISOString();
    const prevStatus = String(orderRow.status) as OrderStatus;

    await this.db.batch([
      {
        sql: `UPDATE payments
              SET status = 'Paid', confirmed_by = ?, confirmed_at = ?, updated_at = ?
              WHERE id = ? AND status != 'Paid'`,
        params: [actor.name, now, now, Number(paymentRow.id)],
      },
      {
        sql: `UPDATE payment_receipts
              SET status = 'Approved', reviewed_by = ?, reviewed_at = ?
              WHERE order_id = ? AND status = 'Under Review'`,
        params: [actor.name, now, orderId],
      },
      {
        sql: `UPDATE orders SET status = 'Confirmed', payment_status = 'Paid', updated_at = ? WHERE id = ?`,
        params: [now, orderId],
      },
      {
        sql: `INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at)
              VALUES (?, ?, 'Confirmed', ?, 'تم التحقق من التحويل وتأكيد استلام الدفع', ?)`,
        params: [orderId, prevStatus, actor.name, now],
      },
      {
        sql: `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
              VALUES (?, ?, ?, ?, 'تأكيد الدفع', ?, ?)`,
        params: [
          orderId,
          String(orderRow.order_number),
          actor.name,
          actor.role,
          `تم تأكيد استلام الدفع (${String(orderRow.payment_method)}) بقيمة ${Number(orderRow.total_amount)} ج.م`,
          now,
        ],
      },
    ]);

    await this.dispatchTemplateMessage({
      orderId,
      templateKey: 'payment_confirmed',
      actorName: actor.name,
      actorRole: actor.role,
    });

    return (await this.getOrderById(orderId))!;
  }

  async rejectPayment(orderId: number, reason: string, actor: StaffActor): Promise<OrderDetail> {
    if (!hasPermission(actor.role, 'review_payments', actor.custom_permissions)) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية رفض المدفوعات.');
    }

    const cleanReason = reason?.trim() || '';
    const orderRow = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM orders WHERE id = ?',
      orderId
    );
    if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');

    const paymentRow = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM payments WHERE order_id = ?',
      orderId
    );
    if (!paymentRow) throw new Error('NOT_FOUND: سجل الدفع غير موجود.');

    const check = validatePaymentRejection(String(paymentRow.status) as OrderDetail['payment_status'], cleanReason);
    if (!check.ok) {
      throw new Error(`VALIDATION: ${check.error}`);
    }

    const now = new Date().toISOString();
    const prevStatus = String(orderRow.status) as OrderStatus;

    await this.db.batch([
      {
        sql: `UPDATE payments
              SET status = 'Payment Rejected', rejected_by = ?, rejected_at = ?, rejection_reason = ?, updated_at = ?
              WHERE id = ?`,
        params: [actor.name, now, cleanReason, now, Number(paymentRow.id)],
      },
      {
        sql: `UPDATE payment_receipts
              SET status = 'Rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?
              WHERE order_id = ? AND status = 'Under Review'`,
        params: [cleanReason, actor.name, now, orderId],
      },
      {
        sql: `UPDATE orders SET status = 'Payment Rejected', payment_status = 'Payment Rejected', updated_at = ? WHERE id = ?`,
        params: [now, orderId],
      },
      {
        sql: `INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at)
              VALUES (?, ?, 'Payment Rejected', ?, ?, ?)`,
        params: [orderId, prevStatus, actor.name, `سبب الرفض: ${cleanReason}`, now],
      },
      {
        sql: `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
              VALUES (?, ?, ?, ?, 'رفض الدفع', ?, ?)`,
        params: [
          orderId,
          String(orderRow.order_number),
          actor.name,
          actor.role,
          `تم رفض الدفع · سبب الرفض: ${cleanReason}`,
          now,
        ],
      },
    ]);

    await this.dispatchTemplateMessage({
      orderId,
      templateKey: 'payment_rejected',
      actorName: actor.name,
      actorRole: actor.role,
      extraVars: { REJECTION_REASON: cleanReason },
    });

    return (await this.getOrderById(orderId))!;
  }

  async collectCodPayment(orderId: number, actor: StaffActor): Promise<OrderDetail> {
    if (!hasPermission(actor.role, 'collect_cod', actor.custom_permissions)) {
      throw new Error('FORBIDDEN: ليس لديك صلاحية تسجيل تحصيل الدفع عند الاستلام.');
    }

    const orderRow = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM orders WHERE id = ?',
      orderId
    );
    if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');
    if (String(orderRow.payment_method) !== 'Cash on Delivery') {
      throw new Error('VALIDATION: هذا الطلب ليس بنظام الدفع عند الاستلام.');
    }

    const paymentRow = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM payments WHERE order_id = ?',
      orderId
    );
    if (!paymentRow) throw new Error('NOT_FOUND: سجل الدفع غير موجود.');
    if (String(paymentRow.status) === 'Paid') {
      throw new Error('VALIDATION: تم تسجيل تحصيل المبلغ مسبقًا.');
    }

    const now = new Date().toISOString();
    await this.db.batch([
      {
        sql: `UPDATE payments
              SET status = 'Paid', cod_collected_by = ?, cod_collected_at = ?, updated_at = ?
              WHERE id = ?`,
        params: [actor.name, now, now, Number(paymentRow.id)],
      },
      {
        sql: `UPDATE orders SET payment_status = 'Paid', updated_at = ? WHERE id = ?`,
        params: [now, orderId],
      },
      {
        sql: `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
              VALUES (?, ?, ?, ?, 'تحصيل الدفع عند الاستلام', ?, ?)`,
        params: [
          orderId,
          String(orderRow.order_number),
          actor.name,
          actor.role,
          `تم تحصيل مبلغ ${Number(orderRow.total_amount)} ج.م نقدًا عند التسليم`,
          now,
        ],
      },
    ]);

    return (await this.getOrderById(orderId))!;
  }

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

    const orderRow = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM orders WHERE id = ?',
      params.orderId
    );
    if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');

    const previousStatus = String(orderRow.status) as OrderStatus;
    const changed = previousStatus !== params.newStatus;

    if (!changed) {
      return { order: (await this.getOrderById(params.orderId))!, statusChanged: false };
    }

    const now = new Date().toISOString();
    const noteText =
      params.newStatus === 'Cancelled' && params.cancellationReason
        ? `سبب الإلغاء: ${params.cancellationReason.trim()}`
        : params.newStatus === 'Delivery Failed' && params.deliveryFailureReason
          ? `سبب تعذر التسليم: ${params.deliveryFailureReason.trim()}`
          : params.notes || null;

    const actionType =
      params.newStatus === 'Cancelled'
        ? 'إلغاء الطلب'
        : params.newStatus === 'Delivered'
          ? 'تسليم الطلب'
          : 'تغيير حالة الطلب';

    const statements: DbStatementInput[] = [
      {
        sql: 'UPDATE orders SET status = ?, updated_at = ? WHERE id = ?',
        params: [params.newStatus, now, params.orderId],
      },
      {
        sql: `INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        params: [params.orderId, previousStatus, params.newStatus, params.actor.name, noteText, now],
      },
      {
        sql: `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          params.orderId,
          String(orderRow.order_number),
          params.actor.name,
          params.actor.role,
          actionType,
          `من (${previousStatus}) إلى (${params.newStatus})${noteText ? ` — ${noteText}` : ''}`,
          now,
        ],
      },
    ];

    if (params.newStatus === 'Shipped') {
      statements.push({
        sql: 'UPDATE shipping_details SET shipped_at = COALESCE(shipped_at, ?), updated_at = ? WHERE order_id = ?',
        params: [now, now, params.orderId],
      });
    }
    if (params.newStatus === 'Delivery Failed' && params.deliveryFailureReason) {
      statements.push({
        sql: 'UPDATE shipping_details SET delivery_failure_reason = ?, updated_at = ? WHERE order_id = ?',
        params: [params.deliveryFailureReason.trim(), now, params.orderId],
      });
    }

    await this.db.batch(statements);

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

    return { order: (await this.getOrderById(params.orderId))!, statusChanged: true };
  }

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

    const orderRow = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM orders WHERE id = ?',
      params.orderId
    );
    if (!orderRow) throw new Error('NOT_FOUND: الطلب غير موجود.');

    const now = new Date().toISOString();
    await this.db.batch([
      {
        sql: `UPDATE shipping_details SET
                shipping_company = ?, courier_name = ?, courier_phone = ?,
                tracking_number = ?, tracking_url = ?, shipped_at = ?,
                expected_delivery_at = ?, delivery_notes = ?, delivery_failure_reason = ?,
                updated_at = ?
              WHERE order_id = ?`,
        params: [
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
          params.orderId,
        ],
      },
      {
        sql: 'UPDATE orders SET updated_at = ? WHERE id = ?',
        params: [now, params.orderId],
      },
      {
        sql: `INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at)
              VALUES (?, ?, ?, ?, 'تحديث بيانات الشحن', ?, ?)`,
        params: [
          params.orderId,
          String(orderRow.order_number),
          params.actor.name,
          params.actor.role,
          `شركة الشحن: ${params.shipping_company || '—'} · رقم التتبع: ${params.tracking_number || '—'}`,
          now,
        ],
      },
    ]);

    if (params.sendWhatsAppUpdate) {
      await this.dispatchTemplateMessage({
        orderId: params.orderId,
        templateKey: 'order_shipped',
        actorName: params.actor.name,
        actorRole: params.actor.role,
        forceSend: true,
      });
    }

    return (await this.getOrderById(params.orderId))!;
  }

  async processWhatsAppWebhook(payload: Record<string, unknown>): Promise<{ processed: number; skippedDuplicates: number }> {
    let processed = 0;
    let skippedDuplicates = 0;

    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray((entry as Record<string, unknown>).changes)
        ? ((entry as Record<string, unknown>).changes as Array<Record<string, unknown>>)
        : [];

      for (const change of changes) {
        const value = (change.value as Record<string, unknown>) || {};

        const statuses = Array.isArray(value.statuses) ? (value.statuses as Array<Record<string, unknown>>) : [];
        for (const st of statuses) {
          const metaId = String(st.id || '');
          const statusVal = String(st.status || '');
          const eventKey = `status:${metaId}:${statusVal}`;
          if (!metaId) continue;

          const seen = await this.db.first<{ event_id: string }>(
            'SELECT event_id FROM whatsapp_webhook_events WHERE event_id = ?',
            eventKey
          );
          if (seen) {
            skippedDuplicates++;
            continue;
          }

          await this.db.run(
            'INSERT INTO whatsapp_webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?)',
            eventKey,
            'status',
            new Date().toISOString()
          );

          const mapped =
            statusVal === 'delivered'
              ? 'Delivered'
              : statusVal === 'read'
                ? 'Read'
                : statusVal === 'failed'
                  ? 'Failed'
                  : 'Sent';

          await this.db.run(
            'UPDATE whatsapp_messages SET status = ?, updated_at = ? WHERE meta_message_id = ?',
            mapped,
            new Date().toISOString(),
            metaId
          );
          processed++;
        }

        const messages = Array.isArray(value.messages) ? (value.messages as Array<Record<string, unknown>>) : [];
        for (const msg of messages) {
          const metaId = String(msg.id || '');
          const eventKey = `msg:${metaId}`;
          if (!metaId) continue;

          const seen = await this.db.first<{ event_id: string }>(
            'SELECT event_id FROM whatsapp_webhook_events WHERE event_id = ?',
            eventKey
          );
          if (seen) {
            skippedDuplicates++;
            continue;
          }

          await this.db.run(
            'INSERT INTO whatsapp_webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?)',
            eventKey,
            'message',
            new Date().toISOString()
          );

          const fromPhone = normalizeWhatsAppPhone(String(msg.from || ''));
          const msgType = String(msg.type || 'text');
          const now = new Date().toISOString();

          const targetOrder = await this.db.first<{ id: number; customer_id: number; order_number: string }>(
            `SELECT id, customer_id, order_number FROM orders
             WHERE normalized_phone = ? AND payment_method IN ('Vodafone Cash', 'InstaPay')
             AND status IN ('Awaiting Payment', 'Payment Rejected', 'Payment Review', 'New Order')
             ORDER BY id DESC LIMIT 1`,
            fromPhone
          );

          const convId = await this.ensureConversation(fromPhone, targetOrder?.customer_id ?? null, targetOrder?.id ?? null);
          await this.db.run(
            'UPDATE whatsapp_conversations SET last_customer_message_at = ?, updated_at = ? WHERE id = ?',
            now,
            now,
            convId
          );

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
              const dl = await this.wa.downloadMediaToStorage(mediaId, this.storage);
              if (dl.ok && dl.filePath && dl.fileName) {
                const { receipt } = await this.attachPaymentReceipt({
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

          await this.db.run(
            `INSERT INTO whatsapp_messages (
              conversation_id, order_id, direction, message_type, recipient_phone,
              body, media_url, status, meta_message_id, created_at, updated_at
            ) VALUES (?, ?, 'inbound', ?, ?, ?, ?, 'Received', ?, ?, ?)`,
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

  async getOrderById(orderId: number): Promise<OrderDetail | null> {
    const o = await this.db.first<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) return null;
    return this.hydrateOrderDetail(o);
  }

  async getOrderByTracking(orderNumber: string, token?: string): Promise<OrderDetail | null> {
    const cleanNum = orderNumber.trim().toUpperCase().replace(/^#/, '');
    const row = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM orders WHERE UPPER(order_number) = ?',
      cleanNum
    );
    if (!row) return null;
    if (token && String(row.tracking_token) !== token) {
      return null;
    }
    return this.hydrateOrderDetail(row);
  }

  async getOrderByNumberAndPhone(orderNumber: string, phone: string): Promise<OrderDetail | null> {
    const cleanNum = orderNumber.trim().toUpperCase().replace(/^#/, '');
    const normPhone = normalizeWhatsAppPhone(phone);
    const row = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM orders WHERE UPPER(order_number) = ? AND normalized_phone = ?',
      cleanNum,
      normPhone
    );
    return row ? this.hydrateOrderDetail(row) : null;
  }

  private async hydrateOrderDetail(o: Record<string, unknown>): Promise<OrderDetail> {
    const orderId = Number(o.id);
    const [items, payment, receipts, shipping, statusHistory, whatsappMessages, auditLogs] = await Promise.all([
      this.db.all<OrderItem>('SELECT * FROM order_items WHERE order_id = ?', orderId),
      this.db.first<PaymentRecord>('SELECT * FROM payments WHERE order_id = ?', orderId),
      this.db.all<PaymentReceipt>(
        'SELECT * FROM payment_receipts WHERE order_id = ? ORDER BY attempt_number DESC',
        orderId
      ),
      this.db.first<ShippingDetails>('SELECT * FROM shipping_details WHERE order_id = ?', orderId),
      this.db.all<OrderStatusHistoryEntry>(
        'SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id ASC',
        orderId
      ),
      this.db.all<WhatsAppMessageRecord>(
        'SELECT * FROM whatsapp_messages WHERE order_id = ? ORDER BY id DESC',
        orderId
      ),
      this.db.all<AuditLogEntry>('SELECT * FROM audit_logs WHERE order_id = ? ORDER BY id DESC', orderId),
    ]);

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
      payment: payment!,
      receipts,
      shipping: shipping!,
      status_history: statusHistory,
      whatsapp_messages: whatsappMessages,
      audit_logs: auditLogs,
    };
  }

  async listOrders(filters: {
    search?: string;
    status?: string;
    payment_method?: string;
    payment_status?: string;
    shipping_company?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<OrderSummary[]> {
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

    const rows = await this.db.all<Record<string, unknown>>(sql, ...params);
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

  async validatePromoCode(code: string, subtotal: number) {
    const clean = code.trim().toUpperCase();
    if (!clean) {
      throw new Error('VALIDATION: يرجى إدخال كود الخصم.');
    }
    const row = await this.db.first<Record<string, unknown>>(
      'SELECT * FROM promo_codes WHERE UPPER(code) = ?',
      clean
    );
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

  async getLowStockAlerts(threshold = 3): Promise<LowStockAlert[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      'SELECT id, name_ar, name_en, sizes_stock FROM products WHERE is_active = 1'
    );
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

  async listCustomers(): Promise<CustomerSummary[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT c.*,
        COUNT(o.id) as orders_count,
        COALESCE(SUM(CASE WHEN o.status != 'Cancelled' THEN o.total_amount ELSE 0 END), 0) as total_spent,
        MAX(o.created_at) as last_order_at
       FROM customers c
       LEFT JOIN orders o ON o.customer_id = c.id
       GROUP BY c.id
       ORDER BY total_spent DESC, c.id DESC`
    );

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

  async getDashboardStats(): Promise<DashboardStats> {
    const row = await this.db.first<Record<string, unknown>>(`
      SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN status IN ('New Order', 'Pending Confirmation') THEN 1 ELSE 0 END) as new_orders,
        SUM(CASE WHEN status = 'Awaiting Payment' THEN 1 ELSE 0 END) as awaiting_payment,
        SUM(CASE WHEN status = 'Pending Confirmation' THEN 1 ELSE 0 END) as pending_confirmation,
        SUM(CASE WHEN status = 'Payment Review' THEN 1 ELSE 0 END) as payment_review,
        SUM(CASE WHEN payment_status = 'Paid' THEN 1 ELSE 0 END) as confirmed_payments,
        SUM(CASE WHEN payment_status = 'Payment Rejected' THEN 1 ELSE 0 END) as rejected_payments,
        SUM(CASE WHEN payment_method = 'Cash on Delivery' THEN 1 ELSE 0 END) as cod_orders,
        SUM(CASE WHEN status = 'Preparing' THEN 1 ELSE 0 END) as preparing_orders,
        SUM(CASE WHEN status = 'Shipped' THEN 1 ELSE 0 END) as shipped_orders,
        SUM(CASE WHEN status = 'Out for Delivery' THEN 1 ELSE 0 END) as out_for_delivery_orders,
        SUM(CASE WHEN status = 'Delivered' THEN 1 ELSE 0 END) as delivered_orders,
        SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND status != 'Cancelled' THEN total_amount ELSE 0 END), 0) as total_revenue_paid
      FROM orders
    `);

    return {
      total_orders: Number(row?.total_orders || 0),
      new_orders: Number(row?.new_orders || 0),
      awaiting_payment: Number(row?.awaiting_payment || 0),
      pending_confirmation: Number(row?.pending_confirmation || 0),
      payment_review: Number(row?.payment_review || 0),
      confirmed_payments: Number(row?.confirmed_payments || 0),
      rejected_payments: Number(row?.rejected_payments || 0),
      cod_orders: Number(row?.cod_orders || 0),
      preparing_orders: Number(row?.preparing_orders || 0),
      shipped_orders: Number(row?.shipped_orders || 0),
      out_for_delivery_orders: Number(row?.out_for_delivery_orders || 0),
      delivered_orders: Number(row?.delivered_orders || 0),
      cancelled_orders: Number(row?.cancelled_orders || 0),
      total_revenue_paid: Number(row?.total_revenue_paid || 0),
    };
  }
}

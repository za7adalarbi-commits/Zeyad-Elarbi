/**
 * ============================================================================
 * اختبارات التكامل الشاملة لجميع السيناريوهات الـ 6 المطلوبة (القسم الحادي والعشرون)
 * يتم التشغيل على قاعدة بيانات SQLite في الذاكرة (:memory:) عبر node:test.
 * ============================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../db.ts';
import { OrderService, type StaffActor } from './orderService.ts';
import type { WhatsAppTransport } from './whatsappService.ts';

const superAdmin: StaffActor = {
  id: 1,
  name: 'أحمد منصور',
  role: 'Super Admin',
  custom_permissions: null,
};

const paymentReviewer: StaffActor = {
  id: 2,
  name: 'سارة خالد',
  role: 'Payment Reviewer',
  custom_permissions: null,
};

const shippingManager: StaffActor = {
  id: 3,
  name: 'كريم عادل',
  role: 'Shipping Manager',
  custom_permissions: null,
};

// صورة PNG صالحة بحجم 1x1 بكسل للاختبارات
const VALID_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function setupTestEnv(shouldFailWhatsApp = false) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuop-test-'));
  const db = createDatabase(':memory:', tmpDir);
  const sentMessages: Array<{ to: string; body: string }> = [];
  let failFlag = shouldFailWhatsApp;

  const mockWa: WhatsAppTransport = {
    async sendText(toPhone, body) {
      if (failFlag) {
        return { ok: false, error: 'Simulated Meta API Timeout (503)' };
      }
      sentMessages.push({ to: toPhone, body });
      return { ok: true, metaMessageId: `wamid.${Date.now()}.${Math.random()}` };
    },
    async sendImage() {
      return { ok: true, metaMessageId: 'wamid.img' };
    },
    async testConnection() {
      return { ok: !failFlag };
    },
    async downloadMedia(mediaId, uploadsDir) {
      const fName = `wa_${mediaId}.png`;
      const fPath = path.join(uploadsDir, fName);
      fs.writeFileSync(fPath, Buffer.from(VALID_PNG_BASE64.split(',')[1], 'base64'));
      return { ok: true, filePath: fPath, fileName: fName };
    },
  };

  const service = new OrderService(db, mockWa, tmpDir);
  return {
    db,
    service,
    sentMessages,
    setFailWhatsApp: (val: boolean) => {
      failFlag = val;
    },
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

test('السيناريو 1 و 2: فودافون كاش وإنستا باي كاملين حتى تأكيد الدفع', async () => {
  const { service, sentMessages, cleanup } = setupTestEnv(false);
  try {
    // 1. العميل ينشئ طلب فودافون كاش
    const { order } = await service.createOrder({
      customer_name: 'حسام علي',
      customer_phone: '01011223344',
      governorate: 'القاهرة',
      delivery_address: 'المعادي، شارع 9',
      payment_method: 'Vodafone Cash',
      items: [{ product_id: 1, size: 'L', quantity: 1 }],
    });
    assert.equal(order.status, 'Awaiting Payment');
    assert.equal(order.payment_status, 'Awaiting Receipt');
    // وصلت رسالة إنشاء الطلب + بيانات التحويل
    assert.equal(sentMessages.length, 2);
    assert.match(sentMessages[1].body, /01099887766/);

    // 2. إرسال صورة الإيصال
    const afterReceipt = service.attachPaymentReceipt({
      orderId: order.id,
      base64Data: VALID_PNG_BASE64,
      source: 'web',
    });
    assert.equal(afterReceipt.order.status, 'Payment Review');
    assert.equal(afterReceipt.order.receipts.length, 1);

    // 3. موظف مراجعة المدفوعات يؤكد الدفع
    const confirmed = await service.confirmPayment(order.id, paymentReviewer);
    assert.equal(confirmed.payment_status, 'Paid');
    assert.equal(confirmed.status, 'Confirmed');
    assert.equal(confirmed.payment.confirmed_by, paymentReviewer.name);
    assert.match(sentMessages[2].body, /تم تأكيد استلام الدفع الخاص بطلبك رقم/);

    // 4. منع تأكيد الدفع مرتين
    await assert.rejects(() => service.confirmPayment(order.id, paymentReviewer), /مسبقًا/);

    // 5. السيناريو 2: InstaPay
    const { order: instaOrder } = await service.createOrder({
      customer_name: 'ندى محمود',
      customer_phone: '01233445566',
      governorate: 'الجيزة',
      delivery_address: 'الدقي',
      payment_method: 'InstaPay',
      items: [{ product_id: 2, size: 'M', quantity: 1 }],
    });
    assert.equal(instaOrder.payment_method, 'InstaPay');
    service.attachPaymentReceipt({ orderId: instaOrder.id, base64Data: VALID_PNG_BASE64, source: 'web' });
    const instaConfirmed = await service.confirmPayment(instaOrder.id, paymentReviewer);
    assert.equal(instaConfirmed.payment_status, 'Paid');
    assert.equal(instaConfirmed.status, 'Confirmed');
  } finally {
    cleanup();
  }
});

test('السيناريو 3: رفض الدفع مع السبب وإعادة إرسال إيصال جديد لنفس الطلب', async () => {
  const { service, sentMessages, cleanup } = setupTestEnv(false);
  try {
    const { order } = await service.createOrder({
      customer_name: 'طارق فؤاد',
      customer_phone: '01099112233',
      governorate: 'الإسكندرية',
      delivery_address: 'ستانلي',
      payment_method: 'Vodafone Cash',
      items: [{ product_id: 1, size: 'M', quantity: 1 }],
    });

    service.attachPaymentReceipt({ orderId: order.id, base64Data: VALID_PNG_BASE64, source: 'web' });

    // رفض بدون سبب يجب أن يفشل
    await assert.rejects(() => service.rejectPayment(order.id, '', paymentReviewer), /سبب رفض/);

    // رفض مع سبب واضح
    const rejected = await service.rejectPayment(order.id, 'صورة الإيصال غير واضحة.', paymentReviewer);
    assert.equal(rejected.status, 'Payment Rejected');
    assert.equal(rejected.payment_status, 'Payment Rejected');
    assert.equal(rejected.payment.rejection_reason, 'صورة الإيصال غير واضحة.');
    assert.match(sentMessages.at(-1)!.body, /سبب الرفض: صورة الإيصال غير واضحة/);

    // العميل يعيد إرسال إيصال واضح في نفس الطلب
    const reuploaded = service.attachPaymentReceipt({
      orderId: order.id,
      base64Data: VALID_PNG_BASE64,
      source: 'web',
    });
    assert.equal(reuploaded.order.status, 'Payment Review');
    assert.equal(reuploaded.order.receipts.length, 2);
    assert.equal(reuploaded.order.receipts[0].attempt_number, 2);
  } finally {
    cleanup();
  }
});

test('السيناريو 4 و 5: الدفع عند الاستلام + رحلة التوصيل الكاملة + التحصيل', async () => {
  const { service, sentMessages, cleanup } = setupTestEnv(false);
  try {
    const { order } = await service.createOrder({
      customer_name: 'مصطفى جمال',
      customer_phone: '01188776655',
      governorate: 'القاهرة',
      delivery_address: 'التجمع الخامس',
      payment_method: 'Cash on Delivery',
      items: [{ product_id: 3, size: 'L', quantity: 1 }],
    });

    assert.equal(order.status, 'Pending Confirmation');
    assert.equal(order.payment_status, 'Unpaid');

    // تأكيد الطلب COD (يبقى Unpaid)
    await service.updateOrderStatus({ orderId: order.id, newStatus: 'Confirmed', actor: superAdmin });
    const afterConfirm = service.getOrderById(order.id)!;
    assert.equal(afterConfirm.status, 'Confirmed');
    assert.equal(afterConfirm.payment_status, 'Unpaid');

    // حفظ نفس الحالة لا يرسل رسالة مكررة
    const countBeforeNoOp = sentMessages.length;
    const noOp = await service.updateOrderStatus({ orderId: order.id, newStatus: 'Confirmed', actor: superAdmin });
    assert.equal(noOp.statusChanged, false);
    assert.equal(sentMessages.length, countBeforeNoOp);

    // تحديث الشحن ثم تتبع المراحل
    await service.updateOrderStatus({ orderId: order.id, newStatus: 'Preparing', actor: shippingManager });
    await service.updateOrderStatus({ orderId: order.id, newStatus: 'Ready for Shipping', actor: shippingManager });
    await service.updateShippingDetails({
      orderId: order.id,
      actor: shippingManager,
      shipping_company: 'Aramex',
      tracking_number: 'ARX-5512',
      tracking_url: 'https://aramex.com/track/ARX-5512',
    });
    await service.updateOrderStatus({ orderId: order.id, newStatus: 'Shipped', actor: shippingManager });
    assert.match(sentMessages.at(-1)!.body, /ARX-5512/);

    await service.updateOrderStatus({ orderId: order.id, newStatus: 'Out for Delivery', actor: shippingManager });
    await service.updateOrderStatus({ orderId: order.id, newStatus: 'Delivered', actor: shippingManager });

    // تسجيل تحصيل المبلغ بعد التسليم
    const collected = service.collectCodPayment(order.id, shippingManager);
    assert.equal(collected.payment_status, 'Paid');
    assert.equal(collected.payment.cod_collected_by, shippingManager.name);
  } finally {
    cleanup();
  }
});

test('السيناريو 6: فشل إرسال WhatsApp يحفظ تحديث الطلب ويسمح بإعادة المحاولة دون تكرار', async () => {
  const { service, setFailWhatsApp, cleanup } = setupTestEnv(true);
  try {
    const { order } = await service.createOrder({
      customer_name: 'رامي نبيل',
      customer_phone: '01555443322',
      governorate: 'طنطا',
      delivery_address: 'شارع البحر',
      payment_method: 'Cash on Delivery',
      items: [{ product_id: 2, size: 'L', quantity: 1 }],
    });

    const res = await service.updateOrderStatus({
      orderId: order.id,
      newStatus: 'Confirmed',
      actor: superAdmin,
    });
    assert.equal(res.statusChanged, true);
    assert.equal(res.order.status, 'Confirmed');

    const failedMsg = res.order.whatsapp_messages.find((m) => m.template_key === 'order_confirmed');
    assert.ok(failedMsg);
    assert.equal(failedMsg.status, 'Failed');
    assert.match(failedMsg.error_message || '', /503/);

    const historyCountBeforeRetry = res.order.status_history.length;

    // إعادة تفعيل واتساب وإعادة المحاولة
    setFailWhatsApp(false);
    const retried = await service.retryWhatsAppMessage(failedMsg.id, superAdmin);
    assert.equal(retried.status, 'Sent');
    assert.equal(retried.retry_count, 1);

    const finalOrder = service.getOrderById(order.id)!;
    assert.equal(finalOrder.status_history.length, historyCountBeforeRetry);
  } finally {
    cleanup();
  }
});

test('منع معالجة نفس حدث WhatsApp Webhook مرتين وربط صورة الإيصال الواردة تلقائيًا', async () => {
  const { service, cleanup } = setupTestEnv(false);
  try {
    const { order } = await service.createOrder({
      customer_name: 'سلمى هاني',
      customer_phone: '01077889900',
      governorate: 'القاهرة',
      delivery_address: 'الزمالك',
      payment_method: 'Vodafone Cash',
      items: [{ product_id: 1, size: 'S', quantity: 1 }],
    });

    const webhookPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.inbound.receipt.1',
                    from: '201077889900',
                    type: 'image',
                    image: { id: 'media_9988', caption: 'إيصال التحويل' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const firstPass = await service.processWhatsAppWebhook(webhookPayload);
    assert.equal(firstPass.processed, 1);
    assert.equal(firstPass.skippedDuplicates, 0);

    const updatedOrder = service.getOrderById(order.id)!;
    assert.equal(updatedOrder.status, 'Payment Review');
    assert.equal(updatedOrder.receipts.length, 1);
    assert.equal(updatedOrder.receipts[0].source, 'whatsapp');

    // إرسال نفس الحدث مرة ثانية يجب تجاهله
    const secondPass = await service.processWhatsAppWebhook(webhookPayload);
    assert.equal(secondPass.processed, 0);
    assert.equal(secondPass.skippedDuplicates, 1);
    assert.equal(service.getOrderById(order.id)!.receipts.length, 1);
  } finally {
    cleanup();
  }
});

test('تطبيق كود الخصم وتحديث عداد الاستخدام ودليل العملاء وتنبيهات المخزون', async () => {
  const { db, service, cleanup } = setupTestEnv(false);
  try {
    const promoCheck = service.validatePromoCode('YUOP10', 1450);
    assert.equal(promoCheck.discount_amount, 145);

    const { order } = await service.createOrder({
      customer_name: 'فارس سامي',
      customer_phone: '01055443322',
      governorate: 'القاهرة',
      delivery_address: 'مدينة نصر',
      payment_method: 'Cash on Delivery',
      promo_code: 'YUOP10',
      items: [{ product_id: 1, size: 'L', quantity: 1 }],
    });

    assert.equal(order.promo_code, 'YUOP10');
    assert.equal(order.discount_amount, 145);
    assert.equal(order.subtotal, 1450);
    assert.equal(order.total_amount, 1450 - 145 + 85);

    const promoRow = db.prepare(`SELECT used_count FROM promo_codes WHERE code = 'YUOP10'`).get() as { used_count: number };
    assert.equal(promoRow.used_count, 1);

    const customers = service.listCustomers();
    assert.ok(customers.some((c) => c.name === 'فارس سامي' && c.orders_count === 1));

    const alerts = service.getLowStockAlerts(5);
    assert.ok(alerts.length > 0);
  } finally {
    cleanup();
  }
});

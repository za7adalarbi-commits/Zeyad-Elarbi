/**
 * ============================================================================
 * اختبارات الوحدة للمنطق النقي (Unit Tests - node:test)
 * تختبر قواعد الحالات، منع التأكيد المزدوج، الصلاحيات، قوالب واتساب، وتوقيع Webhook.
 * ============================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Product } from './types.ts';
import {
  buildOrderIdempotencyHash,
  calculateOrderTotals,
  canRoleUpdateStatusTo,
  evaluatePromoCode,
  filterAndSortProducts,
  getInitialOrderAndPaymentState,
  hasPermission,
  matchesProductSearch,
  normalizeLandingSlug,
  normalizeWhatsAppPhone,
  recommendStreetwearSize,
  renderWhatsAppTemplate,
  shouldSendStatusNotification,
  validatePaymentConfirmation,
  validatePaymentRejection,
  verifyMetaWebhookSignature,
} from './orderRules.ts';

test('الحالة الأولية للطلب حسب طريقة الدفع (Vodafone Cash / InstaPay / COD)', () => {
  assert.deepEqual(getInitialOrderAndPaymentState('Vodafone Cash'), {
    orderStatus: 'Awaiting Payment',
    paymentStatus: 'Awaiting Receipt',
  });
  assert.deepEqual(getInitialOrderAndPaymentState('InstaPay'), {
    orderStatus: 'Awaiting Payment',
    paymentStatus: 'Awaiting Receipt',
  });
  assert.deepEqual(getInitialOrderAndPaymentState('Cash on Delivery'), {
    orderStatus: 'Pending Confirmation',
    paymentStatus: 'Unpaid',
  });
});

test('منع تأكيد الدفع مرتين وإلزامية سبب الرفض', () => {
  assert.equal(validatePaymentConfirmation('Under Review', 'Vodafone Cash').ok, true);
  assert.equal(validatePaymentConfirmation('Paid', 'Vodafone Cash').ok, false);
  assert.equal(validatePaymentConfirmation('Unpaid', 'Cash on Delivery').ok, false);

  assert.equal(validatePaymentRejection('Under Review', '').ok, false);
  assert.equal(validatePaymentRejection('Under Review', 'صورة الإيصال غير واضحة.').ok, true);
  assert.equal(validatePaymentRejection('Paid', 'سبب').ok, false);
});

test('صلاحيات الموظفين (RBAC) تمنع الوصول غير المصرح به', () => {
  // موظف مراجعة المدفوعات يؤكد الدفع لكن لا يعدل إعدادات المتجر أو المنتجات
  assert.equal(hasPermission('Payment Reviewer', 'review_payments'), true);
  assert.equal(hasPermission('Payment Reviewer', 'manage_store_settings'), false);
  assert.equal(hasPermission('Payment Reviewer', 'manage_products'), false);

  // موظف الشحن يحدث التوصيل فقط ولا يعدل مفاتيح واتساب أو يؤكد مدفوعات
  assert.equal(hasPermission('Shipping Manager', 'manage_shipping'), true);
  assert.equal(hasPermission('Shipping Manager', 'manage_whatsapp_api'), false);
  assert.equal(canRoleUpdateStatusTo('Shipping Manager', 'Shipped'), true);
  assert.equal(canRoleUpdateStatusTo('Shipping Manager', 'Payment Review'), false);
});

test('استبدال متغيرات قوالب رسائل WhatsApp وعدم إرسال إشعار عند حفظ نفس الحالة', () => {
  const rendered = renderWhatsAppTemplate(
    'طلبك رقم #ORDER_ID تم شحنه مع SHIPPING_COMPANY برقم TRACKING_NUMBER رابط TRACKING_URL',
    {
      ORDER_ID: 'YUOP-1005',
      SHIPPING_COMPANY: 'Bosta',
      TRACKING_NUMBER: 'BST9988',
      TRACKING_URL: 'https://bosta.co/BST9988',
    }
  );
  assert.equal(
    rendered,
    'طلبك رقم #YUOP-1005 تم شحنه مع Bosta برقم BST9988 رابط https://bosta.co/BST9988'
  );

  assert.equal(shouldSendStatusNotification('Confirmed', 'Confirmed'), false);
  assert.equal(shouldSendStatusNotification('Confirmed', 'Preparing'), true);
});

test('تطبيع أرقام الهواتف وحساب الشحن المجاني والتحقق من توقيع Meta Webhook', () => {
  assert.equal(normalizeWhatsAppPhone('010-1234-5678'), '201012345678');
  assert.equal(normalizeWhatsAppPhone('+20 11 2233 4455'), '201122334455');

  const totalsWithShipping = calculateOrderTotals([{ unit_price: 800, quantity: 1 }], 80, 2000);
  assert.deepEqual(totalsWithShipping, { subtotal: 800, discountAmount: 0, shippingFee: 80, totalAmount: 880 });

  const totalsFreeShipping = calculateOrderTotals([{ unit_price: 1200, quantity: 2 }], 80, 2000);
  assert.deepEqual(totalsFreeShipping, { subtotal: 2400, discountAmount: 0, shippingFee: 0, totalAmount: 2400 });

  const totalsWithDiscount = calculateOrderTotals([{ unit_price: 1500, quantity: 1 }], 85, 2500, 150);
  assert.deepEqual(totalsWithDiscount, { subtotal: 1500, discountAmount: 150, shippingFee: 85, totalAmount: 1435 });

  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const secret = 'test_secret_123';
  const validSig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyMetaWebhookSignature(body, validSig, secret), true);
  assert.equal(verifyMetaWebhookSignature(body, 'sha256=badhash', secret), false);
});

test('تقييم أكواد الخصم وتطبيع روابط صفحات الهبوط والبحث اللحظي في المنتجات', () => {
  const promo = {
    id: 1,
    code: 'YUOP10',
    discount_type: 'percent' as const,
    discount_value: 10,
    min_order_amount: 1000,
    max_uses: 5,
    used_count: 1,
    is_active: true,
    expires_at: null,
    created_at: new Date().toISOString(),
  };

  assert.deepEqual(evaluatePromoCode(promo, 2000), { ok: true, discountAmount: 200 });
  assert.equal(evaluatePromoCode(promo, 800).ok, false);
  assert.equal(evaluatePromoCode({ ...promo, used_count: 5 }, 2000).ok, false);

  assert.equal(normalizeLandingSlug('  Winter Drop 26! '), 'winter-drop-26');

  const sampleProduct = {
    id: 1,
    slug: 'hoodie',
    name_ar: 'هودي أوبسيديان',
    name_en: 'Obsidian Boxy Hoodie',
    category: 'Hoodies',
    price: 1450,
    compare_at_price: null,
    description_ar: '',
    description_en: '',
    fabric_details: '480 GSM',
    image_url: '',
    secondary_image_url: null,
    sizes_stock: { L: 5 },
    is_featured: true,
    is_active: true,
    badge_text: 'الأكثر مبيعًا',
    created_at: '',
  };
  assert.equal(matchesProductSearch(sampleProduct, 'hoodies'), true);
  assert.equal(matchesProductSearch(sampleProduct, 'أوبسيديان'), true);
  assert.equal(matchesProductSearch(sampleProduct, 'مبيعًا'), true);
  assert.equal(matchesProductSearch(sampleProduct, 'denim'), false);
});

test('بصمة منع تكرار الطلبات المتطابقة تنتج نفس الهاش لنفس العناصر والهاتف', () => {
  const h1 = buildOrderIdempotencyHash({
    phone: '01012345678',
    paymentMethod: 'Vodafone Cash',
    items: [
      { product_id: 2, size: 'L', quantity: 1 },
      { product_id: 1, size: 'M', quantity: 2 },
    ],
  });
  const h2 = buildOrderIdempotencyHash({
    phone: '+201012345678',
    paymentMethod: 'Vodafone Cash',
    items: [
      { product_id: 1, size: 'M', quantity: 2 },
      { product_id: 2, size: 'L', quantity: 1 },
    ],
  });
  assert.equal(h1, h2);
});

test('فلترة وترتيب المنتجات حسب الفئة والمخزون والسعر', () => {
  const sample: Product[] = [
    {
      id: 1,
      slug: 'obsidian-hoodie',
      name_ar: 'هودي أوبسيديان',
      name_en: 'Obsidian Hoodie',
      description_ar: '',
      description_en: '',
      price: 1500,
      compare_at_price: null,
      category: 'Hoodies',
      image_url: '',
      secondary_image_url: null,
      sizes_stock: { S: 0, M: 3 },
      fabric_details: '480 GSM',
      is_active: true,
      is_featured: true,
      badge_text: null,
      created_at: '',
    },
    {
      id: 2,
      slug: 'chalk-tee',
      name_ar: 'تيشيرت تشوك',
      name_en: 'Chalk Tee',
      description_ar: '',
      description_en: '',
      price: 700,
      compare_at_price: null,
      category: 'Tees',
      image_url: '',
      secondary_image_url: null,
      sizes_stock: { S: 0, M: 0 },
      fabric_details: '300 GSM',
      is_active: true,
      is_featured: false,
      badge_text: null,
      created_at: '',
    },
    {
      id: 3,
      slug: 'concrete-hoodie',
      name_ar: 'هودي كونكريت',
      name_en: 'Concrete Hoodie',
      description_ar: '',
      description_en: '',
      price: 1200,
      compare_at_price: null,
      category: 'Hoodies',
      image_url: '',
      secondary_image_url: null,
      sizes_stock: { L: 5 },
      fabric_details: '480 GSM',
      is_active: true,
      is_featured: true,
      badge_text: null,
      created_at: '',
    },
  ];

  const hoodiesAsc = filterAndSortProducts(sample, {
    category: 'Hoodies',
    sortMode: 'price-asc',
  });
  assert.deepEqual(
    hoodiesAsc.map((p) => p.id),
    [3, 1]
  );

  const inStockOnly = filterAndSortProducts(sample, {
    onlyInStock: true,
  });
  assert.deepEqual(
    inStockOnly.map((p) => p.id),
    [1, 3]
  );
});

test('حاسبة مقاس الستريت وير ترشح المقاس والقياسات بدقة', () => {
  const boxyM = recommendStreetwearSize(174, 72, 'boxy');
  assert.equal(boxyM.size, 'M');
  assert.equal(boxyM.chestCm, 61);

  const oversizedL = recommendStreetwearSize(174, 72, 'oversized');
  assert.equal(oversizedL.size, 'L');

  const compactS = recommendStreetwearSize(164, 58, 'regular');
  assert.equal(compactS.size, 'S');
});


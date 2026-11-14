/**
 * ============================================================================
 * YUOP Streetwear — قواعد العمل النقية (Pure Domain Logic)
 * هذا الملف يحتوي على جميع الدوال النقية القابلة للاختبار السريع عبر node:test
 * بدون الاعتماد على DOM أو Express أو قاعدة البيانات مباشرة.
 * ============================================================================
 */
import crypto from 'node:crypto';
import {
  ROLE_PERMISSIONS_MAP,
  type OrderStatus,
  type PaymentMethod,
  type PaymentStatus,
  type Permission,
  type Product,
  type PromoCode,
  type StaffRole,
} from './types.ts';

/**
 * خريطة الربط بين حالة الطلب ومفتاح قالب رسالة واتساب التلقائية (القسم تاسعًا)
 */
export const STATUS_TO_TEMPLATE_KEY: Partial<Record<OrderStatus, string>> = {
  Confirmed: 'order_confirmed',
  Preparing: 'order_preparing',
  'Ready for Shipping': 'order_ready_for_shipping',
  Shipped: 'order_shipped',
  'Out for Delivery': 'order_out_for_delivery',
  Delivered: 'order_delivered',
  'Delivery Failed': 'order_delivery_failed',
  Returned: 'order_returned',
  Cancelled: 'order_cancelled',
};

/**
 * تحديد الحالة الأولية للطلب وحالة الدفع عند إنشاء طلب جديد حسب طريقة الدفع
 * - الدفع عند الاستلام (COD): حالة الطلب Pending Confirmation، الدفع Unpaid
 * - فودافون كاش أو إنستا باي: حالة الطلب Awaiting Payment، الدفع Awaiting Receipt
 */
export function getInitialOrderAndPaymentState(method: PaymentMethod): {
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
} {
  if (method === 'Cash on Delivery') {
    return {
      orderStatus: 'Pending Confirmation',
      paymentStatus: 'Unpaid',
    };
  }
  return {
    orderStatus: 'Awaiting Payment',
    paymentStatus: 'Awaiting Receipt',
  };
}

/**
 * التحقق من صلاحية الموظف لتنفيذ إجراء معين (القسم سابع عشر)
 * يجمع بين الصلاحيات الافتراضية للدور والصلاحيات المخصصة إن وجدت.
 */
export function hasPermission(
  role: StaffRole,
  permission: Permission,
  customPermissions?: Permission[] | null
): boolean {
  if (role === 'Super Admin') return true;
  if (customPermissions && customPermissions.length > 0) {
    return customPermissions.includes(permission);
  }
  const defaults = ROLE_PERMISSIONS_MAP[role] || [];
  return defaults.includes(permission);
}

/**
 * التحقق مما إذا كان موظف الشحن يحاول تعديل حالة غير مسموح بها (مثل مراجعة الدفع)
 */
export function canRoleUpdateStatusTo(
  role: StaffRole,
  targetStatus: OrderStatus,
  customPermissions?: Permission[] | null
): boolean {
  if (!hasPermission(role, 'manage_orders_status', customPermissions)) {
    return false;
  }
  // موظف الشحن لا يمكنه تأكيد الدفع أو تحويل الطلب لـ Payment Review، بل يدير التجهيز والشحن والتسليم فقط
  if (role === 'Shipping Manager') {
    const allowedForShipping: OrderStatus[] = [
      'Preparing',
      'Ready for Shipping',
      'Shipped',
      'Out for Delivery',
      'Delivered',
      'Delivery Failed',
      'Returned',
    ];
    return allowedForShipping.includes(targetStatus);
  }
  return true;
}

/**
 * استبدال المتغيرات التلقائية داخل قوالب رسائل WhatsApp (القسم الحادي عشر)
 * المتغيرات المدعومة: ORDER_ID, CUSTOMER_NAME, TOTAL_AMOUNT, PAYMENT_METHOD,
 * SHIPPING_COMPANY, TRACKING_NUMBER, TRACKING_URL, REJECTION_REASON, CANCELLATION_REASON,
 * VODAFONE_NUMBER, INSTAPAY_ADDRESS
 */
export function renderWhatsAppTemplate(
  templateBody: string,
  variables: Record<string, string | number | null | undefined>
): string {
  let output = templateBody;
  for (const [key, rawValue] of Object.entries(variables)) {
    const safeValue = rawValue === null || rawValue === undefined || rawValue === '' ? '—' : String(rawValue);
    // استبدال {{KEY}} أو KEY إذا كان مكتوبًا بشكل مباشر كما في نص المواصفات مثل #ORDER_ID و REJECTION_REASON
    output = output.replaceAll(`{{${key}}}`, safeValue);
    output = output.replaceAll(key, safeValue);
  }
  return output;
}

/**
 * تطبيع رقم الهاتف المصري/الدولي لصيغة واتساب الدولية (بدون + أو مسافات)
 * مثال: 01012345678 -> 201012345678
 */
export function normalizeWhatsAppPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) {
    return digits.slice(2);
  }
  if (digits.startsWith('01') && digits.length === 11) {
    return `2${digits}`;
  }
  if (digits.startsWith('1') && digits.length === 10) {
    return `20${digits}`;
  }
  return digits;
}

/**
 * حساب مصاريف الشحن والإجمالي النهائي بدقة مع دعم الخصم
 */
export function calculateOrderTotals(
  items: Array<{ unit_price: number; quantity: number }>,
  shippingFee: number,
  freeShippingThreshold: number,
  discountAmount = 0
): { subtotal: number; discountAmount: number; shippingFee: number; totalAmount: number } {
  const subtotal = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  const safeDiscount = Math.min(subtotal, Math.max(0, Math.round(discountAmount)));
  const discountedSubtotal = Math.max(0, subtotal - safeDiscount);
  const appliedShipping =
    freeShippingThreshold > 0 && discountedSubtotal >= freeShippingThreshold ? 0 : Math.max(0, shippingFee);
  return {
    subtotal,
    discountAmount: safeDiscount,
    shippingFee: appliedShipping,
    totalAmount: discountedSubtotal + appliedShipping,
  };
}

/**
 * التحقق من صلاحية كود الخصم وحساب قيمة الخصم بالعملة المحلية
 */
export function evaluatePromoCode(
  promo: PromoCode | null | undefined,
  subtotal: number,
  nowIso: string = new Date().toISOString()
): { ok: boolean; discountAmount: number; error?: string } {
  if (!promo || !promo.is_active) {
    return { ok: false, discountAmount: 0, error: 'كود الخصم غير صالح أو غير مفعل حاليًا.' };
  }
  if (promo.expires_at && new Date(promo.expires_at).getTime() < new Date(nowIso).getTime()) {
    return { ok: false, discountAmount: 0, error: 'انتهت صلاحية كود الخصم.' };
  }
  if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
    return { ok: false, discountAmount: 0, error: 'تم استنفاد الحد الأقصى لاستخدام هذا الكود.' };
  }
  if (subtotal < promo.min_order_amount) {
    return {
      ok: false,
      discountAmount: 0,
      error: `الحد الأدنى لاستخدام الكود هو ${promo.min_order_amount.toLocaleString()} ج.م.`,
    };
  }
  const rawDiscount =
    promo.discount_type === 'percent'
      ? Math.round((subtotal * promo.discount_value) / 100)
      : Math.round(promo.discount_value);
  const discountAmount = Math.min(subtotal, Math.max(0, rawDiscount));
  return { ok: true, discountAmount };
}

/**
 * تطبيع الـ Slug الخاص بصفحات الهبوط التسويقية
 */
export function normalizeLandingSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * فلترة المنتجات لحظيًا حسب العنوان (عربي/إنجليزي)، الفئة، الشارة، وتفاصيل الخامة
 */
export function matchesProductSearch(product: Product, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    product.name_ar.toLowerCase().includes(q) ||
    product.name_en.toLowerCase().includes(q) ||
    product.category.toLowerCase().includes(q) ||
    (product.badge_text || '').toLowerCase().includes(q) ||
    (product.fabric_details || '').toLowerCase().includes(q)
  );
}

/**
 * التحقق من إمكانية تأكيد الدفع (منع التأكيد المزدوج - القسم السادس والتاسع عشر)
 */
export function validatePaymentConfirmation(currentPaymentStatus: PaymentStatus, method: PaymentMethod): {
  ok: boolean;
  error?: string;
} {
  if (method === 'Cash on Delivery') {
    return { ok: false, error: 'طلبات الدفع عند الاستلام يتم تحصيلها عبر زر التحصيل بعد التسليم.' };
  }
  if (currentPaymentStatus === 'Paid') {
    return { ok: false, error: 'تم تأكيد الدفع لهذا الطلب مسبقًا ولا يمكن تأكيده مرتين.' };
  }
  return { ok: true };
}

/**
 * التحقق من رفض الدفع: يشترط وجود سبب رفض غير فارغ (القسم السادس)
 */
export function validatePaymentRejection(
  currentPaymentStatus: PaymentStatus,
  reason: string
): { ok: boolean; error?: string } {
  if (currentPaymentStatus === 'Paid') {
    return { ok: false, error: 'لا يمكن رفض طلب تم تأكيد دفعه بالفعل.' };
  }
  if (!reason || reason.trim().length < 3) {
    return { ok: false, error: 'يجب كتابة سبب رفض الدفع بشكل واضح (خانة إلزامية).' };
  }
  return { ok: true };
}

/**
 * التحقق من أن تغيير حالة الطلب فعلي وليس حفظًا مكررًا لنفس الحالة (القسم الثامن)
 */
export function shouldSendStatusNotification(
  previousStatus: OrderStatus,
  newStatus: OrderStatus
): boolean {
  return previousStatus !== newStatus && Boolean(STATUS_TO_TEMPLATE_KEY[newStatus]);
}

/**
 * التحقق من توقيع Meta Webhook Signature (X-Hub-Signature-256) لمنع التزوير (القسم الثاني عشر والتاسع عشر)
 */
export function verifyMetaWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!appSecret) {
    // إذا لم يتم ضبط App Secret في البيئة التجريبية، لا يمكن التحقق المشفر في وضع الإنتاج
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const providedSig = signatureHeader.slice('sha256='.length);
  const expectedSig = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * توليد بصمة منع تكرار الطلبات المتطابقة خلال نافذة زمنية قصيرة (القسم التاسع عشر)
 */
export function buildOrderIdempotencyHash(params: {
  phone: string;
  paymentMethod: PaymentMethod;
  items: Array<{ product_id: number; size: string; quantity: number }>;
}): string {
  const normalizedPhone = normalizeWhatsAppPhone(params.phone);
  const canonicalItems = [...params.items]
    .sort((a, b) => `${a.product_id}-${a.size}`.localeCompare(`${b.product_id}-${b.size}`))
    .map((i) => `${i.product_id}:${i.size}:${i.quantity}`)
    .join('|');
  return crypto
    .createHash('sha256')
    .update(`${normalizedPhone}::${params.paymentMethod}::${canonicalItems}`)
    .digest('hex');
}

/**
 * فلترة وترتيب قائمة المنتجات بناءً على الفئة والبحث والتوافر بالمخزون والسعر
 */
export function filterAndSortProducts(
  products: Product[],
  options: {
    category?: string;
    query?: string;
    onlyInStock?: boolean;
    sortMode?: 'featured' | 'price-asc' | 'price-desc';
  }
): Product[] {
  const category = options.category || 'ALL';
  const query = options.query || '';
  const onlyInStock = Boolean(options.onlyInStock);
  const sortMode = options.sortMode || 'featured';

  const filtered = products.filter((p) => {
    if (category !== 'ALL' && p.category !== category) return false;
    if (!matchesProductSearch(p, query)) return false;
    if (onlyInStock) {
      const total = Object.values(p.sizes_stock || {}).reduce((sum, q) => sum + Number(q), 0);
      if (total <= 0) return false;
    }
    return true;
  });

  if (sortMode === 'price-asc') {
    return [...filtered].sort((a, b) => a.price - b.price);
  }
  if (sortMode === 'price-desc') {
    return [...filtered].sort((a, b) => b.price - a.price);
  }
  return filtered;
}

export type FitPreference = 'regular' | 'boxy' | 'oversized';

export interface SizeRecommendation {
  size: 'S' | 'M' | 'L' | 'XL';
  chestCm: number;
  lengthCm: number;
  shoulderCm: number;
  noteAr: string;
  noteEn: string;
}

const SIZE_SPECS: Record<'S' | 'M' | 'L' | 'XL', { chestCm: number; lengthCm: number; shoulderCm: number }> = {
  S: { chestCm: 58, lengthCm: 68, shoulderCm: 54 },
  M: { chestCm: 61, lengthCm: 71, shoulderCm: 57 },
  L: { chestCm: 64, lengthCm: 74, shoulderCm: 60 },
  XL: { chestCm: 67, lengthCm: 77, shoulderCm: 63 },
};

/**
 * حاسبة مقاس الستريت وير المثالي بناءً على الطول والوزن وتفضيل القصة
 */
export function recommendStreetwearSize(
  heightCm: number,
  weightKg: number,
  fitPreference: FitPreference = 'boxy'
): SizeRecommendation {
  const h = Math.max(150, Math.min(210, Number(heightCm) || 175));
  const w = Math.max(45, Math.min(140, Number(weightKg) || 72));

  let idx = 1; // M default
  if (h < 168 && w < 64) idx = 0; // S
  else if (h <= 177 && w <= 77) idx = 1; // M
  else if (h <= 186 && w <= 92) idx = 2; // L
  else idx = 3; // XL

  if (fitPreference === 'oversized' && idx < 3) {
    idx += 1;
  } else if (fitPreference === 'regular' && idx > 0 && w <= 85) {
    idx -= 1;
  }

  const order: Array<'S' | 'M' | 'L' | 'XL'> = ['S', 'M', 'L', 'XL'];
  const size = order[idx];
  const specs = SIZE_SPECS[size];

  const fitLabelsAr: Record<FitPreference, string> = {
    regular: 'قصة متزنة مضبوطة على الأكتاف',
    boxy: 'قصة Boxy المعمارية المميزة لـ YUOP',
    oversized: 'قصة أوفرسايز واسعة بطابع ستريت وير صريح',
  };
  const fitLabelsEn: Record<FitPreference, string> = {
    regular: 'Tailored balanced drape across shoulders',
    boxy: 'Signature YUOP architectural boxy cut',
    oversized: 'Dropped-shoulder relaxed oversized street fit',
  };

  return {
    size,
    ...specs,
    noteAr: fitLabelsAr[fitPreference],
    noteEn: fitLabelsEn[fitPreference],
  };
}


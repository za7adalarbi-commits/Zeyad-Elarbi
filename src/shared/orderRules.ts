/**
 * ============================================================================
 * YUOP Streetwear — قواعد العمل النقية (Pure Domain Logic)
 * هذا الملف يحتوي على جميع الدوال النقية القابلة للاختبار السريع عبر node:test
 * بدون الاعتماد على DOM أو Express أو node:crypto أو قاعدة البيانات مباشرة.
 * متوافق بالكامل مع المتصفح و Cloudflare Workers و Node.js.
 * ============================================================================
 */
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

const utf8Encoder = new TextEncoder();

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(input: Uint8Array): Uint8Array {
  const bitLen = input.length * 8;
  const paddedLen = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((val, idx) => outView.setUint32(idx * 4, val, false));
  return out;
}

function bytesToHexLower(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function hmacSha256HexSync(secret: string, data: Uint8Array): string {
  let keyBytes: Uint8Array = utf8Encoder.encode(secret);
  if (keyBytes.length > 64) {
    keyBytes = sha256Bytes(keyBytes);
  }
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  ipad.fill(0x36);
  opad.fill(0x5c);
  for (let i = 0; i < keyBytes.length; i++) {
    ipad[i] ^= keyBytes[i];
    opad[i] ^= keyBytes[i];
  }
  const inner = new Uint8Array(64 + data.length);
  inner.set(ipad);
  inner.set(data, 64);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(64 + 32);
  outer.set(opad);
  outer.set(innerHash, 64);
  return bytesToHexLower(sha256Bytes(outer));
}

/**
 * التحقق من توقيع Meta Webhook Signature (X-Hub-Signature-256) لمنع التزوير (القسم الثاني عشر والتاسع عشر)
 */
export function verifyMetaWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!appSecret) {
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const providedSig = signatureHeader.slice('sha256='.length).trim().toLowerCase();
  const data = typeof rawBody === 'string' ? utf8Encoder.encode(rawBody) : rawBody;
  const expectedSig = hmacSha256HexSync(appSecret, data);

  if (providedSig.length !== expectedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < providedSig.length; i++) {
    diff |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return diff === 0;
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
  return bytesToHexLower(
    sha256Bytes(utf8Encoder.encode(`${normalizedPhone}::${params.paymentMethod}::${canonicalItems}`))
  );
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


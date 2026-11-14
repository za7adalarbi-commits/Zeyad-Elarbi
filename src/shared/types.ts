/**
 * ============================================================================
 * YUOP Streetwear — ملف التعريفات والأنواع المشتركة (Shared Types)
 * يحتوي على جميع الحالات المطلوبة للطلبات، المدفوعات، الصلاحيات، وقوالب واتساب.
 * ============================================================================
 */

// حالات الطلبات المعتمدة في النظام (القسم ثامنًا)
export const ORDER_STATUSES = [
  'New Order',
  'Awaiting Payment',
  'Pending Confirmation',
  'Payment Review',
  'Payment Rejected',
  'Confirmed',
  'Preparing',
  'Ready for Shipping',
  'Shipped',
  'Out for Delivery',
  'Delivered',
  'Delivery Failed',
  'Returned',
  'Cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// طرق الدفع المدعومة في المتجر
export const PAYMENT_METHODS = [
  'Vodafone Cash',
  'InstaPay',
  'Cash on Delivery',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// حالات الدفع
export const PAYMENT_STATUSES = [
  'Unpaid',
  'Awaiting Receipt',
  'Under Review',
  'Paid',
  'Payment Rejected',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// أدوار وصلاحيات الموظفين (القسم سابع عشر)
export const STAFF_ROLES = [
  'Super Admin',
  'Admin',
  'Orders Manager',
  'Payment Reviewer',
  'Shipping Manager',
  'Customer Support',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

// قائمة الصلاحيات التفصيلية للتحكم الدقيق في كل إجراء
export const PERMISSIONS = [
  'view_dashboard',
  'view_orders',
  'manage_orders_status',
  'review_payments',
  'collect_cod',
  'manage_shipping',
  'send_whatsapp',
  'view_audit_logs',
  'manage_products',
  'manage_store_settings',
  'manage_landing_pages',
  'manage_social_links',
  'manage_promos',
  'manage_whatsapp_templates',
  'manage_whatsapp_api',
  'manage_staff',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// جدول الصلاحيات الافتراضي لكل دور وظيفي
export const ROLE_PERMISSIONS_MAP: Record<StaffRole, Permission[]> = {
  'Super Admin': [...PERMISSIONS],
  Admin: [
    'view_dashboard',
    'view_orders',
    'manage_orders_status',
    'review_payments',
    'collect_cod',
    'manage_shipping',
    'send_whatsapp',
    'view_audit_logs',
    'manage_products',
    'manage_store_settings',
    'manage_landing_pages',
    'manage_social_links',
    'manage_promos',
    'manage_whatsapp_templates',
    'manage_whatsapp_api',
  ],
  'Orders Manager': [
    'view_dashboard',
    'view_orders',
    'manage_orders_status',
    'manage_shipping',
    'send_whatsapp',
    'view_audit_logs',
  ],
  // موظف مراجعة المدفوعات: يؤكد أو يرفض الدفع فقط ولا يعدل إعدادات المتجر أو المنتجات
  'Payment Reviewer': [
    'view_dashboard',
    'view_orders',
    'review_payments',
    'collect_cod',
    'send_whatsapp',
  ],
  // موظف الشحن: يحدث بيانات وحالات التوصيل فقط ولا يعدل مفاتيح الدفع أو الواتساب
  'Shipping Manager': [
    'view_dashboard',
    'view_orders',
    'manage_orders_status',
    'manage_shipping',
    'collect_cod',
    'send_whatsapp',
  ],
  'Customer Support': [
    'view_dashboard',
    'view_orders',
    'send_whatsapp',
  ],
};

// أسباب رفض الدفع الجاهزة للاستخدام السريع (القسم سادسًا)
export const PRESET_REJECTION_REASONS = [
  'صورة الإيصال غير واضحة.',
  'المبلغ المحول غير مطابق.',
  'لم يتم استلام المبلغ.',
  'بيانات التحويل غير صحيحة.',
  'إيصال مكرر.',
] as const;

export type ThemeMode = 'light' | 'dark';

export const SOCIAL_PLATFORMS = [
  'instagram',
  'tiktok',
  'facebook',
  'youtube',
  'x',
  'snapchat',
  'whatsapp',
  'telegram',
  'website',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

// بنية المنتج في المتجر
export interface Product {
  id: number;
  slug: string;
  name_ar: string;
  name_en: string;
  category: string;
  price: number;
  compare_at_price: number | null;
  description_ar: string;
  description_en: string;
  fabric_details: string;
  image_url: string;
  secondary_image_url: string | null;
  sizes_stock: Record<string, number>; // مثال: { S: 5, M: 10, L: 8, XL: 4 }
  is_featured: boolean;
  is_active: boolean;
  badge_text: string | null;
  created_at: string;
}

// إعدادات المتجر القابلة للتخصيص بالكامل من الداشبورد
export interface StoreSettings {
  id: number;
  store_name: string;
  tagline_ar: string;
  tagline_en: string;
  announcement_enabled: boolean;
  announcement_text_ar: string;
  announcement_text_en: string;
  hero_kicker_ar: string;
  hero_kicker_en: string;
  hero_title_ar: string;
  hero_title_en: string;
  hero_subtitle_ar: string;
  hero_subtitle_en: string;
  hero_cta_ar: string;
  hero_cta_en: string;
  hero_image_url: string;
  accent_color: string;
  default_theme: ThemeMode;
  currency_code: string;
  currency_symbol_ar: string;
  shipping_fee: number;
  free_shipping_threshold: number;
  support_whatsapp: string;
  support_email: string;
  vodafone_cash_number: string;
  vodafone_cash_instructions_ar: string;
  instapay_address: string;
  instapay_instructions_ar: string;
  cod_enabled: boolean;
  vodafone_enabled: boolean;
  instapay_enabled: boolean;
  footer_about_ar: string;
  footer_about_en: string;
  updated_at: string;
}

// صفحة الهبوط التسويقية (Landing Page Builder)
export interface LandingPage {
  id: number;
  slug: string;
  title_ar: string;
  title_en: string;
  kicker_ar: string;
  kicker_en: string;
  subtitle_ar: string;
  subtitle_en: string;
  hero_image_url: string;
  cta_text_ar: string;
  cta_text_en: string;
  theme_style: ThemeMode;
  highlights: string[];
  featured_product_ids: number[];
  is_published: boolean;
  show_in_footer: boolean;
  views_count: number;
  created_at: string;
  updated_at: string;
}

// روابط حسابات التواصل الاجتماعي
export interface SocialLink {
  id: number;
  platform: SocialPlatform;
  label: string;
  handle: string | null;
  url: string;
  sort_order: number;
  is_active: boolean;
  updated_at: string;
}

// أكواد الخصم والعروض الترويجية
export interface PromoCode {
  id: number;
  code: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  min_order_amount: number;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

// ملخص بيانات العميل في دليل العملاء (CRM)
export interface CustomerSummary {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  governorate: string;
  address: string;
  orders_count: number;
  total_spent: number;
  last_order_at: string | null;
  created_at: string;
}

// تنبيهات انخفاض المخزون في لوحة التحكم
export interface LowStockAlert {
  product_id: number;
  product_name_ar: string;
  product_name_en: string;
  size: string;
  stock: number;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number | null;
  product_name_ar: string;
  product_name_en: string;
  size: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  image_url: string;
}

export interface PaymentRecord {
  id: number;
  order_id: number;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  cod_collected_by: string | null;
  cod_collected_at: string | null;
  updated_at: string;
}

export interface PaymentReceipt {
  id: number;
  order_id: number;
  payment_id: number;
  attempt_number: number;
  file_path: string;
  public_url: string;
  source: 'web' | 'whatsapp';
  whatsapp_media_id: string | null;
  status: 'Under Review' | 'Approved' | 'Rejected';
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  received_at: string;
}

export interface ShippingDetails {
  id: number;
  order_id: number;
  shipping_company: string | null;
  courier_name: string | null;
  courier_phone: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  shipped_at: string | null;
  expected_delivery_at: string | null;
  delivery_notes: string | null;
  delivery_failure_reason: string | null;
  updated_at: string;
}

export interface OrderStatusHistoryEntry {
  id: number;
  order_id: number;
  previous_status: OrderStatus | null;
  new_status: OrderStatus;
  employee_name: string;
  notes: string | null;
  created_at: string;
}

export interface WhatsAppMessageRecord {
  id: number;
  conversation_id: number | null;
  order_id: number | null;
  direction: 'outbound' | 'inbound';
  message_type: 'text' | 'image' | 'template' | 'interactive';
  template_key: string | null;
  recipient_phone: string;
  body: string;
  media_url: string | null;
  status: 'Pending' | 'Sent' | 'Delivered' | 'Read' | 'Failed' | 'Received';
  meta_message_id: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: number;
  order_id: number | null;
  order_number: string | null;
  employee_name: string;
  employee_role: string | null;
  action_type: string;
  details: string;
  created_at: string;
}

export interface NotificationTemplate {
  id: number;
  template_key: string;
  title_ar: string;
  description_ar: string;
  body: string;
  is_enabled: boolean;
  meta_template_name: string | null;
  updated_at: string;
}

export interface OrderSummary {
  id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  governorate: string;
  delivery_address: string;
  notes: string | null;
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  subtotal: number;
  discount_amount: number;
  promo_code: string | null;
  shipping_fee: number;
  total_amount: number;
  tracking_token: string;
  shipping_company: string | null;
  tracking_number: string | null;
  receipt_count: number;
  latest_receipt_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderDetail extends OrderSummary {
  items: OrderItem[];
  payment: PaymentRecord;
  receipts: PaymentReceipt[];
  shipping: ShippingDetails;
  status_history: OrderStatusHistoryEntry[];
  whatsapp_messages: WhatsAppMessageRecord[];
  audit_logs: AuditLogEntry[];
}

export interface DashboardStats {
  total_orders: number;
  new_orders: number;
  awaiting_payment: number;
  pending_confirmation: number;
  payment_review: number;
  confirmed_payments: number;
  rejected_payments: number;
  cod_orders: number;
  preparing_orders: number;
  shipped_orders: number;
  out_for_delivery_orders: number;
  delivered_orders: number;
  cancelled_orders: number;
  total_revenue_paid: number;
}

export interface StaffUser {
  id: number;
  name: string;
  email: string;
  role: StaffRole;
  custom_permissions: Permission[] | null;
  is_active: boolean;
  created_at: string;
}

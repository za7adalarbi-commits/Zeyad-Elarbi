/**
 * ============================================================================
 * YUOP Streetwear — ملف الترجمة والمصطلحات (عربي / إنجليزي)
 * يوفر تسميات واضحة لحالات الطلبات والدفع والصلاحيات باللغتين.
 * ============================================================================
 */
import type { OrderStatus, PaymentMethod, PaymentStatus, Permission, StaffRole } from '../shared/types.ts';

export type Lang = 'ar' | 'en';

export const ORDER_STATUS_LABELS: Record<OrderStatus, { ar: string; en: string; tone: string }> = {
  'New Order': { ar: 'طلب جديد', en: 'New Order', tone: 'text-neutral-800 bg-neutral-100 border-neutral-300' },
  'Awaiting Payment': { ar: 'بانتظار الدفع', en: 'Awaiting Payment', tone: 'text-amber-800 bg-amber-50 border-amber-300' },
  'Pending Confirmation': { ar: 'بانتظار التأكيد', en: 'Pending Confirmation', tone: 'text-amber-800 bg-amber-50 border-amber-300' },
  'Payment Review': { ar: 'مراجعة الدفع', en: 'Payment Review', tone: 'text-blue-800 bg-blue-50 border-blue-300' },
  'Payment Rejected': { ar: 'الدفع مرفوض', en: 'Payment Rejected', tone: 'text-red-800 bg-red-50 border-red-300' },
  Confirmed: { ar: 'تم تأكيد الطلب', en: 'Confirmed', tone: 'text-emerald-800 bg-emerald-50 border-emerald-300' },
  Preparing: { ar: 'جاري تجهيز الطلب', en: 'Preparing', tone: 'text-indigo-800 bg-indigo-50 border-indigo-300' },
  'Ready for Shipping': { ar: 'جاهز للشحن', en: 'Ready for Shipping', tone: 'text-cyan-800 bg-cyan-50 border-cyan-300' },
  Shipped: { ar: 'تم شحن الطلب', en: 'Shipped', tone: 'text-sky-800 bg-sky-50 border-sky-300' },
  'Out for Delivery': { ar: 'خرج للتوصيل', en: 'Out for Delivery', tone: 'text-violet-800 bg-violet-50 border-violet-300' },
  Delivered: { ar: 'تم تسليم الطلب', en: 'Delivered', tone: 'text-emerald-900 bg-emerald-100 border-emerald-400' },
  'Delivery Failed': { ar: 'تعذر التسليم', en: 'Delivery Failed', tone: 'text-red-800 bg-red-50 border-red-300' },
  Returned: { ar: 'تم إرجاع الطلب', en: 'Returned', tone: 'text-orange-800 bg-orange-50 border-orange-300' },
  Cancelled: { ar: 'تم إلغاء الطلب', en: 'Cancelled', tone: 'text-neutral-600 bg-neutral-100 border-neutral-300' },
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, { ar: string; en: string; tone: string }> = {
  Unpaid: { ar: 'غير مدفوع', en: 'Unpaid', tone: 'text-neutral-700 bg-neutral-100 border-neutral-300' },
  'Awaiting Receipt': { ar: 'بانتظار الإيصال', en: 'Awaiting Receipt', tone: 'text-amber-800 bg-amber-50 border-amber-300' },
  'Under Review': { ar: 'قيد المراجعة', en: 'Under Review', tone: 'text-blue-800 bg-blue-50 border-blue-300' },
  Paid: { ar: 'مدفوع', en: 'Paid', tone: 'text-emerald-800 bg-emerald-50 border-emerald-300' },
  'Payment Rejected': { ar: 'الدفع مرفوض', en: 'Payment Rejected', tone: 'text-red-800 bg-red-50 border-red-300' },
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, { ar: string; en: string }> = {
  'Vodafone Cash': { ar: 'فودافون كاش', en: 'Vodafone Cash' },
  InstaPay: { ar: 'إنستا باي (InstaPay)', en: 'InstaPay' },
  'Cash on Delivery': { ar: 'الدفع عند الاستلام', en: 'Cash on Delivery' },
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  'Super Admin': 'مدير عام (Super Admin)',
  Admin: 'مدير متجر (Admin)',
  'Orders Manager': 'مدير الطلبات (Orders Manager)',
  'Payment Reviewer': 'مراجع المدفوعات (Payment Reviewer)',
  'Shipping Manager': 'مدير الشحن (Shipping Manager)',
  'Customer Support': 'دعم العملاء (Customer Support)',
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  view_dashboard: 'عرض لوحة الإحصائيات',
  view_orders: 'عرض تفاصيل الطلبات',
  manage_orders_status: 'تحديث حالات الطلبات',
  review_payments: 'تأكيد ورفض المدفوعات',
  collect_cod: 'تسجيل تحصيل الدفع عند الاستلام',
  manage_shipping: 'إدارة بيانات الشحن والتتبع',
  send_whatsapp: 'إرسال وإعادة إرسال رسائل واتساب',
  view_audit_logs: 'الاطلاع على سجل العمليات (Audit Log)',
  manage_products: 'إضافة وتعديل وحذف المنتجات',
  manage_store_settings: 'تخصيص مظهر وإعدادات المتجر',
  manage_landing_pages: 'إنشاء وإدارة صفحات الهبوط التسويقية',
  manage_social_links: 'تعديل وإضافة حسابات التواصل الاجتماعي',
  manage_promos: 'إدارة أكواد الخصم والعروض الترويجية',
  manage_whatsapp_templates: 'تعديل قوالب رسائل واتساب',
  manage_whatsapp_api: 'إعدادات ربط WhatsApp Cloud API',
  manage_staff: 'إدارة الموظفين والصلاحيات',
};

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

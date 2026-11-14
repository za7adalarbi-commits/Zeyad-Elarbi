/**
 * ============================================================================
 * صفحة تتبع الطلب ورفع / إعادة رفع إيصال الدفع للعميل
 * تتيح للعميل متابعة حالة طلبه، رؤية سبب الرفض إن وجد، وإرسال إيصال جديد.
 * ============================================================================
 */
import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Search,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Truck,
  Copy,
  Check,
  Clock,
  ExternalLink,
} from 'lucide-react';
import type { OrderDetail, StoreSettings } from '../shared/types.ts';
import {
  formatDateTime,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type Lang,
} from '../lib/i18n.ts';
import { trackStoreOrder, uploadOrderReceipt } from '../lib/api.ts';
import { ImageWithFallback } from './ImageWithFallback.tsx';

interface OrderTrackingViewProps {
  initialOrder: OrderDetail | null;
  settings: StoreSettings;
  lang: Lang;
  onOrderUpdated: (order: OrderDetail) => void;
  onBackToShop: () => void;
}

export function OrderTrackingView({
  initialOrder,
  settings,
  lang,
  onOrderUpdated,
  onBackToShop,
}: OrderTrackingViewProps) {
  const [order, setOrder] = useState<OrderDetail | null>(initialOrder);
  const [searchNumber, setSearchNumber] = useState(initialOrder?.order_number || '');
  const [searchPhone, setSearchPhone] = useState(initialOrder?.customer_phone || '');
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleLookup = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSearching(true);
    try {
      const res = await trackStoreOrder({ orderNumber: searchNumber, phone: searchPhone });
      setOrder(res.order);
      onOrderUpdated(res.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'لم يتم العثور على الطلب');
    } finally {
      setSearching(false);
    }
  };

  const handleCopy = (val: string) => {
    navigator.clipboard?.writeText(val);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !order) return;
    setError(null);
    setUploadSuccess(null);

    if (file.size > 5 * 1024 * 1024) {
      setError('حجم الصورة يتجاوز الحد الأقصى (5 ميجابايت).');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = String(reader.result || '');
      setUploading(true);
      try {
        const res = await uploadOrderReceipt({
          orderNumber: order.order_number,
          tracking_token: order.tracking_token,
          phone: order.customer_phone,
          image_base64: base64,
        });
        setOrder(res.order);
        onOrderUpdated(res.order);
        setUploadSuccess(
          lang === 'ar'
            ? 'تم استلام صورة الإيصال بنجاح وتحويل الطلب لمراجعة الدفع.'
            : 'Receipt received and queued for payment review.'
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'فشل رفع صورة الإيصال');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const canUploadReceipt =
    order &&
    (order.payment_method === 'Vodafone Cash' || order.payment_method === 'InstaPay') &&
    order.payment_status !== 'Paid' &&
    order.status !== 'Cancelled';

  return (
    <section className="mx-auto max-w-5xl px-4 py-10 text-[#111111] sm:px-6 dark:text-[#F5F5F2]">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E2DD] pb-6 dark:border-[#2A2A27]">
        <div>
          <h1 className="text-2xl font-bold text-[#111111] dark:text-[#F5F5F2]">
            {lang === 'ar' ? 'تتبع الطلب وتأكيد الدفع' : 'Order Tracking & Receipt Upload'}
          </h1>
          <p className="mt-1 text-sm text-[#5C5C58] dark:text-[#A8A8A0]">
            {lang === 'ar'
              ? 'تابع حالة طلبك خطوة بخطوة أو ارفع إيصال التحويل لمراجعته فورًا.'
              : 'Track your shipment timeline or upload/re-upload your transfer receipt.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onBackToShop}
          className="h-10 border border-[#E2E2DD] bg-white px-4 text-xs font-semibold text-[#111111] hover:border-[#111111] dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#F5F5F2] dark:hover:border-[#F5F5F2]"
        >
          {lang === 'ar' ? 'العودة للتسوق' : 'Back to Shop'}
        </button>
      </div>

      {/* نموذج البحث برقم الطلب والهاتف */}
      <form onSubmit={handleLookup} className="mt-6 grid grid-cols-1 gap-3 border border-[#E2E2DD] bg-white p-4 sm:grid-cols-3 dark:border-[#2A2A27] dark:bg-[#161614]">
        <div>
          <label htmlFor="trk-num" className="block text-xs font-semibold">
            {lang === 'ar' ? 'رقم الطلب' : 'Order Number'}
          </label>
          <input
            id="trk-num"
            type="text"
            required
            value={searchNumber}
            onChange={(e) => setSearchNumber(e.target.value)}
            placeholder="YUOP-1001"
            className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 font-mono-tabular text-sm focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
          />
        </div>
        <div>
          <label htmlFor="trk-phone" className="block text-xs font-semibold">
            {lang === 'ar' ? 'رقم الهاتف المسجل' : 'Registered Phone'}
          </label>
          <input
            id="trk-phone"
            type="tel"
            required
            value={searchPhone}
            onChange={(e) => setSearchPhone(e.target.value)}
            placeholder="01023456789"
            className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 font-mono-tabular text-sm focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={searching}
            className="flex h-10 w-full items-center justify-center gap-2 bg-[#111111] px-4 text-sm font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
          >
            <Search className="h-4 w-4" />
            <span>{searching ? 'جاري البحث...' : lang === 'ar' ? 'بحث عن الطلب' : 'Find Order'}</span>
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200" role="alert">
          {error}
        </div>
      )}

      {uploadSuccess && (
        <div className="mt-4 flex items-center gap-2 border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200" role="status">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{uploadSuccess}</span>
        </div>
      )}

      {order && (
        <div className="mt-8 space-y-6">
          {/* بطاقة ملخص الطلب */}
          <div className="border border-[#E2E2DD] bg-white p-6 dark:border-[#2A2A27] dark:bg-[#161614]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E2E2DD] pb-4 dark:border-[#2A2A27]">
              <div>
                <span className="text-xs text-[#5C5C58] dark:text-[#A8A8A0]">{lang === 'ar' ? 'رقم الطلب' : 'Order'}</span>
                <h2 dir="ltr" className="w-fit font-mono-tabular text-2xl font-bold">#{order.order_number}</h2>
                <p className="mt-1 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
                  {order.customer_name} · {order.governorate} · {formatDateTime(order.created_at)}
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs">
                <div className={`border px-3 py-1.5 font-semibold ${ORDER_STATUS_LABELS[order.status]?.tone || ''}`}>
                  {lang === 'ar' ? ORDER_STATUS_LABELS[order.status]?.ar : order.status}
                </div>
                <div className={`border px-3 py-1.5 font-semibold ${PAYMENT_STATUS_LABELS[order.payment_status]?.tone || ''}`}>
                  {lang === 'ar' ? PAYMENT_STATUS_LABELS[order.payment_status]?.ar : order.payment_status}
                </div>
              </div>
            </div>

            {/* إشعار رفض الدفع مع السبب وإتاحة إعادة الإرسال */}
            {order.payment_status === 'Payment Rejected' && (
              <div className="mt-5 border border-red-300 bg-red-50 p-4 text-sm text-red-900">
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{lang === 'ar' ? 'تم رفض إيصال الدفع' : 'Payment Receipt Rejected'}</span>
                </div>
                <p className="mt-1">
                  <strong>{lang === 'ar' ? 'سبب الرفض: ' : 'Reason: '}</strong>
                  {order.payment.rejection_reason}
                </p>
                <p className="mt-1 text-xs">
                  {lang === 'ar'
                    ? 'يمكنك إعادة رفع صورة إيصال واضحة أدناه أو إرسالها على واتساب لإعادة المراجعة فورًا.'
                    : 'Please upload a clearer receipt below or send it via WhatsApp for re-review.'}
                </p>
              </div>
            )}

            {/* تعليمات الدفع ورفع الإيصال (فودافون كاش / إنستا باي) */}
            {canUploadReceipt && (
              <div className="mt-5 border border-[#E2E2DD] bg-[#F6F6F4] p-5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
                <h3 className="text-base font-bold">
                  {order.payment_method === 'Vodafone Cash'
                    ? 'بيانات التحويل عبر فودافون كاش (Vodafone Cash)'
                    : 'بيانات التحويل عبر إنستا باي (InstaPay)'}
                </h3>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-[#E2E2DD] bg-white p-4 dark:border-[#2A2A27] dark:bg-[#161614]">
                  <div>
                    <span className="text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
                      {order.payment_method === 'Vodafone Cash' ? 'رقم المحفظة للتحويل:' : 'عنوان InstaPay للتحويل:'}
                    </span>
                    <div className="mt-0.5 font-mono-tabular text-lg font-bold">
                      {order.payment_method === 'Vodafone Cash'
                        ? settings.vodafone_cash_number
                        : settings.instapay_address}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-end">
                      <span className="text-xs text-[#5C5C58] dark:text-[#A8A8A0]">المبلغ المطلوب</span>
                      <div className="font-mono-tabular text-lg font-bold">
                        {order.total_amount.toLocaleString()} {settings.currency_symbol_ar}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          order.payment_method === 'Vodafone Cash'
                            ? settings.vodafone_cash_number
                            : settings.instapay_address
                        )
                      }
                      className="inline-flex h-10 items-center gap-1.5 border border-[#E2E2DD] px-3 text-xs font-semibold hover:border-[#111111] dark:border-[#2A2A27] dark:hover:border-[#F5F5F2]"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
                    </button>
                  </div>
                </div>

                <p className="mt-3 text-xs leading-relaxed text-[#5C5C58] dark:text-[#A8A8A0]">
                  {order.payment_method === 'Vodafone Cash'
                    ? settings.vodafone_cash_instructions_ar
                    : settings.instapay_instructions_ar}
                </p>

                <div className="mt-4">
                  <label
                    htmlFor="receipt-upload"
                    className="inline-flex cursor-pointer items-center gap-2 bg-[#111111] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
                  >
                    <Upload className="h-4 w-4" />
                    <span>
                      {uploading
                        ? 'جاري رفع الإيصال...'
                        : order.receipts.length > 0
                          ? 'إعادة إرسال إيصال جديد'
                          : 'رفع صورة إيصال التحويل'}
                    </span>
                  </label>
                  <input
                    id="receipt-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={uploading}
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </div>
              </div>
            )}

            {/* تفاصيل الشحن إن وجدت */}
            {order.shipping && (order.shipping.shipping_company || order.shipping.tracking_number) && (
              <div className="mt-5 border border-[#E2E2DD] bg-white p-4 dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <Truck className="h-4 w-4" />
                  <span>بيانات الشحن والتوصيل</span>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-[#5C5C58] sm:grid-cols-3 dark:text-[#A8A8A0]">
                  <div>شركة الشحن: <strong className="text-[#111111] dark:text-[#F5F5F2]">{order.shipping.shipping_company || '—'}</strong></div>
                  <div>رقم التتبع: <strong className="font-mono-tabular text-[#111111] dark:text-[#F5F5F2]">{order.shipping.tracking_number || '—'}</strong></div>
                  {order.shipping.tracking_url && (
                    <div>
                      <a
                        href={order.shipping.tracking_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-[#111111] underline dark:text-[#F5F5F2]"
                      >
                        <span>تتبع الشحنة</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* سجل الإيصالات المرفوعة */}
            {order.receipts.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-bold">سجل إيصالات الدفع المرفوعة ({order.receipts.length})</h3>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {order.receipts.map((rec) => (
                    <div key={rec.id} className="flex items-center gap-3 border border-[#E2E2DD] p-3 dark:border-[#2A2A27]">
                      <div className="h-16 w-16 shrink-0 overflow-hidden border border-[#E2E2DD] bg-[#F6F6F4] dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
                        <ImageWithFallback src={rec.public_url} alt={`إيصال #${rec.attempt_number}`} className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="font-semibold">
                          محاولة #{rec.attempt_number} · {rec.status}
                        </div>
                        <div className="mt-0.5 text-[#5C5C58] dark:text-[#A8A8A0]">{formatDateTime(rec.received_at)}</div>
                        {rec.rejection_reason && (
                          <div className="mt-1 text-red-700 dark:text-red-400">السبب: {rec.rejection_reason}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* الرحلة الزمنية Timeline */}
            <div className="mt-6 grid grid-cols-1 gap-6 border-t border-[#E2E2DD] pt-6 md:grid-cols-2 dark:border-[#2A2A27]">
              <div>
                <h3 className="text-sm font-bold">الرحلة الزمنية للطلب</h3>
                <ol className="mt-3 space-y-3">
                  {order.status_history.map((h) => (
                    <li key={h.id} className="flex gap-3 text-xs">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5C5C58] dark:text-[#A8A8A0]" />
                      <div>
                        <div className="font-semibold">
                          {ORDER_STATUS_LABELS[h.new_status]?.ar || h.new_status}
                        </div>
                        {h.notes && <div className="text-[#5C5C58] dark:text-[#A8A8A0]">{h.notes}</div>}
                        <div className="font-mono-tabular text-[11px] text-[#8A8A84]">{formatDateTime(h.created_at)}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <h3 className="text-sm font-bold">المنتجات المطلوبة</h3>
                <div className="mt-3 divide-y divide-[#E2E2DD] border border-[#E2E2DD] dark:divide-[#2A2A27] dark:border-[#2A2A27]">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-3 text-xs">
                      <div>
                        <div className="font-semibold">{item.product_name_ar}</div>
                        <div className="text-[#5C5C58] dark:text-[#A8A8A0]">المقاس: {item.size} × {item.quantity}</div>
                      </div>
                      <span className="font-mono-tabular font-semibold">{item.line_total.toLocaleString()} {settings.currency_symbol_ar}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 space-y-1 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
                  <div>طريقة الدفع: {PAYMENT_METHOD_LABELS[order.payment_method]?.ar}</div>
                  {order.discount_amount > 0 && (
                    <div className="font-semibold text-emerald-700 dark:text-emerald-400">
                      كود الخصم ({order.promo_code}): -{order.discount_amount.toLocaleString()} {settings.currency_symbol_ar}
                    </div>
                  )}
                  <div className="font-mono-tabular font-bold text-[#111111] dark:text-[#F5F5F2]">
                    الإجمالي النهائي: {order.total_amount.toLocaleString()} {settings.currency_symbol_ar}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

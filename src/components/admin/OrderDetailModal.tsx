/**
 * ============================================================================
 * نافذة تفاصيل الطلب الشاملة (Order Details Page / Modal) — القسم الرابع عشر
 * تعرض: بيانات العميل، المنتجات، الدفع والإيصالات مع أزرار Confirm / Reject،
 * تحصيل COD، تحديث حالة الطلب، بيانات الشحن، سجل رسائل WhatsApp مع Retry،
 * والرحلة الزمنية الكاملة Timeline + Audit Log.
 * ============================================================================
 */
import { useState, type FormEvent } from 'react';
import {
  X,
  CheckCircle2,
  XCircle,
  Truck,
  Send,
  RotateCcw,
  Banknote,
  Clock,
  AlertTriangle,
  ExternalLink,
  ZoomIn,
} from 'lucide-react';
import {
  ORDER_STATUSES,
  PRESET_REJECTION_REASONS,
  type OrderDetail,
  type OrderStatus,
  type Permission,
} from '../../shared/types.ts';
import {
  formatDateTime,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from '../../lib/i18n.ts';
import {
  collectOrderCod,
  confirmOrderPayment,
  rejectOrderPayment,
  retryWhatsAppMessageApi,
  sendTrackingWhatsAppApi,
  updateOrderShippingApi,
  updateOrderStatusApi,
} from '../../lib/api.ts';
import { ImageWithFallback } from '../ImageWithFallback.tsx';

interface OrderDetailModalProps {
  order: OrderDetail;
  permissions: Permission[];
  onClose: () => void;
  onUpdated: (order: OrderDetail) => void;
}

export function OrderDetailModal({ order, permissions, onClose, onUpdated }: OrderDetailModalProps) {
  const canReviewPayment = permissions.includes('review_payments');
  const canCollectCod = permissions.includes('collect_cod');
  const canManageStatus = permissions.includes('manage_orders_status');
  const canManageShipping = permissions.includes('manage_shipping');
  const canSendWhatsApp = permissions.includes('send_whatsapp');

  const [selectedStatus, setSelectedStatus] = useState<OrderStatus>(order.status);
  const [statusNotes, setStatusNotes] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [deliveryFailureReason, setDeliveryFailureReason] = useState(order.shipping?.delivery_failure_reason || '');

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [zoomReceiptUrl, setZoomReceiptUrl] = useState<string | null>(null);

  const [shippingCompany, setShippingCompany] = useState(order.shipping?.shipping_company || '');
  const [courierName, setCourierName] = useState(order.shipping?.courier_name || '');
  const [courierPhone, setCourierPhone] = useState(order.shipping?.courier_phone || '');
  const [trackingNumber, setTrackingNumber] = useState(order.shipping?.tracking_number || '');
  const [trackingUrl, setTrackingUrl] = useState(order.shipping?.tracking_url || '');
  const [expectedDelivery, setExpectedDelivery] = useState(order.shipping?.expected_delivery_at || '');
  const [deliveryNotes, setDeliveryNotes] = useState(order.shipping?.delivery_notes || '');

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const runAction = async (fn: () => Promise<void>) => {
    setFeedback(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'حدث خطأ أثناء تنفيذ العملية' });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPayment = () =>
    runAction(async () => {
      const res = await confirmOrderPayment(order.id);
      onUpdated(res.order);
      setSelectedStatus(res.order.status);
      setFeedback({ type: 'ok', text: 'تم تأكيد الدفع بنجاح وتحديث حالة الطلب وإرسال إشعار WhatsApp.' });
    });

  const handleRejectPayment = (e: FormEvent) => {
    e.preventDefault();
    runAction(async () => {
      const res = await rejectOrderPayment(order.id, rejectReason);
      onUpdated(res.order);
      setSelectedStatus(res.order.status);
      setShowRejectModal(false);
      setRejectReason('');
      setFeedback({ type: 'ok', text: 'تم رفض الدفع وحفظ السبب وإشعار العميل عبر WhatsApp.' });
    });
  };

  const handleCollectCod = () =>
    runAction(async () => {
      const res = await collectOrderCod(order.id);
      onUpdated(res.order);
      setFeedback({ type: 'ok', text: 'تم تسجيل تحصيل المبلغ النقدي وتحديث حالة الدفع إلى Paid.' });
    });

  const handleStatusSave = (e: FormEvent) => {
    e.preventDefault();
    runAction(async () => {
      const res = await updateOrderStatusApi({
        orderId: order.id,
        status: selectedStatus,
        notes: statusNotes || undefined,
        cancellation_reason: selectedStatus === 'Cancelled' ? cancellationReason : undefined,
        delivery_failure_reason: selectedStatus === 'Delivery Failed' ? deliveryFailureReason : undefined,
      });
      onUpdated(res.order);
      setStatusNotes('');
      setFeedback({
        type: 'ok',
        text: res.statusChanged
          ? 'تم تحديث حالة الطلب وتسجيل الموظف وإرسال إشعار WhatsApp.'
          : 'الحالة لم تتغير — لم يتم إرسال إشعار مكرر.',
      });
    });
  };

  const handleShippingSave = (e: FormEvent) => {
    e.preventDefault();
    runAction(async () => {
      const res = await updateOrderShippingApi(order.id, {
        shipping_company: shippingCompany || null,
        courier_name: courierName || null,
        courier_phone: courierPhone || null,
        tracking_number: trackingNumber || null,
        tracking_url: trackingUrl || null,
        expected_delivery_at: expectedDelivery || null,
        delivery_notes: deliveryNotes || null,
        delivery_failure_reason: deliveryFailureReason || null,
      });
      onUpdated(res.order);
      setFeedback({ type: 'ok', text: 'تم حفظ بيانات الشحن والتوصيل.' });
    });
  };

  const handleSendTracking = () =>
    runAction(async () => {
      const res = await sendTrackingWhatsAppApi(order.id);
      onUpdated(res.order);
      setFeedback({
        type: res.message?.status === 'Failed' ? 'err' : 'ok',
        text:
          res.message?.status === 'Failed'
            ? `تعذر إرسال رابط التتبع: ${res.message.error_message || 'تحقق من إعدادات واتساب'}`
            : 'تم إرسال بيانات الشحن ورابط التتبع للعميل عبر WhatsApp.',
      });
    });

  const handleRetryMsg = (msgId: number) =>
    runAction(async () => {
      const res = await retryWhatsAppMessageApi(msgId);
      const updatedMsgs = order.whatsapp_messages.map((m) => (m.id === msgId ? res.message : m));
      onUpdated({ ...order, whatsapp_messages: updatedMsgs });
      setFeedback({
        type: res.message.status === 'Failed' ? 'err' : 'ok',
        text:
          res.message.status === 'Failed'
            ? `فشلت إعادة المحاولة: ${res.message.error_message || ''}`
            : 'تمت إعادة إرسال الرسالة بنجاح.',
      });
    });

  const isElectronic = order.payment_method === 'Vodafone Cash' || order.payment_method === 'InstaPay';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`تفاصيل الطلب ${order.order_number}`}>
      <div className="relative flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden border border-[#E2E2DD] bg-[#F6F6F4] text-[#111111] dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#F5F5F2]">
        {/* الرأس */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E2DD] bg-white px-6 py-4 dark:border-[#2A2A27] dark:bg-[#161614]">
          <div>
            <div className="flex items-center gap-3">
              <h2 dir="ltr" className="font-mono-tabular text-xl font-bold">#{order.order_number}</h2>
              <span className={`border px-2.5 py-0.5 text-xs font-semibold ${ORDER_STATUS_LABELS[order.status]?.tone || ''}`}>
                {ORDER_STATUS_LABELS[order.status]?.ar}
              </span>
              <span className={`border px-2.5 py-0.5 text-xs font-semibold ${PAYMENT_STATUS_LABELS[order.payment_status]?.tone || ''}`}>
                {PAYMENT_STATUS_LABELS[order.payment_status]?.ar}
              </span>
            </div>
            <p className="mt-1 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
              {order.customer_name} · {order.customer_phone} · {formatDateTime(order.created_at)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق تفاصيل الطلب"
            className="flex h-10 w-10 items-center justify-center border border-[#E2E2DD] hover:bg-[#F6F6F4] dark:border-[#2A2A27] dark:hover:bg-[#22221F]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* التنبيهات */}
        {feedback && (
          <div
            role="status"
            className={`border-b px-6 py-3 text-xs font-semibold ${
              feedback.type === 'ok'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
                : 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* العمود الأيمن: العميل، المنتجات، الدفع والإيصالات، وتغيير الحالة */}
            <div className="space-y-6 lg:col-span-7">
              {/* بيانات العميل والعنوان */}
              <div className="border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
                <h3 className="text-sm font-bold">بيانات العميل والتوصيل</h3>
                <div className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-[#5C5C58]">العميل: </span>
                    <strong className="text-[#111111]">{order.customer_name}</strong>
                  </div>
                  <div>
                    <span className="text-[#5C5C58]">الهاتف: </span>
                    <strong className="font-mono-tabular text-[#111111]">{order.customer_phone}</strong>
                  </div>
                  <div>
                    <span className="text-[#5C5C58]">البريد: </span>
                    <strong className="text-[#111111]">{order.customer_email || '—'}</strong>
                  </div>
                  <div>
                    <span className="text-[#5C5C58]">المحافظة: </span>
                    <strong className="text-[#111111]">{order.governorate}</strong>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-[#5C5C58]">العنوان: </span>
                    <strong className="text-[#111111]">{order.delivery_address}</strong>
                  </div>
                  {order.notes && (
                    <div className="sm:col-span-2">
                      <span className="text-[#5C5C58]">ملاحظات العميل: </span>
                      <strong className="text-[#111111]">{order.notes}</strong>
                    </div>
                  )}
                </div>

                {/* جدول المنتجات */}
                <div className="mt-4 border-t border-[#E2E2DD] pt-4">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#E2E2DD] text-[#5C5C58]">
                        <th className="py-2 text-start font-semibold">المنتج</th>
                        <th className="py-2 text-center font-semibold">المقاس</th>
                        <th className="py-2 text-center font-semibold">الكمية</th>
                        <th className="py-2 text-end font-semibold">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E2DD]">
                      {order.items.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2.5 font-medium text-[#111111]">{item.product_name_ar}</td>
                          <td className="py-2.5 text-center font-mono-tabular">{item.size}</td>
                          <td className="py-2.5 text-center font-mono-tabular">{item.quantity}</td>
                          <td className="py-2.5 text-end font-mono-tabular font-semibold">{item.line_total.toLocaleString()} ج.م</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-[#E2E2DD] pt-3 text-xs dark:border-[#2A2A27]">
                    <span className="text-[#5C5C58] dark:text-[#A8A8A0]">
                      الفرعي: <strong className="font-mono-tabular text-[#111111] dark:text-[#F5F5F2]">{order.subtotal.toLocaleString()} ج.م</strong>
                      {order.discount_amount > 0 && (
                        <>
                          {' '}· الخصم ({order.promo_code}):{' '}
                          <strong className="font-mono-tabular text-emerald-700 dark:text-emerald-400">
                            -{order.discount_amount.toLocaleString()} ج.م
                          </strong>
                        </>
                      )}{' '}
                      · الشحن:{' '}
                      <strong className="font-mono-tabular text-[#111111] dark:text-[#F5F5F2]">{order.shipping_fee.toLocaleString()} ج.م</strong>
                    </span>
                    <span className="font-mono-tabular text-sm font-bold">
                      الإجمالي: {order.total_amount.toLocaleString()} ج.م
                    </span>
                  </div>
                </div>
              </div>

              {/* قسم مراجعة الدفع والإيصالات أو تحصيل COD */}
              <div className="border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-[#111111]">
                    إدارة الدفع ({PAYMENT_METHOD_LABELS[order.payment_method]?.ar})
                  </h3>
                  <span className={`border px-2.5 py-0.5 text-xs font-semibold ${PAYMENT_STATUS_LABELS[order.payment_status]?.tone || ''}`}>
                    {PAYMENT_STATUS_LABELS[order.payment_status]?.ar}
                  </span>
                </div>

                {isElectronic && (
                  <div className="mt-3 border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <strong>تنبيه مراجعة مهم: </strong>
                    لا يتم اعتبار صورة الإيصال إثباتًا نهائيًا لوصول المبلغ. يجب التحقق من التحويل فعليًا في المحفظة أو الحساب قبل تأكيد الدفع.
                  </div>
                )}

                {/* تفاصيل التأكيد أو الرفض أو التحصيل */}
                <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-[#5C5C58] sm:grid-cols-2">
                  {order.payment.confirmed_by && (
                    <div>
                      تأكيد بواسطة: <strong className="text-emerald-800">{order.payment.confirmed_by}</strong> ({formatDateTime(order.payment.confirmed_at)})
                    </div>
                  )}
                  {order.payment.rejected_by && (
                    <div className="text-red-800">
                      مرفوض بواسطة: <strong>{order.payment.rejected_by}</strong> — السبب: {order.payment.rejection_reason}
                    </div>
                  )}
                  {order.payment.cod_collected_by && (
                    <div>
                      تم التحصيل بواسطة: <strong className="text-emerald-800">{order.payment.cod_collected_by}</strong> ({formatDateTime(order.payment.cod_collected_at)})
                    </div>
                  )}
                </div>

                {/* أزرار تأكيد / رفض الدفع الإلكتروني */}
                {isElectronic && canReviewPayment && order.payment_status !== 'Paid' && (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleConfirmPayment}
                      className="inline-flex h-10 items-center gap-2 bg-emerald-700 px-4 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Confirm Payment – تأكيد الدفع</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setShowRejectModal(true)}
                      className="inline-flex h-10 items-center gap-2 bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" />
                      <span>Reject Payment – رفض الدفع</span>
                    </button>
                  </div>
                )}

                {/* زر تحصيل الدفع عند الاستلام (COD) */}
                {order.payment_method === 'Cash on Delivery' && canCollectCod && order.payment_status !== 'Paid' && (
                  <div className="mt-4">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleCollectCod}
                      className="inline-flex h-10 items-center gap-2 bg-emerald-700 px-4 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      <Banknote className="h-4 w-4" />
                      <span>تسجيل تحصيل المبلغ نقدًا (Mark COD Collected)</span>
                    </button>
                  </div>
                )}

                {/* سجل الإيصالات المرفوعة */}
                {isElectronic && (
                  <div className="mt-5 border-t border-[#E2E2DD] pt-4">
                    <h4 className="text-xs font-bold text-[#111111]">
                      سجل محاولات الإيصالات ({order.receipts.length})
                    </h4>
                    {order.receipts.length === 0 ? (
                      <p className="mt-2 text-xs text-[#5C5C58]">لم يتم استلام أي إيصال من العميل بعد.</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {order.receipts.map((r) => (
                          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border border-[#E2E2DD] p-3">
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => setZoomReceiptUrl(r.public_url)}
                                aria-label={`تكبير إيصال محاولة ${r.attempt_number}`}
                                className="group relative h-20 w-20 shrink-0 overflow-hidden border border-[#E2E2DD] bg-[#F6F6F4]"
                              >
                                <ImageWithFallback src={r.public_url} alt={`Receipt #${r.attempt_number}`} className="h-full w-full object-cover" />
                                <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                                  <ZoomIn className="h-4 w-4 text-white" />
                                </span>
                              </button>
                              <div className="text-xs">
                                <div className="font-bold text-[#111111]">
                                  محاولة #{r.attempt_number} · المصدر: {r.source === 'whatsapp' ? 'WhatsApp' : 'الموقع'}
                                </div>
                                <div className="mt-0.5 text-[#5C5C58]">تاريخ الاستلام: {formatDateTime(r.received_at)}</div>
                                <div className="mt-0.5 font-semibold text-[#111111]">الحالة: {r.status}</div>
                                {r.rejection_reason && (
                                  <div className="mt-0.5 text-red-700">سبب الرفض: {r.rejection_reason}</div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* تحديث حالة الطلب */}
              {canManageStatus && (
                <form onSubmit={handleStatusSave} className="border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
                  <h3 className="text-sm font-bold">تحديث حالة الطلب وإشعار العميل</h3>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="ord-status-select" className="block text-xs font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">
                        الحالة الجديدة
                      </label>
                      <select
                        id="ord-status-select"
                        value={selectedStatus}
                        onChange={(e) => setSelectedStatus(e.target.value as OrderStatus)}
                        className="mt-1 h-10 w-full border border-[#E2E2DD] bg-white px-3 text-xs font-semibold focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                      >
                        {ORDER_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {ORDER_STATUS_LABELS[st]?.ar} ({st})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="ord-status-notes" className="block text-xs font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">
                        ملاحظات داخلية (اختياري)
                      </label>
                      <input
                        id="ord-status-notes"
                        type="text"
                        value={statusNotes}
                        onChange={(e) => setStatusNotes(e.target.value)}
                        placeholder="تفاصيل إضافية للسجل..."
                        className="mt-1 h-10 w-full border border-[#E2E2DD] px-3 text-xs focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                      />
                    </div>
                  </div>

                  {selectedStatus === 'Cancelled' && (
                    <div className="mt-3">
                      <label htmlFor="ord-cancel-reason" className="block text-xs font-semibold text-red-700 dark:text-red-400">
                        سبب الإلغاء (يرسل للعميل في رسالة الإلغاء)
                      </label>
                      <input
                        id="ord-cancel-reason"
                        type="text"
                        value={cancellationReason}
                        onChange={(e) => setCancellationReason(e.target.value)}
                        placeholder="مثال: بناءً على رغبة العميل / نفاد الكمية"
                        className="mt-1 h-10 w-full border border-red-300 px-3 text-xs focus:border-red-600 focus:outline-none dark:border-red-800 dark:bg-[#0D0D0C]"
                      />
                    </div>
                  )}

                  {selectedStatus === 'Delivery Failed' && (
                    <div className="mt-3">
                      <label htmlFor="ord-fail-reason" className="block text-xs font-semibold text-red-700 dark:text-red-400">
                        سبب تعذر التسليم
                      </label>
                      <input
                        id="ord-fail-reason"
                        type="text"
                        value={deliveryFailureReason}
                        onChange={(e) => setDeliveryFailureReason(e.target.value)}
                        placeholder="مثال: الهاتف مغلق / العميل طلب التأجيل"
                        className="mt-1 h-10 w-full border border-red-300 px-3 text-xs focus:border-red-600 focus:outline-none dark:border-red-800 dark:bg-[#0D0D0C]"
                      />
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">
                      عند تغيير الحالة فعليًا يتم إرسال رسالة WhatsApp تلقائيًا (ولا تتكرر إذا لم تتغير الحالة).
                    </span>
                    <button
                      type="submit"
                      disabled={busy}
                      className="h-10 shrink-0 bg-[#111111] px-5 text-xs font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
                    >
                      حفظ الحالة
                    </button>
                  </div>
                </form>
              )}

              {/* بيانات الشحن والتوصيل */}
              <form onSubmit={handleShippingSave} className="border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4" />
                    <h3 className="text-sm font-bold">بيانات الشحن والتوصيل</h3>
                  </div>
                  {canSendWhatsApp && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleSendTracking}
                      className="inline-flex h-8 items-center gap-1.5 border border-[#111111] px-3 text-xs font-semibold hover:bg-[#111111] hover:text-white dark:border-[#F5F5F2] dark:hover:bg-[#F5F5F2] dark:hover:text-[#111111]"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>إرسال رابط التتبع WhatsApp</span>
                    </button>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <label className="block font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">شركة الشحن</label>
                    <input
                      type="text"
                      disabled={!canManageShipping}
                      value={shippingCompany}
                      onChange={(e) => setShippingCompany(e.target.value)}
                      placeholder="Bosta / Aramex / Mylerz"
                      className="mt-1 h-9 w-full border border-[#E2E2DD] px-2.5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">رقم التتبع</label>
                    <input
                      type="text"
                      disabled={!canManageShipping}
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      placeholder="BST-123456"
                      className="mt-1 h-9 w-full border border-[#E2E2DD] px-2.5 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">رابط تتبع الشحنة</label>
                    <div className="mt-1 flex gap-2">
                      <input
                        type="url"
                        disabled={!canManageShipping}
                        value={trackingUrl}
                        onChange={(e) => setTrackingUrl(e.target.value)}
                        placeholder="https://..."
                        className="h-9 flex-1 border border-[#E2E2DD] px-2.5 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                      />
                      {trackingUrl && (
                        <a
                          href={trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center border border-[#E2E2DD] px-3 hover:border-[#111111] dark:border-[#2A2A27]"
                          aria-label="فتح رابط التتبع"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">اسم المندوب</label>
                    <input
                      type="text"
                      disabled={!canManageShipping}
                      value={courierName}
                      onChange={(e) => setCourierName(e.target.value)}
                      className="mt-1 h-9 w-full border border-[#E2E2DD] px-2.5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">رقم هاتف المندوب</label>
                    <input
                      type="tel"
                      disabled={!canManageShipping}
                      value={courierPhone}
                      onChange={(e) => setCourierPhone(e.target.value)}
                      className="mt-1 h-9 w-full border border-[#E2E2DD] px-2.5 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">موعد التوصيل المتوقع</label>
                    <input
                      type="date"
                      disabled={!canManageShipping}
                      value={expectedDelivery}
                      onChange={(e) => setExpectedDelivery(e.target.value)}
                      className="mt-1 h-9 w-full border border-[#E2E2DD] px-2.5 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">ملاحظات التوصيل</label>
                    <input
                      type="text"
                      disabled={!canManageShipping}
                      value={deliveryNotes}
                      onChange={(e) => setDeliveryNotes(e.target.value)}
                      className="mt-1 h-9 w-full border border-[#E2E2DD] px-2.5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                    />
                  </div>
                </div>

                {canManageShipping && (
                  <div className="mt-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={busy}
                      className="h-9 bg-[#111111] px-4 text-xs font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
                    >
                      حفظ بيانات الشحن
                    </button>
                  </div>
                )}
              </form>
            </div>

            {/* العمود الأيسر: سجل رسائل WhatsApp + Timeline + سجل المراجعة */}
            <div className="space-y-6 lg:col-span-5">
              {/* سجل رسائل WhatsApp مع زر إعادة الإرسال للفشل */}
              <div className="border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
                <h3 className="text-sm font-bold">
                  سجل رسائل WhatsApp ({order.whatsapp_messages.length})
                </h3>
                <div className="mt-3 max-h-72 space-y-2.5 overflow-y-auto">
                  {order.whatsapp_messages.length === 0 ? (
                    <p className="text-xs text-[#5C5C58] dark:text-[#A8A8A0]">لا توجد رسائل مسجلة لهذا الطلب بعد.</p>
                  ) : (
                    order.whatsapp_messages.map((m) => (
                      <div key={m.id} className="border border-[#E2E2DD] p-3 text-xs dark:border-[#2A2A27]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">
                            {m.direction === 'outbound' ? 'صادر' : 'وارد'} · {m.template_key || m.message_type}
                          </span>
                          <span
                            className={`border px-2 py-0.5 text-[11px] font-semibold ${
                              m.status === 'Failed'
                                ? 'border-red-300 bg-red-50 text-red-800'
                                : m.status === 'Sent' || m.status === 'Delivered' || m.status === 'Read'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                  : 'border-neutral-300 bg-neutral-100 text-neutral-700'
                            }`}
                          >
                            {m.status}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-line text-[#5C5C58] dark:text-[#A8A8A0]">{m.body}</p>
                        {m.error_message && (
                          <div className="mt-2 flex items-center justify-between gap-2 bg-red-50 p-2 text-red-800 dark:bg-red-950/60 dark:text-red-200">
                            <span>{m.error_message}</span>
                            {canSendWhatsApp && m.status === 'Failed' && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleRetryMsg(m.id)}
                                className="inline-flex shrink-0 items-center gap-1 bg-red-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-800"
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>إعادة إرسال</span>
                              </button>
                            )}
                          </div>
                        )}
                        <div className="mt-1.5 font-mono-tabular text-[11px] text-[#8A8A84]">
                          {formatDateTime(m.created_at)} {m.retry_count > 0 ? `· محاولات إعادة: ${m.retry_count}` : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Timeline رحلة الطلب الزمنية */}
              <div className="border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
                <h3 className="text-sm font-bold">الرحلة الزمنية للطلب (Timeline)</h3>
                <ol className="mt-3 space-y-3">
                  {order.status_history.map((h) => (
                    <li key={h.id} className="flex gap-3 border-b border-[#F0F0EC] pb-2.5 text-xs last:border-b-0 dark:border-[#2A2A27]">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5C5C58] dark:text-[#A8A8A0]" />
                      <div>
                        <div className="font-semibold">
                          {h.previous_status ? `${ORDER_STATUS_LABELS[h.previous_status]?.ar} ← ` : ''}
                          {ORDER_STATUS_LABELS[h.new_status]?.ar || h.new_status}
                        </div>
                        {h.notes && <div className="text-[#5C5C58] dark:text-[#A8A8A0]">{h.notes}</div>}
                        <div className="mt-0.5 font-mono-tabular text-[11px] text-[#8A8A84]">
                          {h.employee_name} · {formatDateTime(h.created_at)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              {/* سجل عمليات الطلب Audit */}
              <div className="border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
                <h3 className="text-sm font-bold">سجل العمليات على الطلب</h3>
                <div className="mt-3 max-h-60 space-y-2 overflow-y-auto text-xs">
                  {order.audit_logs.map((log) => (
                    <div key={log.id} className="border-b border-[#F0F0EC] pb-2 last:border-b-0 dark:border-[#2A2A27]">
                      <div className="flex justify-between font-semibold">
                        <span>{log.action_type}</span>
                        <span className="font-mono-tabular text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">{log.employee_name}</span>
                      </div>
                      <p className="mt-0.5 text-[#5C5C58] dark:text-[#A8A8A0]">{log.details}</p>
                      <span className="font-mono-tabular text-[11px] text-[#8A8A84]">{formatDateTime(log.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* نافذة رفض الدفع الإلزامية */}
      {showRejectModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="سبب رفض الدفع">
          <form onSubmit={handleRejectPayment} className="w-full max-w-md border border-[#E2E2DD] bg-white p-6 dark:border-[#2A2A27] dark:bg-[#161614]">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="text-base font-bold">رفض الدفع — كتابة السبب إلزامية</h3>
            </div>
            <p className="mt-1 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
              سيتم حفظ سبب الرفض وإرساله للعميل عبر WhatsApp مع السماح له بإعادة رفع إيصال جديد.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {PRESET_REJECTION_REASONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setRejectReason(preset)}
                  className="border border-[#E2E2DD] bg-[#F6F6F4] px-2.5 py-1 text-[11px] font-medium hover:border-[#111111] dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="mt-4">
              <label htmlFor="reject-reason-input" className="block text-xs font-semibold">
                سبب الرفض *
              </label>
              <textarea
                id="reject-reason-input"
                required
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="اكتب سبب رفض الإيصال بوضوح..."
                className="mt-1 w-full border border-[#E2E2DD] p-3 text-xs focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="h-9 border border-[#E2E2DD] px-4 text-xs font-semibold dark:border-[#2A2A27]"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={busy || rejectReason.trim().length < 3}
                className="h-9 bg-red-700 px-4 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                تأكيد رفض الدفع
              </button>
            </div>
          </form>
        </div>
      )}

      {/* نافذة تكبير الإيصال */}
      {zoomReceiptUrl && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6"
          role="dialog"
          aria-modal="true"
          aria-label="عرض صورة الإيصال"
        >
          <button
            type="button"
            onClick={() => setZoomReceiptUrl(null)}
            aria-label="إغلاق معاينة الإيصال"
            className="absolute top-5 left-5 flex h-10 w-10 items-center justify-center bg-white text-[#111111]"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={zoomReceiptUrl}
            alt="صورة إيصال التحويل"
            className="max-h-[88vh] max-w-full border border-white/20 object-contain"
          />
        </div>
      )}
    </div>
  );
}

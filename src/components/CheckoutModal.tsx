/**
 * ============================================================================
 * نافذة إتمام الطلب (Checkout Modal)
 * تدعم فودافون كاش، إنستا باي، والدفع عند الاستلام، وتطبيق أكواد الخصم.
 * ============================================================================
 */
import { useState, type FormEvent } from 'react';
import { X, Smartphone, Landmark, Banknote, AlertCircle, Tag, Check } from 'lucide-react';
import type { OrderDetail, PaymentMethod, StoreSettings } from '../shared/types.ts';
import type { Lang } from '../lib/i18n.ts';
import { calculateOrderTotals } from '../shared/orderRules.ts';
import { createStoreOrder, validatePromoApi } from '../lib/api.ts';
import type { CartItem } from './CartDrawer.tsx';

interface CheckoutModalProps {
  items: CartItem[];
  settings: StoreSettings;
  lang: Lang;
  onClose: () => void;
  onOrderCreated: (order: OrderDetail) => void;
}

const GOVERNORATES = [
  'القاهرة',
  'الجيزة',
  'الإسكندرية',
  'الدقهلية',
  'الشرقية',
  'الغربية',
  'القليوبية',
  'المنوفية',
  'البحيرة',
  'بورسعيد',
  'الإسماعيلية',
  'السويس',
  'أسيوط',
  'المنيا',
  'سوهاج',
];

export function CheckoutModal({ items, settings, lang, onClose, onOrderCreated }: CheckoutModalProps) {
  const defaultMethod: PaymentMethod = settings.vodafone_enabled
    ? 'Vodafone Cash'
    : settings.instapay_enabled
      ? 'InstaPay'
      : 'Cash on Delivery';

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [governorate, setGovernorate] = useState('القاهرة');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(defaultMethod);
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discountAmount: number } | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseTotals = calculateOrderTotals(
    items.map((i) => ({ unit_price: i.product.price, quantity: i.quantity })),
    settings.shipping_fee,
    settings.free_shipping_threshold,
    0
  );

  const totals = calculateOrderTotals(
    items.map((i) => ({ unit_price: i.product.price, quantity: i.quantity })),
    settings.shipping_fee,
    settings.free_shipping_threshold,
    appliedPromo?.discountAmount || 0
  );

  const handleApplyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return;
    setPromoBusy(true);
    setPromoMsg(null);
    try {
      const res = await validatePromoApi(code, baseTotals.subtotal);
      setAppliedPromo({ code: res.code, discountAmount: res.discount_amount });
      setPromoMsg({
        ok: true,
        text:
          lang === 'ar'
            ? `تم تطبيق الكود ${res.code} بخصم ${res.discount_amount.toLocaleString()} ${settings.currency_symbol_ar}`
            : `Applied ${res.code}: -${res.discount_amount} ${settings.currency_code}`,
      });
    } catch (err) {
      setAppliedPromo(null);
      setPromoMsg({
        ok: false,
        text: err instanceof Error ? err.message : 'كود الخصم غير صالح',
      });
    } finally {
      setPromoBusy(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!customerName.trim() || !customerPhone.trim() || !deliveryAddress.trim()) {
      setError(lang === 'ar' ? 'يرجى تعبئة الاسم ورقم الواتساب وعنوان التوصيل بالكامل.' : 'Please fill all required fields.');
      return;
    }

    setSubmitting(true);
    try {
      const { order } = await createStoreOrder({
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customer_email: customerEmail.trim() || undefined,
        governorate,
        delivery_address: deliveryAddress.trim(),
        notes: notes.trim() || undefined,
        payment_method: paymentMethod,
        promo_code: appliedPromo?.code,
        items: items.map((i) => ({
          product_id: i.product.id,
          size: i.size,
          quantity: i.quantity,
        })),
      });
      onOrderCreated(order);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الطلب');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={lang === 'ar' ? 'إتمام الطلب' : 'Checkout'}>
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto border border-[#E2E2DD] bg-white p-6 text-[#111111] md:p-8 dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#F5F5F2]">
        <div className="flex items-center justify-between border-b border-[#E2E2DD] pb-4 dark:border-[#2A2A27]">
          <div>
            <h2 className="text-xl font-bold text-[#111111] dark:text-[#F5F5F2]">
              {lang === 'ar' ? 'إتمام الطلب' : 'Complete Your Order'}
            </h2>
            <p className="mt-0.5 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
              {lang === 'ar'
                ? 'ستصلك رسالة تأكيد وتحديثات الشحن مباشرة على رقم الواتساب الخاص بك.'
                : 'Order confirmation and tracking updates are sent straight to your WhatsApp.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'ar' ? 'إغلاق إتمام الطلب' : 'Close checkout'}
            className="flex h-10 w-10 items-center justify-center border border-[#E2E2DD] hover:bg-[#F6F6F4] dark:border-[#2A2A27] dark:hover:bg-[#22221F]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200" role="alert">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="chk-name" className="block text-xs font-semibold">
                {lang === 'ar' ? 'الاسم الكامل *' : 'Full Name *'}
              </label>
              <input
                id="chk-name"
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder={lang === 'ar' ? 'مثال: أحمد محمود' : 'Full name'}
                className="mt-1.5 h-11 w-full border border-[#E2E2DD] px-3 text-sm focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:focus:border-[#F5F5F2]"
              />
            </div>

            <div>
              <label htmlFor="chk-phone" className="block text-xs font-semibold">
                {lang === 'ar' ? 'رقم الهاتف (WhatsApp) *' : 'WhatsApp Phone *'}
              </label>
              <input
                id="chk-phone"
                type="tel"
                required
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="01012345678"
                className="mt-1.5 h-11 w-full border border-[#E2E2DD] px-3 font-mono-tabular text-sm focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:focus:border-[#F5F5F2]"
              />
            </div>

            <div>
              <label htmlFor="chk-gov" className="block text-xs font-semibold">
                {lang === 'ar' ? 'المحافظة *' : 'Governorate *'}
              </label>
              <select
                id="chk-gov"
                value={governorate}
                onChange={(e) => setGovernorate(e.target.value)}
                className="mt-1.5 h-11 w-full border border-[#E2E2DD] bg-white px-3 text-sm focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:focus:border-[#F5F5F2]"
              >
                {GOVERNORATES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="chk-email" className="block text-xs font-semibold">
                {lang === 'ar' ? 'البريد الإلكتروني (اختياري)' : 'Email (Optional)'}
              </label>
              <input
                id="chk-email"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="name@example.com"
                className="mt-1.5 h-11 w-full border border-[#E2E2DD] px-3 text-sm focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:focus:border-[#F5F5F2]"
              />
            </div>
          </div>

          <div>
            <label htmlFor="chk-addr" className="block text-xs font-semibold">
              {lang === 'ar' ? 'عنوان التوصيل بالتفصيل *' : 'Delivery Address *'}
            </label>
            <input
              id="chk-addr"
              type="text"
              required
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder={lang === 'ar' ? 'الشارع، رقم العمارة، الدور، الشقة، علامة مميزة' : 'Street, building, floor'}
              className="mt-1.5 h-11 w-full border border-[#E2E2DD] px-3 text-sm focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:focus:border-[#F5F5F2]"
            />
          </div>

          <div>
            <label htmlFor="chk-notes" className="block text-xs font-semibold">
              {lang === 'ar' ? 'ملاحظات التوصيل (اختياري)' : 'Delivery Notes (Optional)'}
            </label>
            <input
              id="chk-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={lang === 'ar' ? 'مثال: التوصيل بعد الساعة 5 مساءً' : 'Deliver after 5 PM'}
              className="mt-1.5 h-11 w-full border border-[#E2E2DD] px-3 text-sm focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:focus:border-[#F5F5F2]"
            />
          </div>

          {/* كود الخصم */}
          <div className="border border-[#E2E2DD] bg-[#F6F6F4] p-3.5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
            <label htmlFor="chk-promo" className="flex items-center gap-1.5 text-xs font-semibold">
              <Tag className="h-3.5 w-3.5" />
              <span>{lang === 'ar' ? 'كود الخصم (اختياري)' : 'Promo Code (Optional)'}</span>
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="chk-promo"
                type="text"
                dir="ltr"
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                placeholder="YUOP10"
                className="h-10 flex-1 border border-[#E2E2DD] bg-white px-3 font-mono-tabular text-xs uppercase focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#161614] dark:focus:border-[#F5F5F2]"
              />
              {appliedPromo ? (
                <button
                  type="button"
                  onClick={() => {
                    setAppliedPromo(null);
                    setPromoMsg(null);
                    setPromoInput('');
                  }}
                  className="h-10 border border-[#E2E2DD] bg-white px-4 text-xs font-semibold hover:border-[#111111] dark:border-[#2A2A27] dark:bg-[#161614]"
                >
                  {lang === 'ar' ? 'إزالة' : 'Remove'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={promoBusy || !promoInput.trim()}
                  onClick={handleApplyPromo}
                  className="h-10 bg-[#111111] px-4 text-xs font-semibold text-white hover:bg-[#2A2A28] disabled:opacity-50 dark:bg-[#F5F5F2] dark:text-[#111111]"
                >
                  {promoBusy ? '...' : lang === 'ar' ? 'تطبيق الكود' : 'Apply'}
                </button>
              )}
            </div>
            {promoMsg && (
              <p
                className={`mt-1.5 flex items-center gap-1 text-xs font-semibold ${
                  promoMsg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
                }`}
              >
                {promoMsg.ok && <Check className="h-3.5 w-3.5" />}
                <span>{promoMsg.text}</span>
              </p>
            )}
          </div>

          {/* اختيار طريقة الدفع */}
          <div>
            <span className="block text-xs font-semibold">
              {lang === 'ar' ? 'اختر طريقة الدفع *' : 'Select Payment Method *'}
            </span>
            <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {settings.vodafone_enabled && (
                <button
                  type="button"
                  onClick={() => setPaymentMethod('Vodafone Cash')}
                  className={`flex flex-col items-start border p-3.5 text-start transition-colors ${
                    paymentMethod === 'Vodafone Cash'
                      ? 'border-[#111111] bg-[#111111] text-white dark:border-[#F5F5F2] dark:bg-[#F5F5F2] dark:text-[#111111]'
                      : 'border-[#E2E2DD] bg-white text-[#111111] hover:border-[#111111] dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#F5F5F2] dark:hover:border-[#F5F5F2]'
                  }`}
                >
                  <Smartphone className="h-5 w-5" />
                  <span className="mt-2 text-sm font-bold">Vodafone Cash</span>
                  <span className="mt-0.5 text-xs opacity-75">
                    {lang === 'ar' ? 'تحويل + رفع الإيصال' : 'Transfer + Upload Receipt'}
                  </span>
                </button>
              )}

              {settings.instapay_enabled && (
                <button
                  type="button"
                  onClick={() => setPaymentMethod('InstaPay')}
                  className={`flex flex-col items-start border p-3.5 text-start transition-colors ${
                    paymentMethod === 'InstaPay'
                      ? 'border-[#111111] bg-[#111111] text-white dark:border-[#F5F5F2] dark:bg-[#F5F5F2] dark:text-[#111111]'
                      : 'border-[#E2E2DD] bg-white text-[#111111] hover:border-[#111111] dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#F5F5F2] dark:hover:border-[#F5F5F2]'
                  }`}
                >
                  <Landmark className="h-5 w-5" />
                  <span className="mt-2 text-sm font-bold">InstaPay</span>
                  <span className="mt-0.5 text-xs opacity-75">
                    {lang === 'ar' ? 'تحويل فوري + الإيصال' : 'Instant Transfer + Receipt'}
                  </span>
                </button>
              )}

              {settings.cod_enabled && (
                <button
                  type="button"
                  onClick={() => setPaymentMethod('Cash on Delivery')}
                  className={`flex flex-col items-start border p-3.5 text-start transition-colors ${
                    paymentMethod === 'Cash on Delivery'
                      ? 'border-[#111111] bg-[#111111] text-white dark:border-[#F5F5F2] dark:bg-[#F5F5F2] dark:text-[#111111]'
                      : 'border-[#E2E2DD] bg-white text-[#111111] hover:border-[#111111] dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#F5F5F2] dark:hover:border-[#F5F5F2]'
                  }`}
                >
                  <Banknote className="h-5 w-5" />
                  <span className="mt-2 text-sm font-bold">{lang === 'ar' ? 'الدفع عند الاستلام' : 'Cash on Delivery'}</span>
                  <span className="mt-0.5 text-xs opacity-75">
                    {lang === 'ar' ? 'لا يتطلب إيصال مسبق' : 'No upfront receipt'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* ملخص التكلفة */}
          <div className="border border-[#E2E2DD] bg-[#F6F6F4] p-4 text-sm dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
            <div className="flex justify-between text-[#5C5C58] dark:text-[#A8A8A0]">
              <span>{lang === 'ar' ? 'المنتجات' : 'Subtotal'}</span>
              <span className="font-mono-tabular">{totals.subtotal.toLocaleString()} {settings.currency_symbol_ar}</span>
            </div>
            {totals.discountAmount > 0 && (
              <div className="mt-1 flex justify-between font-semibold text-emerald-700 dark:text-emerald-400">
                <span>
                  {lang === 'ar' ? `الخصم (${appliedPromo?.code})` : `Discount (${appliedPromo?.code})`}
                </span>
                <span className="font-mono-tabular">-{totals.discountAmount.toLocaleString()} {settings.currency_symbol_ar}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between text-[#5C5C58] dark:text-[#A8A8A0]">
              <span>{lang === 'ar' ? 'مصاريف الشحن' : 'Shipping'}</span>
              <span className="font-mono-tabular">
                {totals.shippingFee === 0 ? (lang === 'ar' ? 'مجاني' : 'FREE') : `${totals.shippingFee.toLocaleString()} ${settings.currency_symbol_ar}`}
              </span>
            </div>
            <div className="mt-2 flex justify-between border-t border-[#E2E2DD] pt-2 text-base font-bold text-[#111111] dark:border-[#2A2A27] dark:text-[#F5F5F2]">
              <span>{lang === 'ar' ? 'الإجمالي النهائي' : 'Total Due'}</span>
              <span className="font-mono-tabular">{totals.totalAmount.toLocaleString()} {settings.currency_symbol_ar}</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="h-12 w-full bg-[#111111] text-sm font-bold text-white transition-colors hover:bg-[#2A2A28] disabled:bg-[#9E9E98] dark:bg-[#F5F5F2] dark:text-[#111111] dark:hover:bg-[#E0E0DA]"
          >
            {submitting
              ? lang === 'ar'
                ? 'جاري تأكيد إنشاء الطلب...'
                : 'Creating Order...'
              : lang === 'ar'
                ? 'تأكيد وإرسال الطلب الآن'
                : 'Place Order Now'}
          </button>
        </form>
      </div>
    </div>
  );
}


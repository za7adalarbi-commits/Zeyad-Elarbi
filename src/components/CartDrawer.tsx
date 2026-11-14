/**
 * ============================================================================
 * درج حقيبة التسوق الجانبي (Shopping Bag Drawer)
 * يعرض المنتجات المختارة، التعديل السريع للكمية، وحساب الشحن المجاني.
 * ============================================================================
 */
import { X, Trash2, ArrowLeft, ArrowRight } from 'lucide-react';
import type { Product, StoreSettings } from '../shared/types.ts';
import type { Lang } from '../lib/i18n.ts';
import { calculateOrderTotals } from '../shared/orderRules.ts';
import { ImageWithFallback } from './ImageWithFallback.tsx';

export interface CartItem {
  product: Product;
  size: string;
  quantity: number;
}

interface CartDrawerProps {
  open: boolean;
  items: CartItem[];
  settings: StoreSettings;
  lang: Lang;
  onClose: () => void;
  onUpdateQty: (productId: number, size: string, delta: number) => void;
  onRemove: (productId: number, size: string) => void;
  onCheckout: () => void;
}

export function CartDrawer({
  open,
  items,
  settings,
  lang,
  onClose,
  onUpdateQty,
  onRemove,
  onCheckout,
}: CartDrawerProps) {
  if (!open) return null;

  const totals = calculateOrderTotals(
    items.map((i) => ({ unit_price: i.product.price, quantity: i.quantity })),
    settings.shipping_fee,
    settings.free_shipping_threshold
  );

  const remainingForFree = Math.max(0, settings.free_shipping_threshold - totals.subtotal);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label={lang === 'ar' ? 'حقيبة التسوق' : 'Shopping Bag'}>
      <div className="flex h-full w-full max-w-md flex-col border-s border-[#E2E2DD] bg-white text-[#111111] dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#F5F5F2]">
        {/* الرأس */}
        <div className="flex items-center justify-between border-b border-[#E2E2DD] px-6 py-4 dark:border-[#2A2A27]">
          <h2 className="text-lg font-bold text-[#111111] dark:text-[#F5F5F2]">
            {lang === 'ar' ? 'حقيبة التسوق' : 'Shopping Bag'} ({items.reduce((s, i) => s + i.quantity, 0)})
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'ar' ? 'إغلاق الحقيبة' : 'Close bag'}
            className="flex h-10 w-10 items-center justify-center border border-[#E2E2DD] text-[#111111] hover:bg-[#F6F6F4] dark:border-[#2A2A27] dark:text-[#F5F5F2] dark:hover:bg-[#22221F]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* مؤشر الشحن المجاني */}
        {items.length > 0 && settings.free_shipping_threshold > 0 && (
          <div className="border-b border-[#E2E2DD] bg-[#F6F6F4] px-6 py-3 text-xs text-[#5C5C58] dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#A8A8A0]">
            {remainingForFree === 0 ? (
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                {lang === 'ar' ? 'مؤهل للشحن المجاني بالكامل' : 'Unlocked Free Shipping'}
              </p>
            ) : (
              <p>
                {lang === 'ar'
                  ? `أضف منتجات بقيمة ${remainingForFree.toLocaleString()} ${settings.currency_symbol_ar} للحصول على شحن مجاني`
                  : `Add ${remainingForFree.toLocaleString()} ${settings.currency_code} more for free shipping`}
              </p>
            )}
          </div>
        )}

        {/* قائمة العناصر */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-base font-semibold text-[#111111] dark:text-[#F5F5F2]">
                {lang === 'ar' ? 'حقيبة التسوق فارغة حاليًا' : 'Your bag is empty'}
              </p>
              <p className="mt-1 text-sm text-[#5C5C58] dark:text-[#A8A8A0]">
                {lang === 'ar' ? 'اختر قطعك المفضلة من التشكيلة الجديدة.' : 'Select pieces from the latest drop.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E2E2DD] dark:divide-[#2A2A27]">
              {items.map((item) => {
                const name = lang === 'ar' ? item.product.name_ar : item.product.name_en;
                return (
                  <div key={`${item.product.id}-${item.size}`} className="flex gap-4 py-4">
                    <div className="h-24 w-20 shrink-0 overflow-hidden border border-[#E2E2DD] bg-[#F6F6F4] dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
                      <ImageWithFallback src={item.product.image_url} alt={name} className="h-full w-full object-cover" />
                    </div>
                    <div className="flex flex-1 flex-col justify-between">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-[#111111] dark:text-[#F5F5F2]">{name}</h3>
                          <p className="mt-0.5 font-mono-tabular text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
                            {lang === 'ar' ? 'المقاس:' : 'Size:'} {item.size}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemove(item.product.id, item.size)}
                          aria-label={lang === 'ar' ? `حذف ${name}` : `Remove ${name}`}
                          className="p-1 text-[#5C5C58] hover:text-red-600 dark:text-[#A8A8A0]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center border border-[#E2E2DD] dark:border-[#2A2A27]">
                          <button
                            type="button"
                            onClick={() => onUpdateQty(item.product.id, item.size, -1)}
                            aria-label={`تقليل كمية ${name}`}
                            className="px-2.5 py-1 text-sm hover:bg-[#F6F6F4] dark:hover:bg-[#22221F]"
                          >
                            -
                          </button>
                          <span className="w-8 text-center font-mono-tabular text-xs font-semibold">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => onUpdateQty(item.product.id, item.size, 1)}
                            aria-label={`زيادة كمية ${name}`}
                            className="px-2.5 py-1 text-sm hover:bg-[#F6F6F4] dark:hover:bg-[#22221F]"
                          >
                            +
                          </button>
                        </div>
                        <span className="font-mono-tabular text-sm font-semibold text-[#111111] dark:text-[#F5F5F2]">
                          {(item.product.price * item.quantity).toLocaleString()} {settings.currency_symbol_ar}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* التذييل وزر إتمام الطلب */}
        {items.length > 0 && (
          <div className="border-t border-[#E2E2DD] bg-[#F6F6F4] px-6 py-5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-[#5C5C58] dark:text-[#A8A8A0]">
                <span>{lang === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</span>
                <span className="font-mono-tabular">{totals.subtotal.toLocaleString()} {settings.currency_symbol_ar}</span>
              </div>
              <div className="flex justify-between text-[#5C5C58] dark:text-[#A8A8A0]">
                <span>{lang === 'ar' ? 'الشحن' : 'Shipping'}</span>
                <span className="font-mono-tabular">
                  {totals.shippingFee === 0
                    ? lang === 'ar'
                      ? 'مجاني'
                      : 'FREE'
                    : `${totals.shippingFee.toLocaleString()} ${settings.currency_symbol_ar}`}
                </span>
              </div>
              <div className="flex justify-between border-t border-[#E2E2DD] pt-2 text-base font-bold text-[#111111] dark:border-[#2A2A27] dark:text-[#F5F5F2]">
                <span>{lang === 'ar' ? 'الإجمالي' : 'Total'}</span>
                <span className="font-mono-tabular">{totals.totalAmount.toLocaleString()} {settings.currency_symbol_ar}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onCheckout}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 bg-[#111111] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111] dark:hover:bg-[#E0E0DA]"
            >
              <span>{lang === 'ar' ? 'إتمام الطلب والدفع' : 'Proceed to Checkout'}</span>
              {lang === 'ar' ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

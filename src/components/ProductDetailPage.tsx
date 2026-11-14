/**
 * ============================================================================
 * صفحة تفاصيل المنتج المستقلة (Product Detail Page — /product/:id)
 * تمنح تجربة تصفح وشراء كاملة على سطح المكتب والهاتف مع معرض صور تفاعلي،
 * تبويبات الخامة والمقاسات والشحن، وشريط شراء ثابت مريح للإبهام على الهاتف.
 * ============================================================================
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Ruler,
  ShieldCheck,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import type { Product, StoreSettings } from '../shared/types.ts';
import type { Lang } from '../lib/i18n.ts';
import { ImageWithFallback } from './ImageWithFallback.tsx';

interface ProductDetailPageProps {
  product: Product | undefined;
  allProducts: Product[];
  settings: StoreSettings;
  lang: Lang;
  onAddToCart: (product: Product, size: string, quantity: number) => void;
  onOpenProduct: (productId: number) => void;
  onBackToShop: (category?: string) => void;
  onGoFitGuide: () => void;
}

type InfoTab = 'specs' | 'sizing' | 'shipping';

export function ProductDetailPage({
  product,
  allProducts,
  settings,
  lang,
  onAddToCart,
  onOpenProduct,
  onBackToShop,
  onGoFitGuide,
}: ProductDetailPageProps) {
  const sizes = useMemo(() => Object.entries(product?.sizes_stock || {}), [product]);
  const firstAvailable = useMemo(
    () => sizes.find(([, qty]) => Number(qty) > 0)?.[0] || sizes[0]?.[0] || 'M',
    [sizes]
  );

  const [selectedSize, setSelectedSize] = useState<string>(firstAvailable);
  const [quantity, setQuantity] = useState(1);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [infoTab, setInfoTab] = useState<InfoTab>('specs');
  const [addedFeedback, setAddedFeedback] = useState(false);

  useEffect(() => {
    setSelectedSize(firstAvailable);
    setQuantity(1);
    setActiveImageIdx(0);
  }, [product?.id, firstAvailable]);

  if (!product) {
    return (
      <main className="mx-auto max-w-[1440px] px-4 py-16 text-center sm:px-8">
        <h1 className="text-2xl font-bold">{lang === 'ar' ? 'القطعة غير موجودة' : 'Product Not Found'}</h1>
        <button
          type="button"
          onClick={() => onBackToShop('ALL')}
          className="mt-5 h-11 bg-[#111111] px-6 text-xs font-bold text-white dark:bg-[#F5F5F2] dark:text-[#111111]"
        >
          {lang === 'ar' ? 'العودة إلى التشكيلة' : 'Back to Collection'}
        </button>
      </main>
    );
  }

  const gallery = [product.image_url, ...(product.secondary_image_url ? [product.secondary_image_url] : [])];
  const activeImage = gallery[activeImageIdx] || product.image_url;
  const availableQty = Number(product.sizes_stock?.[selectedSize] ?? 0);
  const title = lang === 'ar' ? product.name_ar : product.name_en;
  const desc = lang === 'ar' ? product.description_ar : product.description_en;

  const related = allProducts
    .filter((p) => p.id !== product.id)
    .sort((a, b) => Number(b.category === product.category) - Number(a.category === product.category))
    .slice(0, 3);

  const handleAdd = () => {
    if (availableQty < quantity) return;
    onAddToCart(product, selectedSize, quantity);
    setAddedFeedback(true);
    setTimeout(() => setAddedFeedback(false), 1400);
  };

  return (
    <>
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 sm:py-10">
        {/* مسار التنقل (Breadcrumb) */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E5E3] pb-4 text-xs text-[#5C5C58] dark:border-[#2A2A27] dark:text-[#A8A8A0]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onBackToShop('ALL')}
              className="inline-flex h-10 items-center gap-1.5 font-semibold text-[#111111] hover:underline dark:text-[#F5F5F2]"
            >
              {lang === 'ar' ? <ArrowRight className="h-3.5 w-3.5" /> : <ArrowLeft className="h-3.5 w-3.5" />}
              <span>{lang === 'ar' ? 'التشكيلة' : 'Shop'}</span>
            </button>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              onClick={() => onBackToShop(product.category)}
              className="hover:text-[#111111] hover:underline dark:hover:text-white"
            >
              {product.category}
            </button>
            <span aria-hidden="true">/</span>
            <span className="truncate font-semibold text-[#111111] dark:text-[#F5F5F2]">{title}</span>
          </div>
        </div>

        {/* الشبكة الرئيسية لصفحة المنتج (2 Columns) */}
        <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-12">
          {/* العمود الأيمن/الأيسر: معرض الصور التفاعلي */}
          <div className="lg:col-span-7">
            <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#F7F7F7] sm:aspect-[4/4] dark:bg-[#161614]">
              <ImageWithFallback src={activeImage} alt={title} className="h-full w-full object-cover" />

              {gallery.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label={lang === 'ar' ? 'الصورة السابقة' : 'Previous photo'}
                    onClick={() => setActiveImageIdx((i) => (i - 1 + gallery.length) % gallery.length)}
                    className="absolute start-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center border border-[#E5E5E3] bg-white/90 text-[#111111] backdrop-blur-sm transition-colors hover:bg-[#111111] hover:text-white dark:border-[#2A2A27] dark:bg-[#161614]/90 dark:text-[#F5F5F2]"
                  >
                    <ChevronRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
                  </button>
                  <button
                    type="button"
                    aria-label={lang === 'ar' ? 'الصورة التالية' : 'Next photo'}
                    onClick={() => setActiveImageIdx((i) => (i + 1) % gallery.length)}
                    className="absolute end-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center border border-[#E5E5E3] bg-white/90 text-[#111111] backdrop-blur-sm transition-colors hover:bg-[#111111] hover:text-white dark:border-[#2A2A27] dark:bg-[#161614]/90 dark:text-[#F5F5F2]"
                  >
                    <ChevronLeft className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" />
                  </button>
                </>
              )}
            </div>

            {gallery.length > 1 && (
              <div className="mt-3 flex gap-3">
                {gallery.map((imgUrl, idx) => (
                  <button
                    key={imgUrl + idx}
                    type="button"
                    onClick={() => setActiveImageIdx(idx)}
                    aria-label={`${title} (${idx + 1})`}
                    className={`h-20 w-20 overflow-hidden border-2 transition-colors ${
                      activeImageIdx === idx
                        ? 'border-[#111111] dark:border-[#F5F5F2]'
                        : 'border-[#E5E5E3] opacity-70 hover:opacity-100 dark:border-[#2A2A27]'
                    }`}
                  >
                    <ImageWithFallback src={imgUrl} alt={`${title} ${idx + 1}`} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* وحدة الشراء المترابطة والمواصفات */}
          <div className="lg:sticky lg:top-24 lg:col-span-5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
              <span>{product.category}</span>
              <span aria-hidden="true">·</span>
              <span>{settings.store_name}</span>
              {product.badge_text && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-[#111111] dark:text-[#F5F5F2]">{product.badge_text}</span>
                </>
              )}
            </div>

            <h1 className="mt-2 text-2xl font-bold leading-snug text-[#111111] sm:text-3xl dark:text-[#F5F5F2]">
              {title}
            </h1>

            <div className="mt-3 flex items-baseline gap-3">
              <span className="font-mono-tabular text-2xl font-bold text-[#111111] dark:text-[#F5F5F2]">
                {product.price.toLocaleString()} {settings.currency_symbol_ar}
              </span>
              {product.compare_at_price && product.compare_at_price > product.price && (
                <span className="font-mono-tabular text-sm text-[#7A7A74] line-through">
                  {product.compare_at_price.toLocaleString()} {settings.currency_symbol_ar}
                </span>
              )}
            </div>

            <p className="mt-4 text-sm leading-relaxed text-[#5C5C58] dark:text-[#A8A8A0]">{desc}</p>

            {/* اختيار المقاس 44px+ */}
            <div className="mt-6 border-t border-[#E5E5E3] pt-5 dark:border-[#2A2A27]">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {lang === 'ar' ? 'المقاس المختار' : 'Selected Size'}:{' '}
                  <span className="font-mono-tabular">{selectedSize}</span>
                </span>
                <button
                  type="button"
                  onClick={onGoFitGuide}
                  className="inline-flex h-9 items-center gap-1.5 text-xs font-semibold text-[#5C5C58] underline underline-offset-4 hover:text-[#111111] dark:text-[#A8A8A0] dark:hover:text-white"
                >
                  <Ruler className="h-3.5 w-3.5" />
                  <span>{lang === 'ar' ? 'حاسبة المقاس ودليل القصّات' : 'Size Calculator'}</span>
                </button>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2">
                {sizes.map(([sizeKey, stock]) => {
                  const isOut = Number(stock) <= 0;
                  const isSelected = selectedSize === sizeKey;
                  return (
                    <button
                      key={sizeKey}
                      type="button"
                      disabled={isOut}
                      onClick={() => {
                        setSelectedSize(sizeKey);
                        setQuantity(1);
                      }}
                      className={`h-12 border font-mono-tabular text-sm font-semibold transition-colors ${
                        isOut
                          ? 'cursor-not-allowed border-[#E5E5E3] bg-[#F7F7F7] text-[#9E9E98] line-through dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#5C5C58]'
                          : isSelected
                            ? 'border-[#111111] bg-[#111111] text-white dark:border-[#F5F5F2] dark:bg-[#F5F5F2] dark:text-[#111111]'
                            : 'border-[#E5E5E3] bg-white text-[#111111] hover:border-[#111111] dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#F5F5F2] dark:hover:border-[#F5F5F2]'
                      }`}
                    >
                      {sizeKey}
                    </button>
                  );
                })}
              </div>

              <p className="mt-2 font-mono-tabular text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
                {availableQty > 0
                  ? lang === 'ar'
                    ? `متاح بالمخزون: ${availableQty} قطعة`
                    : `In stock: ${availableQty} pcs`
                  : lang === 'ar'
                    ? 'نفذت الكمية لهذا المقاس'
                    : 'Out of stock'}
              </p>
            </div>

            {/* الكمية + زر الإضافة */}
            <div className="mt-6 flex items-center gap-3">
              <div className="flex h-12 items-center border border-[#E5E5E3] dark:border-[#2A2A27]">
                <button
                  type="button"
                  aria-label={lang === 'ar' ? 'تقليل الكمية' : 'Decrease quantity'}
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="h-full w-11 text-lg font-medium hover:bg-[#F7F7F7] dark:hover:bg-[#1E1E1B]"
                >
                  -
                </button>
                <span className="w-10 text-center font-mono-tabular text-sm font-semibold">{quantity}</span>
                <button
                  type="button"
                  aria-label={lang === 'ar' ? 'زيادة الكمية' : 'Increase quantity'}
                  onClick={() => setQuantity((q) => Math.min(Math.max(1, availableQty), q + 1))}
                  className="h-full w-11 text-lg font-medium hover:bg-[#F7F7F7] dark:hover:bg-[#1E1E1B]"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                disabled={availableQty <= 0}
                onClick={handleAdd}
                className="flex h-12 flex-1 items-center justify-center gap-2 bg-[#111111] px-6 text-sm font-bold text-white transition-colors hover:bg-[#2A2A28] disabled:cursor-not-allowed disabled:bg-[#9E9E98] dark:bg-[#F5F5F2] dark:text-[#111111] dark:hover:bg-[#E0E0DA]"
              >
                {addedFeedback ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>{lang === 'ar' ? 'تمت الإضافة للحقيبة' : 'Added to Bag'}</span>
                  </>
                ) : (
                  <>
                    <ShoppingBag className="h-4 w-4" />
                    <span>{lang === 'ar' ? 'أضف إلى الحقيبة' : 'Add to Bag'}</span>
                  </>
                )}
              </button>
            </div>

            {/* تبويبات تفاصيل الخامة والمقاسات والشحن */}
            <div className="mt-8 border border-[#E5E5E3] dark:border-[#2A2A27]">
              <div className="grid grid-cols-3 border-b border-[#E5E5E3] text-xs font-semibold dark:border-[#2A2A27]">
                {[
                  { id: 'specs' as InfoTab, ar: 'الخامة والعناية', en: 'Fabric' },
                  { id: 'sizing' as InfoTab, ar: 'الأبعاد والمقاس', en: 'Sizing' },
                  { id: 'shipping' as InfoTab, ar: 'الشحن والدفع', en: 'Shipping' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setInfoTab(t.id)}
                    className={`h-11 px-2 transition-colors ${
                      infoTab === t.id
                        ? 'bg-[#111111] text-white dark:bg-[#F5F5F2] dark:text-[#111111]'
                        : 'bg-[#F7F7F7] text-[#5C5C58] hover:text-[#111111] dark:bg-[#161614] dark:text-[#A8A8A0]'
                    }`}
                  >
                    {lang === 'ar' ? t.ar : t.en}
                  </button>
                ))}
              </div>

              <div className="p-4 text-xs leading-relaxed text-[#5C5C58] dark:text-[#A8A8A0]">
                {infoTab === 'specs' && (
                  <div className="space-y-2">
                    <p className="font-semibold text-[#111111] dark:text-[#F5F5F2]">{product.fabric_details}</p>
                    <p>
                      {lang === 'ar'
                        ? 'يُغسل مقلوبًا بماء بارد (30° مئوية) للحفاظ على ثبات الغسيل الإنزيمي وشكل القصة المعمارية.'
                        : 'Wash inside out in cold water (30°C) to preserve garment wash and structured silhouette.'}
                    </p>
                  </div>
                )}

                {infoTab === 'sizing' && (
                  <div className="grid grid-cols-2 gap-2 font-mono-tabular">
                    <div className="border border-[#E5E5E3] p-2 dark:border-[#2A2A27]">S · 68×58 cm</div>
                    <div className="border border-[#E5E5E3] p-2 dark:border-[#2A2A27]">M · 71×61 cm</div>
                    <div className="border border-[#E5E5E3] p-2 dark:border-[#2A2A27]">L · 74×64 cm</div>
                    <div className="border border-[#E5E5E3] p-2 dark:border-[#2A2A27]">XL · 77×67 cm</div>
                  </div>
                )}

                {infoTab === 'shipping' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[#111111] dark:text-[#F5F5F2]">
                      <Truck className="h-4 w-4 shrink-0" />
                      <span>
                        {lang === 'ar'
                          ? `شحن سريع (${settings.shipping_fee} ج.م) ومجاني فوق ${settings.free_shipping_threshold} ج.م`
                          : `Fast delivery (${settings.shipping_fee} EGP) · Free over ${settings.free_shipping_threshold} EGP`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 shrink-0" />
                      <span>
                        {lang === 'ar'
                          ? 'الدفع عبر فودافون كاش أو إنستا باي أو عند الاستلام مع متابعة عبر واتساب.'
                          : 'Vodafone Cash, InstaPay, or Cash on Delivery with WhatsApp order tracking.'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* قطع مكملة مقترحة */}
        {related.length > 0 && (
          <section className="mt-16 border-t border-[#E5E5E3] pt-10 dark:border-[#2A2A27]">
            <div className="flex items-end justify-between">
              <h2 className="font-display text-2xl font-bold text-[#111111] dark:text-[#F5F5F2]">
                {lang === 'ar' ? 'قطع مكملة للإطلالة.' : 'COMPLETE THE LOOK.'}
              </h2>
              <button
                type="button"
                onClick={() => onBackToShop('ALL')}
                className="text-xs font-semibold underline underline-offset-4"
              >
                {lang === 'ar' ? 'تصفح الكل' : 'View All'}
              </button>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3">
              {related.map((rel) => {
                const rTitle = lang === 'ar' ? rel.name_ar : rel.name_en;
                return (
                  <article key={rel.id} className="group">
                    <button
                      type="button"
                      onClick={() => onOpenProduct(rel.id)}
                      className="block w-full text-start"
                    >
                      <div className="aspect-[3/4] overflow-hidden bg-[#F7F7F7] dark:bg-[#161614]">
                        <ImageWithFallback
                          src={rel.image_url}
                          alt={rTitle}
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      </div>
                      <p className="mt-2.5 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">{rel.category}</p>
                      <h3 className="mt-0.5 text-sm font-semibold text-[#111111] group-hover:underline dark:text-[#F5F5F2]">
                        {rTitle}
                      </h3>
                      <p className="mt-1 font-mono-tabular text-sm font-bold text-[#111111] dark:text-[#F5F5F2]">
                        {rel.price.toLocaleString()} {settings.currency_symbol_ar}
                      </p>
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {/* شريط الشراء الثابت المريح للإبهام على الهاتف (56px فقط - بدون تعارض مع شريط آخر) */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-between gap-3 border-t border-[#E5E5E3] bg-white/95 px-4 backdrop-blur-md md:hidden dark:border-[#2A2A27] dark:bg-[#0D0D0C]/95">
        <div className="min-w-0">
          <div className="font-mono-tabular text-xs font-bold text-[#111111] dark:text-[#F5F5F2]">
            {product.price.toLocaleString()} {settings.currency_symbol_ar} · {selectedSize}
          </div>
          <div className="truncate text-[10px] text-[#5C5C58] dark:text-[#A8A8A0]">{title}</div>
        </div>
        <button
          type="button"
          disabled={availableQty <= 0}
          onClick={handleAdd}
          className="flex h-10 shrink-0 items-center gap-2 bg-[#111111] px-5 text-xs font-bold text-white disabled:bg-[#9E9E98] dark:bg-[#F5F5F2] dark:text-[#111111]"
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          <span>{lang === 'ar' ? 'أضف للحقيبة' : 'Add to Bag'}</span>
        </button>
      </div>
    </>
  );
}

/**
 * ============================================================================
 * صفحة الهبوط التسويقية التفاعلية (Campaign Landing Page View — /lp/:slug)
 * تعرض الحملات والإصدارات الخاصة المنشورة من لوحة التحكم بتصميم streetwearts.com
 * وتعمل بسلاسة داخل الهيكل متعدد الصفحات وعلى الهواتف المحمولة.
 * ============================================================================
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import type { LandingPage, Product, StoreSettings } from '../shared/types.ts';
import type { Lang } from '../lib/i18n.ts';
import { fetchLandingPageBySlug } from '../lib/api.ts';
import { ImageWithFallback } from './ImageWithFallback.tsx';

interface LandingPageViewProps {
  slug: string;
  settings: StoreSettings;
  products: Product[];
  lang: Lang;
  onSelectProduct: (product: Product) => void;
  onQuickAdd: (product: Product, size: string) => void;
  onBackToStore: () => void;
  onGoShop: () => void;
}

export function LandingPageView({
  slug,
  settings,
  products,
  lang,
  onSelectProduct,
  onQuickAdd,
  onBackToStore,
  onGoShop,
}: LandingPageViewProps) {
  const [page, setPage] = useState<LandingPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setNotFound(false);
    fetchLandingPageBySlug(slug)
      .then((res) => {
        if (mounted) setPage(res.landing_page);
      })
      .catch(() => {
        if (mounted) setNotFound(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [slug]);

  const handleQuickSizeClick = (product: Product, size: string) => {
    const key = `${product.id}-${size}`;
    setJustAddedKey(key);
    onQuickAdd(product, size);
    setTimeout(() => setJustAddedKey((prev) => (prev === key ? null : prev)), 1200);
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-white text-sm font-semibold text-[#5C5C58] dark:bg-[#0D0D0C] dark:text-[#A8A8A0]">
        {lang === 'ar' ? 'جاري تحميل صفحة الحملة...' : 'Loading campaign page...'}
      </div>
    );
  }

  if (notFound || !page) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-white px-4 text-center text-[#111111] dark:bg-[#0D0D0C] dark:text-[#F5F5F2]">
        <h1 className="font-display text-3xl font-bold uppercase">{settings.store_name}</h1>
        <p className="mt-3 text-sm text-[#5C5C58] dark:text-[#A8A8A0]">
          {lang === 'ar' ? 'صفحة الهبوط المطلوبة غير متوفرة أو غير منشورة حاليًا.' : 'Campaign page not found or unpublished.'}
        </p>
        <button
          type="button"
          onClick={onBackToStore}
          className="mt-6 h-12 bg-[#111111] px-6 text-xs font-bold text-white dark:bg-[#F5F5F2] dark:text-[#111111]"
        >
          {lang === 'ar' ? 'العودة إلى الرئيسية' : 'Back to Home'}
        </button>
      </div>
    );
  }

  const featuredProducts =
    page.featured_product_ids.length > 0
      ? products.filter((p) => page.featured_product_ids.includes(p.id))
      : products.slice(0, 4);

  const isDarkHero = page.theme_style === 'dark';

  return (
    <div className="bg-white text-[#111111] dark:bg-[#0D0D0C] dark:text-[#F5F5F2]">
      {/* هيرو الحملة */}
      <section
        className={`relative flex min-h-[65vh] sm:min-h-[72vh] items-end overflow-hidden ${
          isDarkHero ? 'bg-[#141413] text-white' : 'bg-[#F7F7F7] text-[#111111]'
        }`}
      >
        <ImageWithFallback
          src={page.hero_image_url}
          alt={lang === 'ar' ? page.title_ar : page.title_en}
          className="absolute inset-0 h-full w-full object-cover object-[50%_20%]"
        />
        <div
          className={`absolute inset-0 ${
            isDarkHero
              ? 'bg-gradient-to-t from-black/85 via-black/35 to-black/25'
              : 'bg-gradient-to-t from-black/80 via-black/30 to-transparent'
          }`}
          aria-hidden="true"
        />
        <div className="relative z-10 mx-auto w-full max-w-[1440px] px-4 pb-10 pt-20 text-white sm:px-8 lg:pb-16">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.2em] text-neutral-200 uppercase">
              {lang === 'ar' ? page.kicker_ar : page.kicker_en}
            </p>
            <h1
              className="mt-3 font-bold leading-[1.08]"
              style={{ fontSize: 'clamp(2rem, 5vw, 4rem)', textWrap: 'balance' }}
            >
              {lang === 'ar' ? page.title_ar : page.title_en}
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-neutral-200 sm:text-base">
              {lang === 'ar' ? page.subtitle_ar : page.subtitle_en}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href="#lp-products"
                className="inline-flex h-12 items-center gap-2 bg-white px-7 text-xs font-bold tracking-wider text-[#111111] uppercase hover:bg-neutral-200 whitespace-nowrap"
              >
                <span>{lang === 'ar' ? page.cta_text_ar : page.cta_text_en}</span>
                {lang === 'ar' ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </a>
              <button
                type="button"
                onClick={onGoShop}
                className="inline-flex h-12 items-center border border-white/75 px-6 text-xs font-bold tracking-wider text-white uppercase hover:bg-white hover:text-[#111111] whitespace-nowrap"
              >
                {lang === 'ar' ? 'تصفح التشكيلة الكاملة' : 'Full Collection'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* نقاط القوة في الحملة */}
      {page.highlights.length > 0 && (
        <section className="border-y border-[#E5E5E3] bg-[#F7F7F7] dark:border-[#2A2A27] dark:bg-[#161614]">
          <div className="mx-auto grid max-w-[1440px] grid-cols-1 divide-y divide-[#E5E5E3] sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-[#2A2A27]">
            {page.highlights.map((item, idx) => (
              <div key={idx} className="flex items-start gap-3 p-5 sm:p-6">
                <span className="font-mono-tabular text-xs font-bold text-[#5C5C58] dark:text-[#A8A8A0]">
                  0{idx + 1}
                </span>
                <p className="text-sm font-semibold">{item}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* المنتجات المختارة للحملة */}
      <section id="lp-products" className="mx-auto max-w-[1440px] px-4 py-10 sm:px-8 sm:py-12">
        <div className="flex items-end justify-between border-b border-[#E5E5E3] pb-4 dark:border-[#2A2A27]">
          <h2 className="font-display text-2xl font-bold uppercase sm:text-3xl">
            {lang === 'ar' ? 'قطع الحملة المختارة.' : 'CURATED CAMPAIGN DROP.'}
          </h2>
          <span className="font-mono-tabular text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
            {featuredProducts.length} {lang === 'ar' ? 'قطعة' : 'pieces'}
          </span>
        </div>

        <div
          className={`mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 ${
            featuredProducts.length <= 6 ? 'lg:grid-cols-3' : 'lg:grid-cols-3 xl:grid-cols-4'
          }`}
        >
          {featuredProducts.map((product) => {
            const title = lang === 'ar' ? product.name_ar : product.name_en;
            const sizesEntries = Object.entries(product.sizes_stock || {});
            return (
              <article key={product.id} className="group flex flex-col">
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#F7F7F7] dark:bg-[#161614]">
                  <button
                    type="button"
                    onClick={() => onSelectProduct(product)}
                    className="block h-full w-full text-start"
                  >
                    <ImageWithFallback
                      src={product.image_url}
                      alt={title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                  </button>
                  {/* شريط مقاسات سطح المكتب */}
                  <div className="hidden lg:block absolute inset-x-2 bottom-2 translate-y-2 border border-[#E5E5E3] bg-white/95 p-2 opacity-0 backdrop-blur-sm transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 dark:border-[#2A2A27] dark:bg-[#161614]/95">
                    <div className="grid grid-cols-4 gap-1">
                      {sizesEntries.map(([sizeKey, stock]) => {
                        const out = Number(stock) <= 0;
                        const added = justAddedKey === `${product.id}-${sizeKey}`;
                        return (
                          <button
                            key={sizeKey}
                            type="button"
                            disabled={out}
                            onClick={() => handleQuickSizeClick(product, sizeKey)}
                            className={`flex h-9 items-center justify-center font-mono-tabular text-[11px] font-semibold ${
                              out
                                ? 'cursor-not-allowed bg-[#F0F0EE] text-[#9E9E98] line-through dark:bg-[#22221F]'
                                : added
                                  ? 'bg-emerald-700 text-white'
                                  : 'bg-[#111111] text-white hover:bg-[#333330] dark:bg-[#F5F5F2] dark:text-[#111111]'
                            }`}
                          >
                            {added ? <Check className="h-3.5 w-3.5" /> : sizeKey}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => onSelectProduct(product)}
                    className="block text-start text-sm font-semibold hover:underline"
                  >
                    {title}
                  </button>
                  <div className="mt-1 font-mono-tabular text-sm font-bold">
                    {product.price.toLocaleString()} {settings.currency_symbol_ar}
                  </div>
                  {/* شريط مقاسات مخصص للموبايل (أهداف لمس ≥ 40px) */}
                  <div className="mt-2.5 grid grid-cols-4 gap-1 lg:hidden">
                    {sizesEntries.map(([sizeKey, stock]) => {
                      const out = Number(stock) <= 0;
                      const added = justAddedKey === `${product.id}-${sizeKey}`;
                      return (
                        <button
                          key={sizeKey}
                          type="button"
                          disabled={out}
                          onClick={() => handleQuickSizeClick(product, sizeKey)}
                          aria-label={`${title} - ${sizeKey}`}
                          className={`flex h-10 items-center justify-center border font-mono-tabular text-[11px] font-bold transition-colors ${
                            out
                              ? 'cursor-not-allowed border-[#E5E5E3] text-[#9E9E98] line-through dark:border-[#2A2A27]'
                              : added
                                ? 'border-emerald-700 bg-emerald-700 text-white'
                                : 'border-[#E5E5E3] text-[#111111] active:bg-[#111111] active:text-white dark:border-[#2A2A27] dark:text-[#F5F5F2]'
                          }`}
                        >
                          {added ? <Check className="h-3.5 w-3.5" /> : sizeKey}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

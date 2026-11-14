/**
 * ============================================================================
 * الصفحة الرئيسية لمتجر YUOP Streetwear (Home Page — /)
 * واجهة افتتاحية أنيقة وخفيفة غير مزدحمة تتبع أسلوب streetwearts.com:
 * - بانر رئيسي Full-Bleed + شريط متحرك -> التوجيه لصفحة التشكيلة الكاملة (/shop).
 * - بطاقات الفئات الأربعة -> تفتح صفحة التشكيلة مفلترة مباشرة حسب الفئة.
 * - أبرز 3 قطع مختارة للإصدار مع فتح صفحة المنتج (/product/:id) أو الإضافة السريعة.
 * - قسم تعريفي سريع ينقلك إلى استوديو القصّات وحاسبة المقاس (/fit-guide).
 * ============================================================================
 */
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Compass, Globe } from 'lucide-react';
import type { LandingPage, Product, StoreSettings } from '../shared/types.ts';
import type { Lang } from '../lib/i18n.ts';
import { ImageWithFallback } from './ImageWithFallback.tsx';

interface StorefrontProps {
  settings: StoreSettings;
  products: Product[];
  landingPages: LandingPage[];
  lang: Lang;
  onToggleLang: () => void;
  onOpenProduct: (productId: number) => void;
  onQuickAdd: (product: Product, size: string) => void;
  onNavigateShop: (category?: string) => void;
  onNavigateFitGuide: () => void;
  onNavigateTrack: () => void;
  onNavigateLandingPage: (slug: string) => void;
}

const EDITORIAL_CATEGORIES = [
  {
    key: 'Hoodies',
    ar: 'هوديز وسويت شيرت',
    en: 'Hoodies & Fleece',
    subAr: 'قطن مصري 480 GSM',
    subEn: '480 GSM Heavyweight',
    image: '/src/assets/images/cat_hoodies_editorial_1794551311689.jpg',
  },
  {
    key: 'Tees',
    ar: 'تيشيرتات بوكسي',
    en: 'Boxy Tees',
    subAr: 'ياقة مضلعة 300 GSM',
    subEn: '300 GSM Ribbed Collar',
    image: '/src/assets/images/cat_tees_editorial_1794551311360.jpg',
  },
  {
    key: 'Cargos',
    ar: 'كارجو وبناطيل',
    en: 'Cargos & Bottoms',
    subAr: 'قصة واسعة وتفاصيل تقنية',
    subEn: 'Technical Relaxed Fit',
    image: '/src/assets/images/cat_cargos_editorial_1794551311969.jpg',
  },
  {
    key: 'Jackets',
    ar: 'جاكيتات وأوفرشيرت',
    en: 'Outerwear',
    subAr: 'كانفاس 520 GSM',
    subEn: '520 GSM Canvas',
    image: '/src/assets/images/hero_yuop_editorial_1794551310693.jpg',
  },
];

export function Storefront({
  settings,
  products,
  landingPages,
  lang,
  onToggleLang,
  onOpenProduct,
  onQuickAdd,
  onNavigateShop,
  onNavigateFitGuide,
  onNavigateTrack,
  onNavigateLandingPage,
}: StorefrontProps) {
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);

  const featuredProducts = products.slice(0, 3);
  const featuredCampaign = landingPages.find((lp) => lp.is_published);

  const handleQuickSizeClick = (product: Product, size: string) => {
    const key = `${product.id}-${size}`;
    setJustAddedKey(key);
    onQuickAdd(product, size);
    setTimeout(() => {
      setJustAddedKey((prev) => (prev === key ? null : prev));
    }, 1200);
  };

  return (
    <main id="top">
      {/* 1. البانر الرئيسي Full-Bleed بتصميم streetwearts.com السينمائي */}
      <section className="relative flex min-h-[74vh] w-full items-end overflow-hidden bg-[#141413] text-white sm:min-h-[82vh]">
        <ImageWithFallback
          src={settings.hero_image_url}
          alt={lang === 'ar' ? settings.hero_title_ar : settings.hero_title_en}
          className="absolute inset-0 h-full w-full object-cover object-[50%_18%]"
        />

        <div
          className={`absolute inset-0 ${
            lang === 'ar'
              ? 'bg-gradient-to-l from-black/80 via-black/30 to-transparent'
              : 'bg-gradient-to-r from-black/80 via-black/30 to-transparent'
          }`}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/30"
          aria-hidden="true"
        />

        <div className="relative z-10 mx-auto w-full max-w-[1440px] px-4 pb-10 pt-16 sm:px-8 sm:pb-16">
          <div className="max-w-xl">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold tracking-[0.2em] text-neutral-200 uppercase">
                {lang === 'ar' ? settings.hero_kicker_ar : settings.hero_kicker_en}
              </p>
              <button
                type="button"
                onClick={onToggleLang}
                aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل للعربية'}
                className="inline-flex h-9 items-center gap-1.5 border border-white/50 bg-black/60 px-3 text-[11px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white hover:text-[#111111]"
              >
                <Globe className="h-3.5 w-3.5" />
                <span>{lang === 'ar' ? 'EN' : 'عربي'}</span>
              </button>
            </div>

            <h1
              className="mt-4 font-bold leading-[1.06] tracking-tight text-white"
              style={{ fontSize: 'clamp(2.15rem, 5vw, 4.25rem)', textWrap: 'balance' }}
            >
              {lang === 'ar' ? settings.hero_title_ar : settings.hero_title_en}
            </h1>

            <p className="mt-4 max-w-lg text-sm leading-relaxed text-neutral-200 sm:text-base">
              {lang === 'ar' ? settings.hero_subtitle_ar : settings.hero_subtitle_en}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigateShop('ALL')}
                className="inline-flex h-12 items-center gap-2 bg-white px-7 text-xs font-bold tracking-wider text-[#111111] uppercase transition-colors hover:bg-neutral-200"
              >
                <span>{lang === 'ar' ? settings.hero_cta_ar : settings.hero_cta_en}</span>
                {lang === 'ar' ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={onNavigateTrack}
                className="inline-flex h-12 items-center border border-white/75 bg-transparent px-6 text-xs font-bold tracking-wider text-white uppercase transition-colors hover:bg-white hover:text-[#111111]"
              >
                {lang === 'ar' ? 'تتبع طلبك / رفع الإيصال' : 'Track Order / Receipt'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* الشريط المتحرك (Marquee Strip) -> التشكيلة الكاملة */}
      <button
        type="button"
        onClick={() => onNavigateShop('ALL')}
        aria-label={lang === 'ar' ? 'الانتقال إلى صفحة التشكيلة' : 'Explore Collection'}
        className="block w-full overflow-hidden bg-[#141414] py-3.5 text-white transition-colors hover:bg-[#1E1E1E] dark:border-y dark:border-[#2A2A27] dark:bg-[#161614]"
      >
        <div className="yuop-marquee-track font-display text-xs font-semibold tracking-[0.25em] uppercase sm:text-sm" dir="ltr">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex shrink-0 items-center gap-10 px-5">
              <span>YUOP · COLLECTION 01</span>
              <span aria-hidden="true">·</span>
              <span>480 GSM HEAVYWEIGHT COTTON</span>
              <span aria-hidden="true">·</span>
              <span>VODAFONE CASH · INSTAPAY · COD</span>
              <span aria-hidden="true">·</span>
              <span>MADE FOR ALL OF US</span>
              <span aria-hidden="true">·</span>
              <span>LIVE WHATSAPP TRACKING</span>
              <span aria-hidden="true">·</span>
            </div>
          ))}
        </div>
      </button>

      {/* 2. الفئات المصورة (4 أعمدة تفتح صفحة التشكيلة مفلترة) */}
      <section className="mx-auto max-w-[1440px] px-4 pt-8 pb-4 sm:px-8 sm:pt-12">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.2em] text-[#5C5C58] uppercase dark:text-[#A8A8A0]">
              {lang === 'ar' ? 'تصفح حسب الفئة' : 'SHOP BY CATEGORY'}
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold text-[#111111] sm:text-3xl dark:text-[#F5F5F2]">
              {lang === 'ar' ? 'الأقسام الرئيسية.' : 'COLLECTIONS.'}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigateShop('ALL')}
            className="text-xs font-semibold text-[#111111] underline underline-offset-4 dark:text-[#F5F5F2]"
          >
            {lang === 'ar' ? 'كل المنتجات' : 'View All'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {EDITORIAL_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => onNavigateShop(cat.key)}
              className="group relative aspect-[3/4] w-full overflow-hidden bg-[#EAEAE8] text-start dark:bg-[#1C1C19]"
            >
              <ImageWithFallback
                src={cat.image}
                alt={lang === 'ar' ? cat.ar : cat.en}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div
                className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent transition-opacity group-hover:from-black/85"
                aria-hidden="true"
              />
              <div className="absolute inset-x-0 bottom-0 p-4 text-white sm:p-5">
                <span className="block text-[11px] font-medium tracking-wider text-neutral-300">
                  {lang === 'ar' ? cat.subAr : cat.subEn}
                </span>
                <span className="mt-1 block text-base font-bold sm:text-lg">
                  {lang === 'ar' ? cat.ar : cat.en}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 3. أبرز 3 قطع مختارة من الإصدار (تشجع التصفح دون تكديس الكتالوج بالكامل في الصفحة الأولى) */}
      <section className="mx-auto max-w-[1440px] px-4 py-10 sm:px-8 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#E5E5E3] pb-5 dark:border-[#2A2A27]">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.2em] text-[#5C5C58] uppercase dark:text-[#A8A8A0]">
              {lang === 'ar' ? 'الإصدار الجديد · اختيارات المحرر' : 'FEATURED DROP · 01'}
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold text-[#111111] sm:text-3xl dark:text-[#F5F5F2]">
              {lang === 'ar' ? 'أبرز قطع الإصدار.' : 'FEATURED PIECES.'}
            </h2>
          </div>

          <button
            type="button"
            onClick={() => onNavigateShop('ALL')}
            className="inline-flex h-11 items-center gap-2 bg-[#111111] px-5 text-xs font-bold text-white transition-colors hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111] dark:hover:bg-[#E0E0DA]"
          >
            <span>
              {lang === 'ar'
                ? `عرض التشكيلة الكاملة (${products.length})`
                : `Explore All Pieces (${products.length})`}
            </span>
            {lang === 'ar' ? <ArrowLeft className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featuredProducts.map((product) => {
            const title = lang === 'ar' ? product.name_ar : product.name_en;
            const sizesEntries = Object.entries(product.sizes_stock || {});
            return (
              <article key={product.id} className="group flex flex-col">
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-[#F7F7F7] dark:bg-[#161614]">
                  <button
                    type="button"
                    onClick={() => onOpenProduct(product.id)}
                    aria-label={title}
                    className="block h-full w-full text-start"
                  >
                    <ImageWithFallback
                      src={product.image_url}
                      alt={title}
                      className={`h-full w-full object-cover transition-all duration-500 ${
                        product.secondary_image_url
                          ? 'group-hover:scale-[1.02] group-hover:opacity-0'
                          : 'group-hover:scale-[1.03]'
                      }`}
                    />
                    {product.secondary_image_url && (
                      <ImageWithFallback
                        src={product.secondary_image_url}
                        alt={`${title} — صورة ثانية`}
                        className="absolute inset-0 h-full w-full object-cover opacity-0 transition-all duration-500 group-hover:scale-[1.02] group-hover:opacity-100"
                      />
                    )}
                  </button>

                  <div className="pointer-events-auto absolute inset-x-2 bottom-2 hidden translate-y-2 border border-[#E5E5E3] bg-white/95 p-2 opacity-0 backdrop-blur-sm transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 md:block dark:border-[#2A2A27] dark:bg-[#161614]/95">
                    <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">
                      <span>{lang === 'ar' ? 'إضافة سريعة' : 'QUICK ADD'}</span>
                      <button
                        type="button"
                        onClick={() => onOpenProduct(product.id)}
                        className="underline hover:text-[#111111] dark:hover:text-white"
                      >
                        {lang === 'ar' ? 'صفحة القطعة' : 'Open Piece'}
                      </button>
                    </div>
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
                                ? 'cursor-not-allowed bg-[#F0F0EE] text-[#9E9E98] line-through dark:bg-[#22221F] dark:text-[#5C5C58]'
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

                <div className="mt-3 flex flex-1 flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">
                      <span>{product.category}</span>
                      {product.badge_text && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-[#111111] dark:text-[#F5F5F2]">{product.badge_text}</span>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenProduct(product.id)}
                      className="mt-1 block text-start text-base font-semibold text-[#111111] hover:underline dark:text-[#F5F5F2]"
                    >
                      {title}
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono-tabular text-sm font-bold text-[#111111] dark:text-[#F5F5F2]">
                        {product.price.toLocaleString()} {settings.currency_symbol_ar}
                      </span>
                      {product.compare_at_price && product.compare_at_price > product.price && (
                        <span className="font-mono-tabular text-xs text-[#7A7A74] line-through">
                          {product.compare_at_price.toLocaleString()}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenProduct(product.id)}
                      className="inline-flex h-9 items-center gap-1 border border-[#E5E5E3] px-3 text-xs font-semibold hover:border-[#111111] dark:border-[#2A2A27] dark:hover:border-[#F5F5F2]"
                    >
                      <span>{lang === 'ar' ? 'معاينة' : 'View'}</span>
                      {lang === 'ar' ? <ArrowLeft className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* 4. قسم تفاعلي ينقل لاستوديو القصّات وحاسبة المقاس + الحملات الخاصة */}
      <section className="border-t border-[#E5E5E3] bg-[#F7F7F7] dark:border-[#2A2A27] dark:bg-[#161614]">
        <div className="mx-auto grid max-w-[1440px] grid-cols-1 items-stretch lg:grid-cols-12">
          <div className="flex flex-col justify-between p-6 sm:p-10 lg:col-span-6 lg:p-14">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] text-[#5C5C58] uppercase dark:text-[#A8A8A0]">
                <Compass className="h-3.5 w-3.5" />
                <span>{lang === 'ar' ? 'استوديو القصّات والحملات' : 'FIT STUDIO & CAMPAIGNS'}</span>
              </div>
              <h2 className="mt-2 font-display text-3xl font-bold text-[#111111] sm:text-4xl dark:text-[#F5F5F2]">
                {lang === 'ar' ? 'قصة Boxy مضبوطة على مقاسك.' : 'ARCHITECTURAL FIT STUDIO.'}
              </h2>
              <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#5C5C58] dark:text-[#A8A8A0]">
                {lang === 'ar'
                  ? 'استخدم حاسبة المقاس التفاعلية في صفحة القصّات، وقارن أوزان الأقمشة الثقيلة (300 إلى 520 GSM) قبل طلب قطعتك.'
                  : 'Use our interactive size recommender in the Fit Studio to dial in your exact height, weight, and drape preference.'}
              </p>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onNavigateFitGuide}
                className="inline-flex h-12 items-center gap-2 bg-[#111111] px-7 text-xs font-bold tracking-wider text-white uppercase hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
              >
                <span>{lang === 'ar' ? 'افتح دليل القصّات وحاسبة المقاس' : 'Open Fit Studio & Calculator'}</span>
                {lang === 'ar' ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </button>

              {featuredCampaign && (
                <button
                  type="button"
                  onClick={() => onNavigateLandingPage(featuredCampaign.slug)}
                  className="inline-flex h-12 items-center border border-[#111111] bg-white px-6 text-xs font-bold text-[#111111] hover:bg-[#111111] hover:text-white dark:border-[#F5F5F2] dark:bg-[#0D0D0C] dark:text-[#F5F5F2]"
                >
                  {lang === 'ar' ? featuredCampaign.title_ar : featuredCampaign.title_en}
                </button>
              )}
            </div>
          </div>

          <div className="aspect-[4/3] overflow-hidden border-t border-[#E5E5E3] lg:col-span-6 lg:aspect-auto lg:min-h-[420px] lg:border-t-0 lg:border-s dark:border-[#2A2A27]">
            <ImageWithFallback
              src="/src/assets/images/cat_hoodies_editorial_1794551311689.jpg"
              alt={lang === 'ar' ? 'استوديو القصّات YUOP' : 'YUOP Fit Studio'}
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </section>
    </main>
  );
}

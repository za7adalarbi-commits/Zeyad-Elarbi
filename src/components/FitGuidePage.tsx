/**
 * ============================================================================
 * صفحة دليل القصّات والحاسبة التفاعلية للمقاسات واللوك بوك (Fit Studio — /fit-guide)
 * صفحة مستقلة تفاعلية لاختيار القصة المناسبة، حساب المقاس المثالي بالطول والوزن،
 * واستعراض الحملات التسويقية المنشورة.
 * ============================================================================
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Ruler, Sparkles } from 'lucide-react';
import type { LandingPage, Product } from '../shared/types.ts';
import type { Lang } from '../lib/i18n.ts';
import { recommendStreetwearSize, type FitPreference } from '../shared/orderRules.ts';
import { ImageWithFallback } from './ImageWithFallback.tsx';

interface FitGuidePageProps {
  products: Product[];
  landingPages: LandingPage[];
  lang: Lang;
  onOpenProduct: (productId: number) => void;
  onOpenShop: (category?: string) => void;
  onOpenLandingPage: (slug: string) => void;
}

const FIT_SILHOUETTES = [
  {
    key: 'Hoodies',
    titleAr: 'قصة Boxy الثقيلة — 480 GSM',
    titleEn: 'Boxy Heavyweight Hoodie — 480 GSM',
    descAr: 'أكتاف ساقطة وقصة مربعة متوازنة تمنح القطعة حضورًا معماريًا ثابتًا بدون ترهل.',
    descEn: 'Dropped shoulders with an engineered boxy body that holds sculptural drape all day.',
    specsAr: 'الصدر: مريح +6 سم · الطول: متوازن · الغسيل: إنزيمي فحمي',
    specsEn: 'Chest: +6 cm ease · Length: Cropped-balanced · Finish: Charcoal enzyme wash',
    image: '/src/assets/images/cat_hoodies_editorial_1794551311689.jpg',
  },
  {
    key: 'Tees',
    titleAr: 'تيشيرت تشوك الواسع — 300 GSM',
    titleEn: 'Chalk Boxy Tee — 300 GSM',
    descAr: 'تيشيرت قطن سنجل جيرسي ثقيل غير شفاف مع ياقة مضلعة بسمك 2.8 سم لا ترتخي مع الغسيل.',
    descEn: 'Dense 300 GSM combed jersey with a crisp 2.8 cm ribbed collar engineered to stay flat.',
    specsAr: 'الأكمام: نصف كم واسع · القطن: 100% مصري · الانكماش: معالج مسبقًا',
    specsEn: 'Sleeves: Wide mid-elbow · Fabric: 100% Egyptian Cotton · Pre-shrunk',
    image: '/src/assets/images/cat_tees_editorial_1794551311360.jpg',
  },
  {
    key: 'Cargos',
    titleAr: 'كارجو سليت الواسع — ريبستوب تقني',
    titleEn: 'Slate Technical Cargo — Ripstop',
    descAr: 'بنطلون بجيوب جانبية ثلاثية الأبعاد وتضييق سفلي مخفي لتنسيق الحذاء الرياضي بحرية.',
    descEn: 'Articulated knees, 3D cargo pockets, and hidden hem toggle for customizable sneaker stack.',
    specsAr: 'القصة: Straight Wide · الخصر: مريح مع أربطة · النسيج: ريبستوب مضاد للتمزق',
    specsEn: 'Fit: Straight Wide · Waist: Adjustable drawcord · Fabric: Heavyweight Ripstop',
    image: '/src/assets/images/cat_cargos_editorial_1794551311969.jpg',
  },
  {
    key: 'Jackets',
    titleAr: 'جاكيت وورك وير كروبد — 520 GSM',
    titleEn: 'Cropped Workwear Jacket — 520 GSM',
    descAr: 'كانفاس قطني فائق التحمل مبطن بطبقة مريحة وقصة كروبد قصيرة تبرز طبقات الستريت وير.',
    descEn: 'Heavy 520 GSM brushed cotton canvas with clean boxy cropped proportion for layering.',
    specsAr: 'السحاب: معدني YKK · الجيوب: داخلية وخارجية · القصة: Boxy Cropped',
    specsEn: 'Zipper: Heavy YKK brass · Lining: Brushed cotton · Cut: Boxy Cropped',
    image: '/src/assets/images/product_jacket_bomber_1794549971089.jpg',
  },
];

export function FitGuidePage({
  products,
  landingPages,
  lang,
  onOpenProduct,
  onOpenShop,
  onOpenLandingPage,
}: FitGuidePageProps) {
  const [activeFitIdx, setActiveFitIdx] = useState(0);
  const [heightCm, setHeightCm] = useState(175);
  const [weightKg, setWeightKg] = useState(72);
  const [fitPreference, setFitPreference] = useState<FitPreference>('boxy');

  const activeFit = FIT_SILHOUETTES[activeFitIdx] || FIT_SILHOUETTES[0];
  const recommendedProduct = products.find((p) => p.category === activeFit.key) || products[0];
  const recommendation = useMemo(
    () => recommendStreetwearSize(heightCm, weightKg, fitPreference),
    [heightCm, weightKg, fitPreference]
  );

  const activeCampaigns = landingPages.filter((lp) => lp.is_published);

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-12">
      {/* عنوان الصفحة */}
      <div className="border-b border-[#E5E5E3] pb-6 dark:border-[#2A2A27]">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-[#5C5C58] uppercase dark:text-[#A8A8A0]">
          {lang === 'ar' ? 'استوديو القصّات والخامات' : 'SILHOUETTES & FIT STUDIO'}
        </p>
        <h1 className="mt-1 font-display text-3xl font-bold text-[#111111] sm:text-4xl dark:text-[#F5F5F2]">
          {lang === 'ar' ? 'اكتشف القصة والمقاس المناسب لك.' : 'FIND YOUR PERFECT FIT.'}
        </h1>
      </div>

      {/* القسم 1: مستكشف القصّات */}
      <section className="mt-8 grid grid-cols-1 items-stretch border border-[#E5E5E3] bg-[#F7F7F7] lg:grid-cols-12 dark:border-[#2A2A27] dark:bg-[#161614]">
        <div className="flex flex-col justify-between p-6 sm:p-10 lg:col-span-6">
          <div>
            <div className="flex flex-wrap gap-2">
              {FIT_SILHOUETTES.map((fit, idx) => (
                <button
                  key={fit.key}
                  type="button"
                  onClick={() => setActiveFitIdx(idx)}
                  className={`h-11 border px-4 text-xs font-semibold transition-colors ${
                    idx === activeFitIdx
                      ? 'border-[#111111] bg-[#111111] text-white dark:border-[#F5F5F2] dark:bg-[#F5F5F2] dark:text-[#111111]'
                      : 'border-[#E5E5E3] bg-white text-[#111111] hover:border-[#111111] dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#F5F5F2]'
                  }`}
                >
                  {lang === 'ar' ? fit.titleAr.split('—')[0].trim() : fit.titleEn.split('—')[0].trim()}
                </button>
              ))}
            </div>

            <div className="mt-8 border-t border-[#E5E5E3] pt-6 dark:border-[#2A2A27]">
              <h2 className="text-xl font-bold text-[#111111] dark:text-[#F5F5F2]">
                {lang === 'ar' ? activeFit.titleAr : activeFit.titleEn}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#5C5C58] dark:text-[#A8A8A0]">
                {lang === 'ar' ? activeFit.descAr : activeFit.descEn}
              </p>
              <p className="mt-4 font-mono-tabular text-xs font-medium text-[#111111] dark:text-[#F5F5F2]">
                {lang === 'ar' ? activeFit.specsAr : activeFit.specsEn}
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3 pt-4">
            {recommendedProduct && (
              <button
                type="button"
                onClick={() => onOpenProduct(recommendedProduct.id)}
                className="inline-flex h-12 items-center gap-2 bg-[#111111] px-6 text-xs font-bold text-white dark:bg-[#F5F5F2] dark:text-[#111111]"
              >
                <span>{lang === 'ar' ? 'فتح صفحة القطعة' : 'Inspect Piece'}</span>
                {lang === 'ar' ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenShop(activeFit.key)}
              className="inline-flex h-12 items-center border border-[#111111] bg-white px-6 text-xs font-bold text-[#111111] dark:border-[#F5F5F2] dark:bg-[#0D0D0C] dark:text-[#F5F5F2]"
            >
              {lang === 'ar' ? 'تصفح الفئة بالتشكيلة' : 'Shop Category'}
            </button>
          </div>
        </div>

        <div className="aspect-[4/3] overflow-hidden border-t border-[#E5E5E3] lg:col-span-6 lg:aspect-auto lg:min-h-[460px] lg:border-t-0 lg:border-s dark:border-[#2A2A27]">
          <ImageWithFallback
            src={activeFit.image}
            alt={lang === 'ar' ? activeFit.titleAr : activeFit.titleEn}
            className="h-full w-full object-cover"
          />
        </div>
      </section>

      {/* القسم 2: حاسبة المقاس التفاعلية */}
      <section className="mt-12 grid grid-cols-1 gap-6 border border-[#E5E5E3] bg-white p-6 sm:p-8 lg:grid-cols-12 dark:border-[#2A2A27] dark:bg-[#161614]">
        <div className="space-y-5 lg:col-span-7">
          <div className="flex items-center gap-2">
            <Ruler className="h-5 w-5" />
            <h2 className="text-xl font-bold">{lang === 'ar' ? 'حاسبة المقاس التفاعلية' : 'Interactive Size Recommender'}</h2>
          </div>
          <p className="text-xs leading-relaxed text-[#5C5C58] dark:text-[#A8A8A0]">
            {lang === 'ar'
              ? 'أدخل طولك ووزنك واختر القصة المفضلة ليقترح عليك النظام المقاس الأدق في قصّات YUOP.'
              : 'Dial in your height, weight, and preferred silhouette to get the exact YUOP size recommendation.'}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="fit-height" className="flex justify-between text-xs font-semibold">
                <span>{lang === 'ar' ? 'الطول (سم)' : 'Height (cm)'}</span>
                <span className="font-mono-tabular">{heightCm} cm</span>
              </label>
              <input
                id="fit-height"
                type="range"
                min={155}
                max={200}
                value={heightCm}
                onChange={(e) => setHeightCm(Number(e.target.value))}
                className="mt-2 w-full accent-[#111111] dark:accent-[#F5F5F2]"
              />
            </div>

            <div>
              <label htmlFor="fit-weight" className="flex justify-between text-xs font-semibold">
                <span>{lang === 'ar' ? 'الوزن (كجم)' : 'Weight (kg)'}</span>
                <span className="font-mono-tabular">{weightKg} kg</span>
              </label>
              <input
                id="fit-weight"
                type="range"
                min={48}
                max={120}
                value={weightKg}
                onChange={(e) => setWeightKg(Number(e.target.value))}
                className="mt-2 w-full accent-[#111111] dark:accent-[#F5F5F2]"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold">{lang === 'ar' ? 'تفضيل القصة' : 'Fit Preference'}</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                { id: 'regular' as FitPreference, ar: 'مضبوط', en: 'Regular' },
                { id: 'boxy' as FitPreference, ar: 'Boxy متوازن', en: 'Boxy' },
                { id: 'oversized' as FitPreference, ar: 'أوفرسايز واسع', en: 'Oversized' },
              ].map((pref) => (
                <button
                  key={pref.id}
                  type="button"
                  onClick={() => setFitPreference(pref.id)}
                  className={`h-11 border text-xs font-semibold transition-colors ${
                    fitPreference === pref.id
                      ? 'border-[#111111] bg-[#111111] text-white dark:border-[#F5F5F2] dark:bg-[#F5F5F2] dark:text-[#111111]'
                      : 'border-[#E5E5E3] bg-[#F7F7F7] dark:border-[#2A2A27] dark:bg-[#0D0D0C]'
                  }`}
                >
                  {lang === 'ar' ? pref.ar : pref.en}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between border border-[#E5E5E3] bg-[#F7F7F7] p-6 lg:col-span-5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
          <div>
            <p className="text-[11px] font-semibold tracking-wider text-[#5C5C58] uppercase dark:text-[#A8A8A0]">
              {lang === 'ar' ? 'المقاس المقترح لك' : 'RECOMMENDED SIZE'}
            </p>
            <div data-testid="recommended-size-badge" className="mt-2 font-display text-5xl font-bold">
              {recommendation.size}
            </div>
            <p className="mt-2 text-xs font-medium text-[#5C5C58] dark:text-[#A8A8A0]">
              {lang === 'ar' ? recommendation.noteAr : recommendation.noteEn}
            </p>

            <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[#E5E5E3] pt-4 text-center font-mono-tabular text-xs dark:border-[#2A2A27]">
              <div>
                <span className="block text-[10px] text-[#5C5C58] dark:text-[#A8A8A0]">{lang === 'ar' ? 'الصدر' : 'Chest'}</span>
                <strong>{recommendation.chestCm} cm</strong>
              </div>
              <div>
                <span className="block text-[10px] text-[#5C5C58] dark:text-[#A8A8A0]">{lang === 'ar' ? 'الطول' : 'Length'}</span>
                <strong>{recommendation.lengthCm} cm</strong>
              </div>
              <div>
                <span className="block text-[10px] text-[#5C5C58] dark:text-[#A8A8A0]">{lang === 'ar' ? 'الأكتاف' : 'Shoulder'}</span>
                <strong>{recommendation.shoulderCm} cm</strong>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onOpenShop('ALL')}
            className="mt-6 h-12 w-full bg-[#111111] text-xs font-bold text-white dark:bg-[#F5F5F2] dark:text-[#111111]"
          >
            {lang === 'ar' ? `تسوق الآن بمقاس ${recommendation.size}` : `Shop Size ${recommendation.size}`}
          </button>
        </div>
      </section>

      {/* القسم 3: الحملات والإصدارات الخاصة */}
      {activeCampaigns.length > 0 && (
        <section className="mt-12">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            <h2 className="font-display text-2xl font-bold">{lang === 'ar' ? 'الإصدارات والحملات المنشورة' : 'ACTIVE CAMPAIGNS'}</h2>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
            {activeCampaigns.map((lp) => (
              <button
                key={lp.id}
                type="button"
                onClick={() => onOpenLandingPage(lp.slug)}
                className="group relative flex min-h-[260px] items-end overflow-hidden bg-[#141413] p-6 text-start text-white"
              >
                <ImageWithFallback
                  src={lp.hero_image_url}
                  alt={lang === 'ar' ? lp.title_ar : lp.title_en}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
                <div className="relative z-10">
                  <p className="text-[11px] font-semibold tracking-wider text-neutral-300 uppercase">
                    {lang === 'ar' ? lp.kicker_ar : lp.kicker_en}
                  </p>
                  <h3 className="mt-1 text-2xl font-bold">{lang === 'ar' ? lp.title_ar : lp.title_en}</h3>
                  <p className="mt-1.5 max-w-md text-xs text-neutral-200">
                    {lang === 'ar' ? lp.subtitle_ar : lp.subtitle_en}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

/**
 * ============================================================================
 * صفحة التشكيلة الكاملة والتصفية التفاعلية (Shop & Collections Page — /shop)
 * تضم بحثًا مباشرًا، فلاتر فئات أفقية مريحة للهاتف، فلتر المخزون، الترتيب،
 * وبطاقات منتجات تفتح صفحة تفاصيل المنتج /product/:id مع إضافة سريعة للمقاس.
 * ============================================================================
 */
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Search, SlidersHorizontal, X } from 'lucide-react';
import type { Product, StoreSettings } from '../shared/types.ts';
import type { Lang } from '../lib/i18n.ts';
import { filterAndSortProducts } from '../shared/orderRules.ts';
import { ImageWithFallback } from './ImageWithFallback.tsx';

interface ShopPageProps {
  products: Product[];
  settings: StoreSettings;
  lang: Lang;
  initialCategory: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectCategory: (cat: string) => void;
  onOpenProduct: (productId: number) => void;
  onQuickAdd: (product: Product, size: string) => void;
}

const CATEGORIES = [
  { key: 'ALL', ar: 'جميع القطع', en: 'All Pieces' },
  { key: 'Hoodies', ar: 'هوديز وسويت شيرت', en: 'Hoodies & Fleece' },
  { key: 'Tees', ar: 'تيشيرتات بوكسي', en: 'Boxy Tees' },
  { key: 'Cargos', ar: 'كارجو وبناطيل', en: 'Cargos & Bottoms' },
  { key: 'Jackets', ar: 'جاكيتات', en: 'Outerwear' },
];

type SortMode = 'featured' | 'price-asc' | 'price-desc';

export function ShopPage({
  products,
  settings,
  lang,
  initialCategory,
  searchQuery,
  onSearchChange,
  onSelectCategory,
  onOpenProduct,
  onQuickAdd,
}: ShopPageProps) {
  const [sortMode, setSortMode] = useState<SortMode>('featured');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);

  const filteredProducts = useMemo(
    () =>
      filterAndSortProducts(products, {
        category: initialCategory,
        query: searchQuery,
        onlyInStock,
        sortMode,
      }),
    [products, initialCategory, searchQuery, onlyInStock, sortMode]
  );

  const handleQuickSizeClick = (product: Product, size: string) => {
    const key = `${product.id}-${size}`;
    setJustAddedKey(key);
    onQuickAdd(product, size);
    setTimeout(() => {
      setJustAddedKey((prev) => (prev === key ? null : prev));
    }, 1200);
  };

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-12">
      {/* رأس الصفحة */}
      <div className="flex flex-col gap-4 border-b border-[#E5E5E3] pb-6 md:flex-row md:items-end md:justify-between dark:border-[#2A2A27]">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-[#5C5C58] uppercase dark:text-[#A8A8A0]">
            {lang === 'ar' ? 'كتالوج YUOP التفاعلي' : 'YUOP ARCHIVE & DROP 01'}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <h1 className="font-display text-3xl font-bold tracking-tight text-[#111111] sm:text-4xl dark:text-[#F5F5F2]">
              {lang === 'ar' ? 'التشكيلة الكاملة.' : 'THE COLLECTION.'}
            </h1>
            <span data-testid="catalog-count" className="font-mono-tabular text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
              {lang === 'ar' ? `${filteredProducts.length} قطعة` : `${filteredProducts.length} pieces`}
            </span>
          </div>
        </div>

        {/* شريط البحث والفرز السريع داخل الصفحة */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 start-3 h-3.5 w-3.5 -translate-y-1/2 text-[#5C5C58]" />
            <input
              id="shop-page-search"
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={lang === 'ar' ? 'ابحث في التشكيلة...' : 'Filter by title or category...'}
              className="h-11 w-full border border-[#E5E5E3] bg-[#F7F7F7] ps-9 pe-8 text-xs focus:border-[#111111] focus:bg-white focus:outline-none dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#F5F5F2] dark:focus:border-[#F5F5F2]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label={lang === 'ar' ? 'مسح البحث' : 'Clear'}
                className="absolute top-1/2 end-2.5 -translate-y-1/2 p-1 text-[#5C5C58]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileFilterOpen(true)}
            className="inline-flex h-11 items-center gap-2 border border-[#E5E5E3] bg-white px-4 text-xs font-semibold md:hidden dark:border-[#2A2A27] dark:bg-[#161614]"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>{lang === 'ar' ? 'ترتيب وتصفية' : 'Sort & Filter'}</span>
          </button>

          <div className="hidden items-center gap-2 md:flex">
            <button
              type="button"
              onClick={() => setOnlyInStock((v) => !v)}
              aria-pressed={onlyInStock}
              className={`h-11 border px-3.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                onlyInStock
                  ? 'border-[#111111] bg-[#111111] text-white dark:border-[#F5F5F2] dark:bg-[#F5F5F2] dark:text-[#111111]'
                  : 'border-[#E5E5E3] bg-white text-[#5C5C58] hover:border-[#111111] dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#A8A8A0]'
              }`}
            >
              {lang === 'ar' ? 'المتوفر فقط' : 'In Stock Only'}
            </button>

            <div className="relative flex items-center border border-[#E5E5E3] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#161614]">
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#5C5C58] dark:text-[#A8A8A0]" />
              <select
                aria-label={lang === 'ar' ? 'ترتيب المنتجات' : 'Sort products'}
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="h-11 bg-transparent px-2 text-xs font-medium text-[#111111] focus:outline-none dark:bg-[#161614] dark:text-[#F5F5F2]"
              >
                <option value="featured">{lang === 'ar' ? 'الترتيب: المميز' : 'Sort: Featured'}</option>
                <option value="price-asc">{lang === 'ar' ? 'السعر: الأقل للأعلى' : 'Price: Low to High'}</option>
                <option value="price-desc">{lang === 'ar' ? 'السعر: الأعلى للأقل' : 'Price: High to Low'}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* أزرار الفئات الأفقية السلسة (قابلة للتمرير أفقياً على الهاتف) */}
      <div className="mt-5 flex items-center gap-2 overflow-x-auto pb-2" role="tablist" aria-label={lang === 'ar' ? 'فئات التشكيلة' : 'Categories'}>
        {CATEGORIES.map((cat) => {
          const active = initialCategory === cat.key;
          return (
            <button
              key={cat.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectCategory(cat.key)}
              className={`h-11 shrink-0 border px-4 text-xs font-semibold whitespace-nowrap transition-colors ${
                active
                  ? 'border-[#111111] bg-[#111111] text-white dark:border-[#F5F5F2] dark:bg-[#F5F5F2] dark:text-[#111111]'
                  : 'border-[#E5E5E3] bg-[#F7F7F7] text-[#5C5C58] hover:border-[#111111] hover:text-[#111111] dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#A8A8A0] dark:hover:text-white'
              }`}
            >
              {lang === 'ar' ? cat.ar : cat.en}
            </button>
          );
        })}
      </div>

      {/* شبكة المنتجات */}
      {filteredProducts.length === 0 ? (
        <div className="my-12 border border-[#E5E5E3] bg-[#F7F7F7] p-12 text-center dark:border-[#2A2A27] dark:bg-[#161614]">
          <p className="text-base font-semibold text-[#111111] dark:text-[#F5F5F2]">
            {lang === 'ar' ? 'لا توجد قطع مطابقة للفلاتر الحالية' : 'No matching pieces found'}
          </p>
          <button
            type="button"
            onClick={() => {
              onSelectCategory('ALL');
              onSearchChange('');
              setOnlyInStock(false);
            }}
            className="mt-4 h-11 border border-[#111111] bg-white px-6 text-xs font-semibold hover:bg-[#111111] hover:text-white dark:border-[#F5F5F2] dark:bg-[#0D0D0C] dark:text-[#F5F5F2]"
          >
            {lang === 'ar' ? 'إعادة ضبط الفلاتر' : 'Reset Filters'}
          </button>
        </div>
      ) : (
        <div
          id="yuop-catalog"
          className={`mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 lg:grid-cols-3 ${
            filteredProducts.length > 6 ? 'xl:grid-cols-4' : ''
          }`}
        >
          {filteredProducts.map((product) => {
            const title = lang === 'ar' ? product.name_ar : product.name_en;
            const sizesEntries = Object.entries(product.sizes_stock || {});
            const totalStock = sizesEntries.reduce((s, [, q]) => s + Number(q), 0);

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

                  {/* شريط الإضافة السريعة على سطح المكتب */}
                  <div className="pointer-events-auto absolute inset-x-2 bottom-2 hidden translate-y-2 border border-[#E5E5E3] bg-white/95 p-2 opacity-0 backdrop-blur-sm transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 md:block dark:border-[#2A2A27] dark:bg-[#161614]/95">
                    <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">
                      <span>{lang === 'ar' ? 'إضافة سريعة' : 'QUICK ADD'}</span>
                      <button
                        type="button"
                        onClick={() => onOpenProduct(product.id)}
                        className="underline hover:text-[#111111] dark:hover:text-white"
                      >
                        {lang === 'ar' ? 'عرض الصفحة' : 'View Page'}
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
                            className={`flex h-9 items-center justify-center font-mono-tabular text-[11px] font-semibold transition-colors ${
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
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">
                      <span>{product.category}</span>
                      {product.badge_text && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-[#111111] dark:text-[#F5F5F2]">{product.badge_text}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>
                        {totalStock > 0
                          ? lang === 'ar'
                            ? 'متوفر'
                            : 'In Stock'
                          : lang === 'ar'
                            ? 'نفد'
                            : 'Sold Out'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenProduct(product.id)}
                      className="mt-1 block text-start text-sm font-semibold leading-snug text-[#111111] hover:underline dark:text-[#F5F5F2]"
                    >
                      {title}
                    </button>
                  </div>

                  <div className="mt-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono-tabular text-sm font-bold whitespace-nowrap text-[#111111] dark:text-[#F5F5F2]">
                        {product.price.toLocaleString()} {settings.currency_symbol_ar}
                      </span>
                      {product.compare_at_price && product.compare_at_price > product.price && (
                        <span className="font-mono-tabular text-xs text-[#7A7A74] line-through">
                          {product.compare_at_price.toLocaleString()}
                        </span>
                      )}
                    </div>

                    {/* أزرار لمس مباشرة للمقاسات على الهاتف (بدون الاعتماد على Hover) */}
                    <div className="mt-2.5 grid grid-cols-4 gap-1 md:hidden">
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
                            className={`flex h-9 items-center justify-center border font-mono-tabular text-[11px] font-semibold ${
                              out
                                ? 'border-[#E5E5E3] text-[#9E9E98] line-through dark:border-[#2A2A27] dark:text-[#5C5C58]'
                                : added
                                  ? 'border-emerald-700 bg-emerald-700 text-white'
                                  : 'border-[#E5E5E3] bg-[#F7F7F7] text-[#111111] active:bg-[#111111] active:text-white dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#F5F5F2]'
                            }`}
                          >
                            {added ? <Check className="h-3.5 w-3.5" /> : sizeKey}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenProduct(product.id)}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#5C5C58] underline underline-offset-4 hover:text-[#111111] md:hidden dark:text-[#A8A8A0]"
                    >
                      <span>{lang === 'ar' ? 'تفاصيل القطعة' : 'View Piece'}</span>
                      {lang === 'ar' ? <ArrowLeft className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ورقة التصفية والترتيب السفلية للهاتف (Mobile Filter Bottom Sheet) */}
      {mobileFilterOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:hidden" role="dialog" aria-modal="true" aria-label={lang === 'ar' ? 'ترتيب وتصفية' : 'Sort & Filter'}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => setMobileFilterOpen(false)} />
          <div className="relative z-10 w-full rounded-t-2xl border-t border-[#E5E5E3] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#D0D0CB] dark:bg-[#3A3A36]" />
            <div className="flex items-center justify-between border-b border-[#E5E5E3] pb-3 dark:border-[#2A2A27]">
              <h2 className="text-sm font-bold">{lang === 'ar' ? 'الترتيب والتصفية' : 'Sort & Filter'}</h2>
              <button
                type="button"
                onClick={() => setMobileFilterOpen(false)}
                aria-label="إغلاق"
                className="flex h-10 w-10 items-center justify-center border border-[#E5E5E3] dark:border-[#2A2A27]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <p className="text-xs font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">
                  {lang === 'ar' ? 'الترتيب حسب' : 'Sort by'}
                </p>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {[
                    { id: 'featured' as SortMode, ar: 'المميز أولًا', en: 'Featured' },
                    { id: 'price-asc' as SortMode, ar: 'السعر: الأقل للأعلى', en: 'Price: Low to High' },
                    { id: 'price-desc' as SortMode, ar: 'السعر: الأعلى للأقل', en: 'Price: High to Low' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSortMode(opt.id)}
                      className={`h-11 border px-4 text-start text-xs font-semibold ${
                        sortMode === opt.id
                          ? 'border-[#111111] bg-[#111111] text-white dark:border-[#F5F5F2] dark:bg-[#F5F5F2] dark:text-[#111111]'
                          : 'border-[#E5E5E3] dark:border-[#2A2A27]'
                      }`}
                    >
                      {lang === 'ar' ? opt.ar : opt.en}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOnlyInStock((v) => !v)}
                className={`flex h-11 w-full items-center justify-between border px-4 text-xs font-semibold ${
                  onlyInStock
                    ? 'border-[#111111] bg-[#111111] text-white dark:border-[#F5F5F2] dark:bg-[#F5F5F2] dark:text-[#111111]'
                    : 'border-[#E5E5E3] dark:border-[#2A2A27]'
                }`}
              >
                <span>{lang === 'ar' ? 'عرض القطع المتوفرة بالمخزون فقط' : 'Show in-stock pieces only'}</span>
                {onlyInStock && <Check className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={() => setMobileFilterOpen(false)}
                className="h-12 w-full bg-[#111111] text-xs font-bold text-white dark:bg-[#F5F5F2] dark:text-[#111111]"
              >
                {lang === 'ar' ? `عرض النتائج (${filteredProducts.length})` : `Show ${filteredProducts.length} Results`}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

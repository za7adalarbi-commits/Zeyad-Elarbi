/**
 * ============================================================================
 * الغلاف الموحد للمتجر متعدد الصفحات (StoreLayout)
 * يضم الهيدر النظيف + البحث اللحظي + درج التنقل للهاتف + شريط الإبهام السفلي + التذييل.
 * يلتزم بنسبة العناصر المثبتة <= 15% من شاشة الهاتف ومناطق لمس >= 44px.
 * ============================================================================
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Check,
  Compass,
  Globe,
  Home,
  LayoutGrid,
  Menu,
  Moon,
  PackageSearch,
  Search,
  Settings,
  ShoppingBag,
  Sun,
  X,
} from 'lucide-react';
import type {
  LandingPage,
  Product,
  SocialLink,
  StoreSettings,
  ThemeMode,
} from '../shared/types.ts';
import type { Lang } from '../lib/i18n.ts';
import { matchesProductSearch } from '../shared/orderRules.ts';
import { ImageWithFallback } from './ImageWithFallback.tsx';
import { SocialPlatformIcon } from './SocialIcons.tsx';

export type CustomerRoute = 'home' | 'shop' | 'product' | 'fit' | 'track' | 'landing';

interface StoreLayoutProps {
  currentRoute: CustomerRoute;
  settings: StoreSettings;
  products: Product[];
  socialLinks: SocialLink[];
  landingPages: LandingPage[];
  cartCount: number;
  lang: Lang;
  theme: ThemeMode;
  searchQuery: string;
  hideMobileBottomNav?: boolean;
  onSearchChange: (q: string) => void;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  onOpenCart: () => void;
  onNavigateHome: () => void;
  onNavigateShop: (category?: string) => void;
  onNavigateProduct: (productId: number) => void;
  onNavigateFitGuide: () => void;
  onNavigateTrack: () => void;
  onNavigateLandingPage: (slug: string) => void;
  onNavigateAdmin: () => void;
  children: ReactNode;
}

const SHOP_CATEGORIES = [
  { key: 'ALL', ar: 'جميع القطع', en: 'All Pieces' },
  { key: 'Hoodies', ar: 'هوديز وسويت شيرت', en: 'Hoodies & Fleece' },
  { key: 'Tees', ar: 'تيشيرتات بوكسي', en: 'Boxy Tees' },
  { key: 'Cargos', ar: 'كارجو وبناطيل', en: 'Cargos & Bottoms' },
  { key: 'Jackets', ar: 'جاكيتات', en: 'Outerwear' },
];

export function StoreLayout({
  currentRoute,
  settings,
  products,
  socialLinks,
  landingPages,
  cartCount,
  lang,
  theme,
  searchQuery,
  hideMobileBottomNav = false,
  onSearchChange,
  onToggleLang,
  onToggleTheme,
  onOpenCart,
  onNavigateHome,
  onNavigateShop,
  onNavigateProduct,
  onNavigateFitGuide,
  onNavigateTrack,
  onNavigateLandingPage,
  onNavigateAdmin,
  children,
}: StoreLayoutProps) {
  const [scrolled, setScrolled] = useState(false);
  const [headerSearchFocused, setHeaderSearchFocused] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterSubscribed, setNewsletterSubscribed] = useState(false);
  const headerSearchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 36);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (headerSearchRef.current && !headerSearchRef.current.contains(e.target as Node)) {
        setHeaderSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const headerQuickMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return products.filter((p) => matchesProductSearch(p, searchQuery)).slice(0, 5);
  }, [products, searchQuery]);

  const footerCampaigns = landingPages.filter((lp) => lp.is_published && lp.show_in_footer);
  const isHomeTopDarkHeader = currentRoute === 'home' && !scrolled;

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setHeaderSearchFocused(false);
    setMobileSearchOpen(false);
    onNavigateShop('ALL');
  };

  const handleNewsletterSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!newsletterEmail.trim()) return;
    setNewsletterSubscribed(true);
    setNewsletterEmail('');
  };

  const navItems: Array<{ id: CustomerRoute; ar: string; en: string; action: () => void }> = [
    { id: 'home', ar: 'الرئيسية', en: 'Home', action: onNavigateHome },
    { id: 'shop', ar: 'التشكيلة', en: 'Shop', action: () => onNavigateShop('ALL') },
    { id: 'fit', ar: 'دليل القصّات', en: 'Fit Studio', action: onNavigateFitGuide },
    { id: 'track', ar: 'تتبع الطلب', en: 'Track Order', action: onNavigateTrack },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-[#FFFFFF] text-[#111111] transition-colors dark:bg-[#0D0D0C] dark:text-[#F5F5F2]">
      {/* شريط الإعلانات العلوي غير مثبت لعدم استهلاك مساحة التمرير على الهاتف */}
      {settings.announcement_enabled && (
        <div className="truncate border-b border-[#E5E5E3] bg-[#FFFFFF] px-4 py-1.5 text-center text-[11px] font-medium tracking-wider text-[#111111] uppercase dark:border-[#2A2A27] dark:bg-[#141413] dark:text-[#E5E5E0]">
          {lang === 'ar' ? settings.announcement_text_ar : settings.announcement_text_en}
        </div>
      )}

      {/* الهيدر الرئيسي المتوافق مع الموبايل وسطح المكتب بدون لوحة التحكم */}
      <header
        className={`sticky top-0 z-40 transition-colors duration-200 ${
          isHomeTopDarkHeader
            ? 'border-b border-white/10 bg-[#141413] text-white'
            : 'border-b border-[#E5E5E3] bg-white/95 text-[#111111] backdrop-blur-md dark:border-[#2A2A27] dark:bg-[#0D0D0C]/95 dark:text-[#F5F5F2]'
        }`}
      >
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-3 px-3 sm:h-16 sm:gap-6 sm:px-8">
          {/* اليمين/اليسار: زر القائمة على الهاتف + اسم البراند */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label={lang === 'ar' ? 'فتح قائمة المتجر' : 'Open store menu'}
              className={`flex h-11 w-11 items-center justify-center border transition-colors lg:hidden ${
                isHomeTopDarkHeader
                  ? 'border-white/25 bg-white/10 text-white'
                  : 'border-[#E5E5E3] text-[#111111] dark:border-[#2A2A27] dark:text-[#F5F5F2]'
              }`}
            >
              <Menu className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onNavigateHome}
              className="font-display shrink-0 whitespace-nowrap text-xl font-bold tracking-[0.2em] uppercase sm:text-2xl"
            >
              {settings.store_name}
            </button>
          </div>

          {/* المنطقة 2: روابط الصفحات الرئيسية على سطح المكتب */}
          <nav
            className={`hidden items-center gap-6 text-xs font-semibold tracking-wider uppercase lg:flex ${
              isHomeTopDarkHeader ? 'text-white/85' : 'text-[#5C5C58] dark:text-[#A8A8A0]'
            }`}
            aria-label={lang === 'ar' ? 'التنقل الرئيسي' : 'Main Navigation'}
          >
            {navItems.map((item) => {
              const isActive = currentRoute === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.action}
                  aria-current={isActive ? 'page' : undefined}
                  className={`shrink-0 whitespace-nowrap border-b-2 py-1 transition-colors ${
                    isActive
                      ? isHomeTopDarkHeader
                        ? 'border-white text-white'
                        : 'border-[#111111] text-[#111111] dark:border-[#F5F5F2] dark:text-[#F5F5F2]'
                      : 'border-transparent hover:underline underline-offset-4'
                  }`}
                >
                  {lang === 'ar' ? item.ar : item.en}
                </button>
              );
            })}
          </nav>

          {/* المنطقة 3: البحث اللحظي + مبدل الثيم + الحقيبة */}
          <div className="flex shrink-0 items-center gap-2">
            {/* بحث الهيدر لسطح المكتب والتابلت */}
            <div ref={headerSearchRef} className="relative hidden md:block">
              <form onSubmit={handleSearchSubmit} role="search" className="relative flex items-center">
                <Search
                  className={`pointer-events-none absolute start-3 h-3.5 w-3.5 ${
                    isHomeTopDarkHeader ? 'text-white/60' : 'text-[#5C5C58] dark:text-[#A8A8A0]'
                  }`}
                />
                <input
                  id="header-product-search"
                  type="search"
                  value={searchQuery}
                  onFocus={() => setHeaderSearchFocused(true)}
                  onChange={(e) => {
                    onSearchChange(e.target.value);
                    setHeaderSearchFocused(true);
                  }}
                  aria-label={lang === 'ar' ? 'بحث فوري عن المنتجات والفئات' : 'Search products by title or category'}
                  placeholder={lang === 'ar' ? 'ابحث عن منتج أو فئة...' : 'Search title or category...'}
                  className={`h-10 w-48 border ps-9 pe-8 text-xs transition-all focus:w-64 focus:outline-none ${
                    isHomeTopDarkHeader
                      ? 'border-white/25 bg-white/10 text-white placeholder:text-white/60 focus:border-white focus:bg-black/40'
                      : 'border-[#E5E5E3] bg-[#F7F7F7] text-[#111111] placeholder:text-[#7A7A74] focus:border-[#111111] focus:bg-white dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#F5F5F2] dark:focus:border-[#F5F5F2]'
                  }`}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => onSearchChange('')}
                    aria-label={lang === 'ar' ? 'مسح البحث' : 'Clear search'}
                    className="absolute end-2 p-0.5 opacity-70 hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </form>

              {headerSearchFocused && searchQuery.trim().length > 0 && (
                <div
                  data-testid="header-search-results"
                  className="absolute end-0 top-full z-50 mt-1.5 w-80 border border-[#E5E5E3] bg-white text-[#111111] shadow-xl dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#F5F5F2]"
                >
                  <div className="flex items-center justify-between border-b border-[#E5E5E3] px-3 py-2 text-[11px] font-semibold text-[#5C5C58] dark:border-[#2A2A27] dark:text-[#A8A8A0]">
                    <span>
                      {lang === 'ar'
                        ? `نتائج مطابقة (${headerQuickMatches.length})`
                        : `Matches (${headerQuickMatches.length})`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setHeaderSearchFocused(false);
                        onNavigateShop('ALL');
                      }}
                      className="underline hover:text-[#111111] dark:hover:text-white"
                    >
                      {lang === 'ar' ? 'عرض بالتشكيلة' : 'View in Shop'}
                    </button>
                  </div>
                  {headerQuickMatches.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
                      {lang === 'ar' ? 'لا توجد منتجات مطابقة.' : 'No matching pieces found.'}
                    </div>
                  ) : (
                    <ul className="divide-y divide-[#E5E5E3] dark:divide-[#2A2A27]">
                      {headerQuickMatches.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setHeaderSearchFocused(false);
                              onNavigateProduct(item.id);
                            }}
                            className="flex w-full items-center gap-3 p-2.5 text-start transition-colors hover:bg-[#F7F7F7] dark:hover:bg-[#1F1F1C]"
                          >
                            <div className="h-12 w-10 shrink-0 overflow-hidden bg-[#F7F7F7] dark:bg-[#22221F]">
                              <ImageWithFallback
                                src={item.image_url}
                                alt={lang === 'ar' ? item.name_ar : item.name_en}
                                className="h-full w-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-semibold">
                                {lang === 'ar' ? item.name_ar : item.name_en}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">
                                <span>{item.category}</span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono-tabular font-bold text-[#111111] dark:text-[#F5F5F2]">
                                  {item.price.toLocaleString()} {settings.currency_symbol_ar}
                                </span>
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* زر البحث للهاتف 44x44 */}
            <button
              type="button"
              onClick={() => setMobileSearchOpen((v) => !v)}
              aria-label={lang === 'ar' ? 'بحث في المنتجات' : 'Toggle search'}
              className={`flex h-11 w-11 items-center justify-center border transition-colors md:hidden ${
                isHomeTopDarkHeader
                  ? 'border-white/25 bg-white/10 text-white'
                  : 'border-[#E5E5E3] bg-transparent text-[#111111] dark:border-[#2A2A27] dark:text-[#F5F5F2]'
              }`}
            >
              {mobileSearchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            </button>

            {/* مبدل الوضع الليلي / الصباحي 44x44 */}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={
                theme === 'dark'
                  ? lang === 'ar'
                    ? 'التبديل للوضع الصباحي'
                    : 'Switch to Light Mode'
                  : lang === 'ar'
                    ? 'التبديل للوضع الليلي'
                    : 'Switch to Dark Mode'
              }
              className={`flex h-11 w-11 items-center justify-center border transition-colors sm:h-10 sm:w-10 ${
                isHomeTopDarkHeader
                  ? 'border-white/25 bg-white/10 text-white hover:bg-white hover:text-[#111111]'
                  : 'border-[#E5E5E3] bg-transparent text-[#111111] hover:border-[#111111] dark:border-[#2A2A27] dark:text-[#F5F5F2] dark:hover:border-[#F5F5F2]'
              }`}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* زر الحقيبة 44px */}
            <button
              type="button"
              onClick={onOpenCart}
              aria-label={lang === 'ar' ? `فتح حقيبة التسوق (${cartCount})` : `Open shopping bag (${cartCount})`}
              className={`inline-flex h-11 shrink-0 items-center gap-2 px-3 text-xs font-semibold whitespace-nowrap transition-colors sm:h-10 sm:px-4 ${
                isHomeTopDarkHeader
                  ? 'border border-white/25 bg-white/10 text-white hover:bg-white hover:text-[#111111]'
                  : 'bg-[#111111] text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111] dark:hover:bg-[#E0E0DA]'
              }`}
            >
              <ShoppingBag className="h-4 w-4" />
              <span className="hidden sm:inline">{lang === 'ar' ? 'الحقيبة' : 'Bag'}</span>
              <span className="font-mono-tabular">({cartCount})</span>
            </button>
          </div>
        </div>

        {/* شريط البحث التفاعلي المنسدل للهاتف */}
        {mobileSearchOpen && (
          <form
            onSubmit={handleSearchSubmit}
            className="border-t border-[#E5E5E3] bg-white px-3 py-2.5 md:hidden dark:border-[#2A2A27] dark:bg-[#161614]"
          >
            <div className="relative flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 start-3 h-4 w-4 -translate-y-1/2 text-[#5C5C58]" />
                <input
                  type="search"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder={lang === 'ar' ? 'ابحث باسم القطعة أو الفئة...' : 'Search products or category...'}
                  className="h-11 w-full border border-[#E5E5E3] bg-[#F7F7F7] ps-9 pe-3 text-xs text-[#111111] focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#F5F5F2]"
                />
              </div>
              <button
                type="submit"
                className="h-11 bg-[#111111] px-4 text-xs font-semibold text-white dark:bg-[#F5F5F2] dark:text-[#111111]"
              >
                {lang === 'ar' ? 'بحث' : 'Go'}
              </button>
            </div>
          </form>
        )}
      </header>

      {/* درج القائمة الجانبية للهاتف (Mobile Slide-Over Navigation) */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label={lang === 'ar' ? 'قائمة التنقل' : 'Store Menu'}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative z-10 flex h-full w-full max-w-xs flex-col justify-between bg-white p-5 text-[#111111] shadow-2xl dark:bg-[#111110] dark:text-[#F5F5F2]">
            <div className="overflow-y-auto">
              <div className="flex items-center justify-between border-b border-[#E5E5E3] pb-4 dark:border-[#2A2A27]">
                <span className="font-display text-xl font-bold tracking-[0.2em] uppercase">{settings.store_name}</span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label={lang === 'ar' ? 'إغلاق القائمة' : 'Close menu'}
                  className="flex h-11 w-11 items-center justify-center border border-[#E5E5E3] dark:border-[#2A2A27]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-1">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      item.action();
                    }}
                    className={`flex h-12 w-full items-center justify-between px-3 text-sm font-bold ${
                      currentRoute === item.id
                        ? 'bg-[#111111] text-white dark:bg-[#F5F5F2] dark:text-[#111111]'
                        : 'text-[#111111] hover:bg-[#F7F7F7] dark:text-[#F5F5F2] dark:hover:bg-[#1E1E1B]'
                    }`}
                  >
                    <span>{lang === 'ar' ? item.ar : item.en}</span>
                  </button>
                ))}
              </div>

              <div className="mt-6 border-t border-[#E5E5E3] pt-4 dark:border-[#2A2A27]">
                <p className="px-3 text-[11px] font-bold tracking-wider text-[#5C5C58] uppercase dark:text-[#A8A8A0]">
                  {lang === 'ar' ? 'الأقسام' : 'Collections'}
                </p>
                <div className="mt-2 space-y-1">
                  {SHOP_CATEGORIES.map((cat) => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        onNavigateShop(cat.key);
                      }}
                      className="flex h-11 w-full items-center px-3 text-xs font-semibold text-[#5C5C58] hover:text-[#111111] dark:text-[#A8A8A0] dark:hover:text-white"
                    >
                      {lang === 'ar' ? cat.ar : cat.en}
                    </button>
                  ))}
                </div>
              </div>

              {footerCampaigns.length > 0 && (
                <div className="mt-6 border-t border-[#E5E5E3] pt-4 dark:border-[#2A2A27]">
                  <p className="px-3 text-[11px] font-bold tracking-wider text-[#5C5C58] uppercase dark:text-[#A8A8A0]">
                    {lang === 'ar' ? 'الحملات' : 'Campaigns'}
                  </p>
                  <div className="mt-2 space-y-1">
                    {footerCampaigns.map((lp) => (
                      <button
                        key={lp.id}
                        type="button"
                        onClick={() => {
                          setMobileMenuOpen(false);
                          onNavigateLandingPage(lp.slug);
                        }}
                        className="flex h-11 w-full items-center px-3 text-xs font-semibold text-[#5C5C58] hover:text-[#111111] dark:text-[#A8A8A0] dark:hover:text-white"
                      >
                        {lang === 'ar' ? lp.title_ar : lp.title_en}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-[#E5E5E3] pt-4 dark:border-[#2A2A27]">
              <button
                type="button"
                onClick={onToggleLang}
                className="flex h-11 items-center justify-center gap-1.5 border border-[#E5E5E3] text-xs font-semibold dark:border-[#2A2A27]"
              >
                <Globe className="h-3.5 w-3.5" />
                <span>{lang === 'ar' ? 'English' : 'عربي'}</span>
              </button>
              <button
                type="button"
                onClick={onToggleTheme}
                className="flex h-11 items-center justify-center gap-1.5 border border-[#E5E5E3] text-xs font-semibold dark:border-[#2A2A27]"
              >
                {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                <span>{theme === 'dark' ? (lang === 'ar' ? 'صباحي' : 'Light') : lang === 'ar' ? 'ليلي' : 'Dark'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* محتوى الصفحة الحالية */}
      <div className={`flex-1 ${hideMobileBottomNav ? 'pb-16 md:pb-0' : 'pb-16 md:pb-0'}`}>{children}</div>

      {/* تذييل المتجر الكامل مع أيقونات السوشيال ميديا وأيقونة الترس المخفية */}
      <footer className="border-t border-[#E5E5E3] bg-[#FFFFFF] dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
        <div className="mx-auto max-w-[1440px] px-4 py-12 sm:px-8 lg:py-16">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
            <div className="md:col-span-4">
              <div className="font-display text-2xl font-bold tracking-[0.2em] text-[#111111] uppercase dark:text-[#F5F5F2]">
                {settings.store_name}
              </div>
              <p className="mt-3 max-w-sm text-xs leading-relaxed text-[#5C5C58] dark:text-[#A8A8A0]">
                {lang === 'ar' ? settings.footer_about_ar : settings.footer_about_en}
              </p>
              <p className="mt-4 font-mono-tabular text-xs text-[#111111] dark:text-[#F5F5F2]">
                {settings.support_email}
              </p>

              {socialLinks.length > 0 && (
                <div className="mt-5 flex flex-wrap items-center gap-2.5" aria-label={lang === 'ar' ? 'حسابات التواصل الاجتماعي' : 'Social Media Links'}>
                  {socialLinks.map((social) => (
                    <a
                      key={social.id}
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={social.label}
                      title={social.handle ? `${social.label} (${social.handle})` : social.label}
                      className="flex h-10 w-10 items-center justify-center border border-[#E5E5E3] bg-[#F7F7F7] text-[#111111] transition-colors hover:border-[#111111] hover:bg-[#111111] hover:text-white dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#F5F5F2] dark:hover:border-[#F5F5F2] dark:hover:bg-[#F5F5F2] dark:hover:text-[#111111]"
                    >
                      <SocialPlatformIcon platform={social.platform} className="h-4 w-4" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <h3 className="text-[11px] font-bold tracking-[0.15em] text-[#5C5C58] uppercase dark:text-[#A8A8A0]">
                {lang === 'ar' ? 'الأقسام' : 'COLLECTIONS'}
              </h3>
              <ul className="mt-4 space-y-2.5 text-xs font-medium text-[#111111] dark:text-[#F5F5F2]">
                {SHOP_CATEGORIES.map((cat) => (
                  <li key={cat.key}>
                    <button
                      type="button"
                      onClick={() => onNavigateShop(cat.key)}
                      className="hover:underline"
                    >
                      {lang === 'ar' ? cat.ar : cat.en}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-2">
              <h3 className="text-[11px] font-bold tracking-[0.15em] text-[#5C5C58] uppercase dark:text-[#A8A8A0]">
                {lang === 'ar' ? 'المتجر والحملات' : 'PAGES & CARE'}
              </h3>
              <ul className="mt-4 space-y-2.5 text-xs font-medium text-[#111111] dark:text-[#F5F5F2]">
                <li>
                  <button type="button" onClick={onNavigateFitGuide} className="hover:underline">
                    {lang === 'ar' ? 'دليل القصّات وحاسبة المقاس' : 'Fit Studio & Size Calc'}
                  </button>
                </li>
                <li>
                  <button type="button" onClick={onNavigateTrack} className="hover:underline">
                    {lang === 'ar' ? 'تتبع الطلب ورفع الإيصال' : 'Track Order & Receipt'}
                  </button>
                </li>
                <li>
                  <button type="button" onClick={onOpenCart} className="hover:underline">
                    {lang === 'ar' ? 'حقيبة التسوق' : 'Shopping Bag'}
                  </button>
                </li>
                <li>
                  <button type="button" onClick={onToggleLang} className="hover:underline">
                    {lang === 'ar' ? 'Switch to English' : 'التبديل للعربية'}
                  </button>
                </li>
                {footerCampaigns.map((lp) => (
                  <li key={lp.id}>
                    <button
                      type="button"
                      data-testid={`footer-lp-${lp.slug}`}
                      onClick={() => onNavigateLandingPage(lp.slug)}
                      className="text-[#5C5C58] hover:text-[#111111] hover:underline dark:text-[#A8A8A0] dark:hover:text-white"
                    >
                      {lang === 'ar' ? lp.title_ar : lp.title_en}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-4">
              <h3 className="text-[11px] font-bold tracking-[0.15em] text-[#5C5C58] uppercase dark:text-[#A8A8A0]">
                {lang === 'ar' ? 'تنبيهات الإصدارات الجديدة' : 'EXCLUSIVE DROPS'}
              </h3>
              <p className="mt-3 text-xs leading-relaxed text-[#5C5C58] dark:text-[#A8A8A0]">
                {lang === 'ar'
                  ? 'اشترك للحصول على إشعار فوري عند طرح الإصدارات المحدودة والخصومات الحصرية.'
                  : 'Subscribe for early access to limited drops and restocks.'}
              </p>

              {newsletterSubscribed ? (
                <div className="mt-4 flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <Check className="h-4 w-4 shrink-0" />
                  <span>
                    {lang === 'ar'
                      ? 'تم تسجيل بريدك بنجاح في قائمة إصدارات YUOP.'
                      : 'Subscribed to YUOP drop alerts.'}
                  </span>
                </div>
              ) : (
                <form onSubmit={handleNewsletterSubmit} className="mt-4 flex">
                  <input
                    type="email"
                    required
                    value={newsletterEmail}
                    onChange={(e) => setNewsletterEmail(e.target.value)}
                    aria-label={lang === 'ar' ? 'البريد الإلكتروني للاشتراك' : 'Newsletter email'}
                    placeholder={lang === 'ar' ? 'أدخل بريدك الإلكتروني...' : 'Enter email here...'}
                    className="h-11 flex-1 border border-[#E5E5E3] bg-[#F7F7F7] px-3 text-xs focus:border-[#111111] focus:bg-white focus:outline-none dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#F5F5F2] dark:focus:border-[#F5F5F2]"
                  />
                  <button
                    type="submit"
                    className="h-11 bg-[#111111] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111] dark:hover:bg-[#E0E0DA]"
                  >
                    {lang === 'ar' ? 'اشتراك' : 'Subscribe'}
                  </button>
                </form>
              )}
            </div>
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[#E5E5E3] pt-6 text-[11px] text-[#5C5C58] dark:border-[#2A2A27] dark:text-[#A8A8A0]">
            <span>
              © {new Date().getFullYear()} {settings.store_name}.{' '}
              {lang === 'ar' ? 'جميع الحقوق محفوظة.' : 'All rights reserved.'}
            </span>
            <div className="flex items-center gap-3">
              <span className="font-mono-tabular">
                Vodafone Cash · InstaPay · Cash on Delivery · WhatsApp Verified
              </span>
              <button
                type="button"
                onClick={onNavigateAdmin}
                aria-label="إدارة المتجر"
                title="إدارة المتجر"
                data-testid="footer-admin-gear"
                className="flex h-8 w-8 items-center justify-center text-[#8A8A84] opacity-40 transition-opacity hover:opacity-100 dark:text-[#A8A8A0]"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </footer>

      {/* شريط التنقل السفلي للهواتف (Mobile Thumb-Zone Bottom Bar - 56px) */}
      {!hideMobileBottomNav && (
        <nav
          aria-label={lang === 'ar' ? 'التنقل السريع للهاتف' : 'Mobile Bottom Navigation'}
          className="fixed inset-x-0 bottom-0 z-40 grid h-14 grid-cols-4 border-t border-[#E5E5E3] bg-white/95 backdrop-blur-md md:hidden dark:border-[#2A2A27] dark:bg-[#0D0D0C]/95"
        >
          {[
            { id: 'home' as CustomerRoute, icon: Home, ar: 'الرئيسية', en: 'Home', action: onNavigateHome },
            { id: 'shop' as CustomerRoute, icon: LayoutGrid, ar: 'التشكيلة', en: 'Shop', action: () => onNavigateShop('ALL') },
            { id: 'fit' as CustomerRoute, icon: Compass, ar: 'القصّات', en: 'Fit', action: onNavigateFitGuide },
            { id: 'track' as CustomerRoute, icon: PackageSearch, ar: 'تتبع', en: 'Track', action: onNavigateTrack },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = currentRoute === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={tab.action}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
                  active
                    ? 'text-[#111111] dark:text-[#F5F5F2]'
                    : 'text-[#7A7A74] hover:text-[#111111] dark:text-[#8A8A84] dark:hover:text-[#F5F5F2]'
                }`}
              >
                <Icon className={`h-4 w-4 ${active ? 'stroke-[2.4]' : 'stroke-[1.75]'}`} />
                <span className="whitespace-nowrap">{lang === 'ar' ? tab.ar : tab.en}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

/**
 * ============================================================================
 * المكون الجذري لتطبيق YUOP Streetwear (App.tsx)
 * يدير التنقل بين الصفحات المستقلة للمتجر:
 *   /                -> الصفحة الرئيسية (Home)
 *   /shop            -> التشكيلة الكاملة والتصفية التفاعلية
 *   /product/:id     -> صفحة تفاصيل المنتج المستقلة
 *   /fit-guide       -> استوديو القصّات وحاسبة المقاس
 *   /track           -> تتبع الطلب ورفع الإيصال
 *   /lp/:slug        -> صفحات الهبوط التسويقية
 *   /admin           -> لوحة التحكم الكاملة (من أيقونة الترس في التذييل)
 * ============================================================================
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  LandingPage,
  OrderDetail,
  Product,
  SocialLink,
  StoreSettings,
  ThemeMode,
} from './shared/types.ts';
import type { Lang } from './lib/i18n.ts';
import { fetchStoreConfig } from './lib/api.ts';
import { StoreLayout, type CustomerRoute } from './components/StoreLayout.tsx';
import { Storefront } from './components/Storefront.tsx';
import { ShopPage } from './components/ShopPage.tsx';
import { ProductDetailPage } from './components/ProductDetailPage.tsx';
import { FitGuidePage } from './components/FitGuidePage.tsx';
import { LandingPageView } from './components/LandingPageView.tsx';
import { CartDrawer, type CartItem } from './components/CartDrawer.tsx';
import { CheckoutModal } from './components/CheckoutModal.tsx';
import { OrderTrackingView } from './components/OrderTrackingView.tsx';
import { AdminDashboard } from './components/admin/AdminDashboard.tsx';

type AppView = 'home' | 'shop' | 'product' | 'fit' | 'track' | 'admin' | 'landing';

interface ParsedRoute {
  view: AppView;
  slug: string;
  productId: number | null;
  category: string;
}

function parseLocation(): ParsedRoute {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  if (path.startsWith('/admin')) {
    return { view: 'admin', slug: '', productId: null, category: 'ALL' };
  }
  if (path.startsWith('/track')) {
    return { view: 'track', slug: '', productId: null, category: 'ALL' };
  }
  if (path.startsWith('/fit-guide')) {
    return { view: 'fit', slug: '', productId: null, category: 'ALL' };
  }
  if (path.startsWith('/shop')) {
    return { view: 'shop', slug: '', productId: null, category: params.get('cat') || 'ALL' };
  }
  if (path.startsWith('/product/')) {
    const id = Number(path.slice('/product/'.length).split('/')[0]);
    if (Number.isInteger(id) && id > 0) {
      return { view: 'product', slug: '', productId: id, category: 'ALL' };
    }
  }
  if (path.startsWith('/lp/')) {
    const slug = decodeURIComponent(path.slice(4).split('/')[0] || '').trim();
    if (slug) return { view: 'landing', slug, productId: null, category: 'ALL' };
  }
  return { view: 'home', slug: '', productId: null, category: 'ALL' };
}

export default function App() {
  const initialRoute = parseLocation();
  const [view, setView] = useState<AppView>(initialRoute.view);
  const [landingSlug, setLandingSlug] = useState<string>(initialRoute.slug);
  const [activeProductId, setActiveProductId] = useState<number | null>(initialRoute.productId);
  const [shopCategory, setShopCategory] = useState<string>(initialRoute.category);
  const [searchQuery, setSearchQuery] = useState('');

  const [lang, setLang] = useState<Lang>('ar');
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = window.localStorage.getItem('yuop_theme');
    return saved === 'dark' || saved === 'light' ? saved : 'light';
  });

  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [landingPages, setLandingPages] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [trackedOrder, setTrackedOrder] = useState<OrderDetail | null>(null);

  const loadStore = useCallback(async () => {
    try {
      const data = await fetchStoreConfig();
      setSettings(data.settings);
      setProducts(data.products);
      setSocialLinks(data.social_links || []);
      setLandingPages(data.landing_pages || []);
      const saved = window.localStorage.getItem('yuop_theme');
      if (!saved && (data.settings.default_theme === 'dark' || data.settings.default_theme === 'light')) {
        setTheme(data.settings.default_theme);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStore();
  }, [loadStore]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem('yuop_theme', next);
      return next;
    });
  };

  const navigate = (
    next: AppView,
    opts?: { slug?: string; productId?: number; category?: string }
  ) => {
    setView(next);
    let targetPath = '/';

    if (next === 'admin') {
      targetPath = '/admin';
    } else if (next === 'track') {
      targetPath = '/track';
    } else if (next === 'fit') {
      targetPath = '/fit-guide';
    } else if (next === 'shop') {
      const cat = opts?.category || 'ALL';
      setShopCategory(cat);
      targetPath = cat !== 'ALL' ? `/shop?cat=${encodeURIComponent(cat)}` : '/shop';
    } else if (next === 'product' && opts?.productId) {
      setActiveProductId(opts.productId);
      targetPath = `/product/${opts.productId}`;
    } else if (next === 'landing' && opts?.slug) {
      setLandingSlug(opts.slug);
      targetPath = `/lp/${encodeURIComponent(opts.slug)}`;
    }

    if (window.location.pathname + window.location.search !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    const onPop = () => {
      const parsed = parseLocation();
      setView(parsed.view);
      setLandingSlug(parsed.slug);
      setActiveProductId(parsed.productId);
      setShopCategory(parsed.category);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handleAddToCart = (product: Product, size: string, quantity: number) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product.id === product.id && i.size === size);
      if (idx > -1) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
        return next;
      }
      return [...prev, { product, size, quantity }];
    });
    setCartOpen(true);
  };

  const handleUpdateQty = (productId: number, size: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.product.id === productId && i.size === size ? { ...i, quantity: i.quantity + delta } : i
        )
        .filter((i) => i.quantity > 0)
    );
  };

  const handleRemoveCartItem = (productId: number, size: string) => {
    setCart((prev) => prev.filter((i) => !(i.product.id === productId && i.size === size)));
  };

  if (loading || !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F6F4] text-sm font-semibold text-[#5C5C58] dark:bg-[#0D0D0C] dark:text-[#A8A8A0]">
        جاري تحميل متجر YUOP...
      </div>
    );
  }

  if (view === 'admin') {
    return (
      <AdminDashboard
        settings={settings}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSettingsUpdated={(s) => setSettings(s)}
        onProductsChanged={loadStore}
        onStoreConfigChanged={loadStore}
        onPreviewLandingPage={(slug) => navigate('landing', { slug })}
        onBackToStore={() => navigate('home')}
      />
    );
  }

  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  const currentProduct = activeProductId ? products.find((p) => p.id === activeProductId) : undefined;
  const customerRoute: CustomerRoute =
    view === 'shop' || view === 'product' || view === 'fit' || view === 'track' || view === 'landing'
      ? view
      : 'home';

  return (
    <>
      <StoreLayout
        currentRoute={customerRoute}
        settings={settings}
        products={products}
        socialLinks={socialLinks}
        landingPages={landingPages}
        cartCount={cartCount}
        lang={lang}
        theme={theme}
        searchQuery={searchQuery}
        hideMobileBottomNav={view === 'product'}
        onSearchChange={(q) => setSearchQuery(q)}
        onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
        onToggleTheme={toggleTheme}
        onOpenCart={() => setCartOpen(true)}
        onNavigateHome={() => navigate('home')}
        onNavigateShop={(category) => navigate('shop', { category: category || 'ALL' })}
        onNavigateProduct={(productId) => navigate('product', { productId })}
        onNavigateFitGuide={() => navigate('fit')}
        onNavigateTrack={() => navigate('track')}
        onNavigateLandingPage={(slug) => navigate('landing', { slug })}
        onNavigateAdmin={() => navigate('admin')}
      >
        {view === 'landing' && landingSlug ? (
          <LandingPageView
            slug={landingSlug}
            settings={settings}
            products={products}
            lang={lang}
            onSelectProduct={(p) => navigate('product', { productId: p.id })}
            onQuickAdd={(p, size) => handleAddToCart(p, size, 1)}
            onBackToStore={() => navigate('home')}
            onGoShop={() => navigate('shop', { category: 'ALL' })}
          />
        ) : view === 'shop' ? (
          <ShopPage
            products={products}
            settings={settings}
            lang={lang}
            initialCategory={shopCategory}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelectCategory={(cat) => navigate('shop', { category: cat })}
            onOpenProduct={(productId) => navigate('product', { productId })}
            onQuickAdd={(p, size) => handleAddToCart(p, size, 1)}
          />
        ) : view === 'product' ? (
          <ProductDetailPage
            product={currentProduct}
            allProducts={products}
            settings={settings}
            lang={lang}
            onAddToCart={handleAddToCart}
            onOpenProduct={(productId) => navigate('product', { productId })}
            onBackToShop={(cat) => navigate('shop', { category: cat || 'ALL' })}
            onGoFitGuide={() => navigate('fit')}
          />
        ) : view === 'fit' ? (
          <FitGuidePage
            products={products}
            landingPages={landingPages}
            lang={lang}
            onOpenProduct={(productId) => navigate('product', { productId })}
            onOpenShop={(cat) => navigate('shop', { category: cat || 'ALL' })}
            onOpenLandingPage={(slug) => navigate('landing', { slug })}
          />
        ) : view === 'track' ? (
          <OrderTrackingView
            initialOrder={trackedOrder}
            settings={settings}
            lang={lang}
            onOrderUpdated={(o) => setTrackedOrder(o)}
            onBackToShop={() => navigate('shop', { category: 'ALL' })}
          />
        ) : (
          <Storefront
            settings={settings}
            products={products}
            landingPages={landingPages}
            lang={lang}
            onToggleLang={() => setLang((l) => (l === 'ar' ? 'en' : 'ar'))}
            onOpenProduct={(productId) => navigate('product', { productId })}
            onQuickAdd={(p, size) => handleAddToCart(p, size, 1)}
            onNavigateShop={(cat) => navigate('shop', { category: cat || 'ALL' })}
            onNavigateFitGuide={() => navigate('fit')}
            onNavigateTrack={() => navigate('track')}
            onNavigateLandingPage={(slug) => navigate('landing', { slug })}
          />
        )}
      </StoreLayout>

      <CartDrawer
        open={cartOpen}
        items={cart}
        settings={settings}
        lang={lang}
        onClose={() => setCartOpen(false)}
        onUpdateQty={handleUpdateQty}
        onRemove={handleRemoveCartItem}
        onCheckout={() => {
          setCartOpen(false);
          setCheckoutOpen(true);
        }}
      />

      {checkoutOpen && (
        <CheckoutModal
          items={cart}
          settings={settings}
          lang={lang}
          onClose={() => setCheckoutOpen(false)}
          onOrderCreated={(newOrder) => {
            setCheckoutOpen(false);
            setCart([]);
            setTrackedOrder(newOrder);
            loadStore();
            navigate('track');
          }}
        />
      )}
    </>
  );
}



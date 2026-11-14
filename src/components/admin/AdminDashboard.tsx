/**
 * ============================================================================
 * لوحة التحكم المتكاملة لمتجر YUOP (Admin Operations Dashboard)
 * تضم تسجيل دخول الموظفين، الصلاحيات (RBAC)، الإحصائيات الـ 12،
 * إدارة الطلبات، مراجعة المدفوعات، الدفع عند الاستلام، التخصيص الكامل للمتجر،
 * قوالب وإعدادات WhatsApp Cloud API، وسجل العمليات Audit Log.
 * ============================================================================
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  LayoutDashboard,
  ShoppingBag,
  CreditCard,
  Banknote,
  Store,
  MessageSquareText,
  Webhook,
  ScrollText,
  Users,
  BookOpen,
  LogOut,
  ArrowRight,
  Search,
  Eye,
  Lock,
  Menu,
  X,
  LayoutTemplate,
  Share2,
  Tag,
  UserCheck,
  Sun,
  Moon,
  AlertTriangle,
  Download,
} from 'lucide-react';
import {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type AuditLogEntry,
  type CustomerSummary,
  type DashboardStats,
  type LandingPage,
  type LowStockAlert,
  type NotificationTemplate,
  type OrderDetail,
  type OrderSummary,
  type Permission,
  type Product,
  type PromoCode,
  type SocialLink,
  type StaffRole,
  type StaffUser,
  type StoreSettings,
  type ThemeMode,
  type WhatsAppMessageRecord,
} from '../../shared/types.ts';
import {
  createStaffApi,
  fetchAdminOrderDetail,
  fetchAdminOrders,
  fetchAdminProducts,
  fetchAuditLogsApi,
  fetchCurrentStaff,
  fetchCustomersApi,
  fetchDashboardOverview,
  fetchLandingPagesApi,
  fetchPromoCodesApi,
  fetchSocialLinksApi,
  fetchStaffApi,
  fetchTemplatesApi,
  fetchWhatsAppConfigApi,
  fetchWhatsAppMessagesApi,
  loginAdmin,
  logoutAdmin,
  updateStaffApi,
  type AuthedStaffUser,
  type WhatsAppConfigResponse,
} from '../../lib/api.ts';
import {
  formatDateTime,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PERMISSION_LABELS,
  ROLE_LABELS,
} from '../../lib/i18n.ts';
import { OrderDetailModal } from './OrderDetailModal.tsx';
import { StoreAndProductsPanel } from './StoreAndProductsPanel.tsx';
import {
  SetupDocsAndCostPanel,
  WhatsAppApiPanel,
  WhatsAppTemplatesPanel,
} from './WhatsAppAndDocsPanel.tsx';
import { LandingPagesPanel, SocialLinksPanel } from './LandingAndSocialPanel.tsx';
import { CustomersCrmPanel, PromoCodesPanel } from './PromosAndCustomersPanel.tsx';
import { ImageWithFallback } from '../ImageWithFallback.tsx';

type AdminTab =
  | 'overview'
  | 'orders'
  | 'payments'
  | 'cod'
  | 'store'
  | 'landing_pages'
  | 'social_links'
  | 'promos'
  | 'customers'
  | 'templates'
  | 'whatsapp_api'
  | 'audit'
  | 'staff'
  | 'docs';

interface AdminDashboardProps {
  settings: StoreSettings;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onSettingsUpdated: (s: StoreSettings) => void;
  onProductsChanged: () => Promise<void>;
  onStoreConfigChanged: () => Promise<void>;
  onPreviewLandingPage: (slug: string) => void;
  onBackToStore: () => void;
}

export function AdminDashboard({
  settings,
  theme,
  onToggleTheme,
  onSettingsUpdated,
  onProductsChanged,
  onStoreConfigChanged,
  onPreviewLandingPage,
  onBackToStore,
}: AdminDashboardProps) {
  const [staff, setStaff] = useState<AuthedStaffUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState('admin@yuop.store');
  const [loginPassword, setLoginPassword] = useState('yuop2026');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentLogs, setRecentLogs] = useState<AuditLogEntry[]>([]);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [landingPages, setLandingPages] = useState<LandingPage[]>([]);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [waConfig, setWaConfig] = useState<WhatsAppConfigResponse | null>(null);
  const [waMessages, setWaMessages] = useState<Array<WhatsAppMessageRecord & { order_number?: string }>>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState('');

  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [rolesList, setRolesList] = useState<StaffRole[]>([]);
  const [newStaff, setNewStaff] = useState({ name: '', email: '', password: '', role: 'Payment Reviewer' as StaffRole });

  // فلاتر البحث المتقدم في الطلبات
  const [filters, setFilters] = useState({
    search: '',
    status: 'ALL',
    payment_method: 'ALL',
    payment_status: 'ALL',
    shipping_company: '',
    date_from: '',
    date_to: '',
  });

  useEffect(() => {
    fetchCurrentStaff()
      .then((res) => setStaff(res.user))
      .catch(() => setStaff(null))
      .finally(() => setAuthLoading(false));
  }, []);

  const hasPerm = useCallback(
    (p: Permission) => Boolean(staff?.effective_permissions?.includes(p)),
    [staff]
  );

  const loadTabData = useCallback(async () => {
    if (!staff) return;
    try {
      if (activeTab === 'overview' && hasPerm('view_dashboard')) {
        const res = await fetchDashboardOverview();
        setStats(res.stats);
        setRecentLogs(res.recent_logs);
        setLowStockAlerts(res.low_stock_alerts || []);
      } else if (activeTab === 'orders' && hasPerm('view_orders')) {
        const res = await fetchAdminOrders(filters);
        setOrders(res.orders);
      } else if (activeTab === 'payments' && hasPerm('view_orders')) {
        const res = await fetchAdminOrders({});
        setOrders(
          res.orders.filter(
            (o) =>
              o.payment_method === 'Vodafone Cash' ||
              o.payment_method === 'InstaPay'
          )
        );
      } else if (activeTab === 'cod' && hasPerm('view_orders')) {
        const res = await fetchAdminOrders({ payment_method: 'Cash on Delivery' });
        setOrders(res.orders);
      } else if (activeTab === 'store' && hasPerm('view_dashboard')) {
        const res = await fetchAdminProducts();
        setProducts(res.products);
      } else if (activeTab === 'landing_pages' && hasPerm('manage_landing_pages')) {
        const [lps, prods] = await Promise.all([fetchLandingPagesApi(), fetchAdminProducts()]);
        setLandingPages(lps.landing_pages);
        setProducts(prods.products);
      } else if (activeTab === 'social_links' && hasPerm('manage_social_links')) {
        const res = await fetchSocialLinksApi();
        setSocialLinks(res.social_links);
      } else if (activeTab === 'promos' && hasPerm('manage_promos')) {
        const res = await fetchPromoCodesApi();
        setPromoCodes(res.promo_codes);
      } else if (activeTab === 'customers' && hasPerm('view_orders')) {
        const res = await fetchCustomersApi();
        setCustomers(res.customers);
      } else if (activeTab === 'templates' && hasPerm('manage_whatsapp_templates')) {
        const res = await fetchTemplatesApi();
        setTemplates(res.templates);
      } else if (activeTab === 'whatsapp_api' && hasPerm('manage_whatsapp_api')) {
        const [cfg, msgs] = await Promise.all([fetchWhatsAppConfigApi(), fetchWhatsAppMessagesApi()]);
        setWaConfig(cfg.config);
        setWaMessages(msgs.messages);
      } else if (activeTab === 'audit' && hasPerm('view_audit_logs')) {
        const res = await fetchAuditLogsApi(auditFilter || undefined);
        setAuditLogs(res.logs);
      } else if (activeTab === 'staff' && hasPerm('manage_staff')) {
        const res = await fetchStaffApi();
        setStaffList(res.staff);
        setRolesList(res.roles);
      }
    } catch {
      // ignore unauthorized tab prefetch
    }
  }, [staff, activeTab, filters, auditFilter, hasPerm]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const res = await loginAdmin(loginEmail, loginPassword);
      setStaff(res.user);
      setActiveTab('overview');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'فشل تسجيل الدخول');
    }
  };

  const handleLogout = async () => {
    await logoutAdmin();
    setStaff(null);
  };

  const openOrder = async (orderId: number) => {
    const res = await fetchAdminOrderDetail(orderId);
    setSelectedOrder(res.order);
  };

  const handleCreateStaff = async (e: FormEvent) => {
    e.preventDefault();
    await createStaffApi(newStaff);
    setNewStaff({ name: '', email: '', password: '', role: 'Payment Reviewer' });
    await loadTabData();
  };

  const handleExportOrdersCsv = () => {
    const headers = [
      'رقم الطلب',
      'العميل',
      'الهاتف',
      'المحافظة',
      'طريقة الدفع',
      'حالة الدفع',
      'حالة الطلب',
      'الإجمالي',
      'كود الخصم',
      'تاريخ الإنشاء',
    ];
    const escapeCsv = (val: unknown) => {
      const s = String(val ?? '');
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = orders.map((o) => [
      `#${o.order_number}`,
      o.customer_name,
      o.customer_phone,
      o.governorate,
      PAYMENT_METHOD_LABELS[o.payment_method]?.ar || o.payment_method,
      PAYMENT_STATUS_LABELS[o.payment_status]?.ar || o.payment_status,
      ORDER_STATUS_LABELS[o.status]?.ar || o.status,
      o.total_amount,
      o.promo_code || '',
      formatDateTime(o.created_at),
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yuop-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F6F4] text-sm font-semibold text-[#5C5C58] dark:bg-[#0D0D0C] dark:text-[#A8A8A0]">
        جاري التحقق من جلسة الإدارة...
      </div>
    );
  }

  // شاشة تسجيل الدخول المحمية للموظفين والمدير
  if (!staff) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F6F4] p-4 dark:bg-[#0D0D0C]">
        <div className="w-full max-w-md border border-[#E2E2DD] bg-white p-8 dark:border-[#2A2A27] dark:bg-[#161614]">
          <div className="flex items-center justify-between border-b border-[#E2E2DD] pb-4 dark:border-[#2A2A27]">
            <div>
              <span className="font-display text-2xl font-bold tracking-widest text-[#111111] dark:text-[#F5F5F2]">
                {settings.store_name}
              </span>
              <p className="mt-1 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">بوابة الإدارة والعمليات المحمية (RBAC)</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label={theme === 'dark' ? 'التبديل للوضع الصباحي' : 'التبديل للوضع الليلي'}
                className="flex h-8 w-8 items-center justify-center border border-[#E2E2DD] text-[#111111] hover:border-[#111111] dark:border-[#2A2A27] dark:text-[#F5F5F2] dark:hover:border-[#F5F5F2]"
              >
                {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </button>
              <Lock className="h-5 w-5 text-[#111111] dark:text-[#F5F5F2]" />
            </div>
          </div>

          {loginError && (
            <div className="mt-4 border border-red-300 bg-red-50 p-3 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-5 space-y-4">
            <div>
              <label htmlFor="adm-email" className="block text-xs font-semibold text-[#111111] dark:text-[#F5F5F2]">
                البريد الإلكتروني الوظيفي
              </label>
              <input
                id="adm-email"
                type="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="mt-1 h-11 w-full border border-[#E2E2DD] bg-white px-3 text-sm text-[#111111] focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#F5F5F2] dark:focus:border-[#F5F5F2]"
              />
            </div>
            <div>
              <label htmlFor="adm-pass" className="block text-xs font-semibold text-[#111111] dark:text-[#F5F5F2]">
                كلمة المرور
              </label>
              <input
                id="adm-pass"
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="mt-1 h-11 w-full border border-[#E2E2DD] bg-white px-3 text-sm text-[#111111] focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C] dark:text-[#F5F5F2] dark:focus:border-[#F5F5F2]"
              />
            </div>
            <button
              type="submit"
              className="h-11 w-full bg-[#111111] text-sm font-bold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111] dark:hover:bg-[#E2E2DD]"
            >
              تسجيل الدخول للوحة التحكم
            </button>
          </form>

          {/* حسابات تجريبية لاختبار الصلاحيات المختلفة */}
          <div className="mt-6 border-t border-[#E2E2DD] pt-4 dark:border-[#2A2A27]">
            <p className="text-[11px] font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">
              حسابات تجريبية لاختبار الأدوار (كلمة المرور: yuop2026):
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              {[
                { label: 'Super Admin', email: 'admin@yuop.store' },
                { label: 'Payment Reviewer', email: 'payments@yuop.store' },
                { label: 'Shipping Manager', email: 'shipping@yuop.store' },
                { label: 'Customer Support', email: 'support@yuop.store' },
              ].map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setLoginEmail(acc.email);
                    setLoginPassword('yuop2026');
                  }}
                  className="border border-[#E2E2DD] bg-[#F6F6F4] px-2.5 py-1.5 font-medium text-[#111111] hover:border-[#111111] dark:border-[#2A2A27] dark:bg-[#1E1E1B] dark:text-[#F5F5F2] dark:hover:border-[#F5F5F2]"
                >
                  {acc.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={onBackToStore}
            className="mt-5 flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-[#5C5C58] hover:text-[#111111] dark:text-[#A8A8A0] dark:hover:text-[#F5F5F2]"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            <span>العودة لواجهة المتجر</span>
          </button>
        </div>
      </div>
    );
  }

  const allNavItems: Array<{ id: AdminTab; label: string; icon: typeof LayoutDashboard; perm?: Permission }> = [
    { id: 'overview', label: 'لوحة الإحصائيات', icon: LayoutDashboard, perm: 'view_dashboard' },
    { id: 'orders', label: 'إدارة الطلبات والفلاتر', icon: ShoppingBag, perm: 'view_orders' },
    { id: 'payments', label: 'مراجعة المدفوعات', icon: CreditCard, perm: 'view_orders' },
    { id: 'cod', label: 'الدفع عند الاستلام (COD)', icon: Banknote, perm: 'view_orders' },
    { id: 'store', label: 'تخصيص المتجر والمنتجات', icon: Store, perm: 'view_dashboard' },
    { id: 'landing_pages', label: 'صفحات الهبوط التسويقية', icon: LayoutTemplate, perm: 'manage_landing_pages' },
    { id: 'social_links', label: 'السوشيال ميديا والتواصل', icon: Share2, perm: 'manage_social_links' },
    { id: 'promos', label: 'أكواد الخصم والعروض', icon: Tag, perm: 'manage_promos' },
    { id: 'customers', label: 'دليل العملاء والمبيعات', icon: UserCheck, perm: 'view_orders' },
    { id: 'templates', label: 'قوالب رسائل WhatsApp', icon: MessageSquareText, perm: 'manage_whatsapp_templates' },
    { id: 'whatsapp_api', label: 'WhatsApp API والـ Webhook', icon: Webhook, perm: 'manage_whatsapp_api' },
    { id: 'audit', label: 'سجل العمليات (Audit Log)', icon: ScrollText, perm: 'view_audit_logs' },
    { id: 'staff', label: 'الموظفون والصلاحيات', icon: Users, perm: 'manage_staff' },
    { id: 'docs', label: 'دليل الإعداد والتكاليف', icon: BookOpen },
  ];
  const navItems = allNavItems.filter((item) => !item.perm || hasPerm(item.perm));

  const activeTitle = navItems.find((n) => n.id === activeTab)?.label || 'لوحة التحكم';

  return (
    <div className="flex min-h-screen bg-[#F6F6F4] text-[#111111] dark:bg-[#0D0D0C] dark:text-[#F5F5F2]">
      {/* الشريط الجانبي الثابت لسطح المكتب */}
      <aside className="hidden w-[260px] shrink-0 flex-col justify-between border-e border-[#E2E2DD] bg-white lg:flex dark:border-[#2A2A27] dark:bg-[#161614]">
        <div>
          <div className="border-b border-[#E2E2DD] px-6 py-5 dark:border-[#2A2A27]">
            <div className="font-display text-2xl font-bold tracking-widest text-[#111111] dark:text-[#F5F5F2]">
              {settings.store_name}
            </div>
            <div className="mt-1 text-xs font-medium text-[#5C5C58] dark:text-[#A8A8A0]">{staff.name}</div>
            <div className="mt-0.5 text-[11px] text-[#8A8A84]">{ROLE_LABELS[staff.role]}</div>
          </div>

          <nav className="space-y-1 p-3" aria-label="أقسام لوحة التحكم">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-xs font-semibold transition-colors ${
                    isActive
                      ? 'bg-[#111111] text-white dark:bg-[#F5F5F2] dark:text-[#111111]'
                      : 'text-[#5C5C58] hover:bg-[#F6F6F4] hover:text-[#111111] dark:text-[#A8A8A0] dark:hover:bg-[#1E1E1B] dark:hover:text-[#F5F5F2]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-2 border-t border-[#E2E2DD] p-4 dark:border-[#2A2A27]">
          <button
            type="button"
            onClick={onBackToStore}
            className="flex h-9 w-full items-center justify-center gap-2 border border-[#E2E2DD] text-xs font-semibold text-[#111111] hover:border-[#111111] dark:border-[#2A2A27] dark:text-[#F5F5F2] dark:hover:border-[#F5F5F2]"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            <span>معاينة المتجر</span>
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="flex h-9 w-full items-center justify-center gap-2 border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* منطقة العمل الرئيسية */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* الشريط العلوي Breadcrumb */}
        <header className="flex h-16 items-center justify-between gap-4 border-b border-[#E2E2DD] bg-white px-4 sm:px-6 dark:border-[#2A2A27] dark:bg-[#161614]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="قائمة لوحة التحكم"
              className="flex h-9 w-9 items-center justify-center border border-[#E2E2DD] lg:hidden dark:border-[#2A2A27]"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <div className="text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
              <span>{settings.store_name} Operations</span>
              <span className="mx-2">/</span>
              <strong className="text-sm text-[#111111] dark:text-[#F5F5F2]">{activeTitle}</strong>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'التبديل للوضع الصباحي' : 'التبديل للوضع الليلي'}
              className="flex h-9 items-center gap-1.5 border border-[#E2E2DD] px-3 text-xs font-semibold text-[#111111] hover:border-[#111111] dark:border-[#2A2A27] dark:text-[#F5F5F2] dark:hover:border-[#F5F5F2]"
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{theme === 'dark' ? 'وضع صباحي' : 'وضع ليلي'}</span>
            </button>
            <button
              type="button"
              onClick={onBackToStore}
              className="h-9 border border-[#E2E2DD] px-3 text-xs font-semibold hover:border-[#111111] dark:border-[#2A2A27] dark:hover:border-[#F5F5F2]"
            >
              فتح المتجر
            </button>
          </div>
        </header>

        {/* قائمة الموبايل */}
        {mobileMenuOpen && (
          <div className="border-b border-[#E2E2DD] bg-white p-3 lg:hidden dark:border-[#2A2A27] dark:bg-[#161614]">
            <div className="grid grid-cols-2 gap-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`px-3 py-2 text-start text-xs font-semibold ${
                    activeTab === item.id
                      ? 'bg-[#111111] text-white dark:bg-[#F5F5F2] dark:text-[#111111]'
                      : 'border border-[#E2E2DD] text-[#111111] dark:border-[#2A2A27] dark:text-[#F5F5F2]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6">
          {/* 1. لوحة الإحصائيات الـ 12 + تنبيهات المخزون + آخر العمليات */}
          {activeTab === 'overview' && stats && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {[
                  { label: 'إجمالي الطلبات', val: stats.total_orders },
                  { label: 'الطلبات الجديدة', val: stats.new_orders },
                  { label: 'بانتظار الدفع', val: stats.awaiting_payment },
                  { label: 'مدفوعات بانتظار المراجعة', val: stats.payment_review },
                  { label: 'المدفوعات المؤكدة', val: stats.confirmed_payments },
                  { label: 'المدفوعات المرفوضة', val: stats.rejected_payments },
                  { label: 'طلبات الدفع عند الاستلام', val: stats.cod_orders },
                  { label: 'الطلبات قيد التجهيز', val: stats.preparing_orders },
                  { label: 'الطلبات المشحونة', val: stats.shipped_orders },
                  { label: 'خرجت للتوصيل', val: stats.out_for_delivery_orders },
                  { label: 'الطلبات المسلمة', val: stats.delivered_orders },
                  { label: 'الطلبات الملغاة', val: stats.cancelled_orders },
                ].map((kpi) => (
                  <div key={kpi.label} className="border border-[#E2E2DD] bg-white p-4 dark:border-[#2A2A27] dark:bg-[#161614]">
                    <div className="text-xs text-[#5C5C58] dark:text-[#A8A8A0]">{kpi.label}</div>
                    <div className="mt-2 font-mono-tabular text-2xl font-bold text-[#111111] dark:text-[#F5F5F2]">{kpi.val}</div>
                  </div>
                ))}
              </div>

              {/* تنبيهات انخفاض المخزون (Low-Stock Inventory Alerts) */}
              {lowStockAlerts.length > 0 && (
                <div className="border border-amber-300 bg-amber-50/70 p-5 dark:border-amber-900 dark:bg-amber-950/30">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-amber-950 dark:text-amber-300">
                      <AlertTriangle className="h-4 w-4" />
                      <span>تنبيهات انخفاض المخزون ({lowStockAlerts.length})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('store')}
                      className="border border-amber-700 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-500 dark:text-amber-200 dark:hover:bg-amber-900/40"
                    >
                      تحديث الكميات في المنتجات
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {lowStockAlerts.map((alert) => (
                      <div
                        key={`${alert.product_id}-${alert.size}`}
                        className="flex items-center justify-between border border-amber-200 bg-white px-3 py-2 text-xs dark:border-amber-900/60 dark:bg-[#161614]"
                      >
                        <span className="font-semibold text-[#111111] dark:text-[#F5F5F2]">
                          {alert.product_name_ar} ({alert.size})
                        </span>
                        <span
                          className={`font-mono-tabular font-bold ${
                            alert.stock <= 0 ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {alert.stock <= 0 ? 'نفد (0)' : `متبقي ${alert.stock}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
                <div className="flex items-center justify-between border-b border-[#E2E2DD] pb-3 dark:border-[#2A2A27]">
                  <h2 className="text-sm font-bold text-[#111111] dark:text-[#F5F5F2]">إجمالي المبيعات المحصلة المؤكدة</h2>
                  <span className="font-mono-tabular text-xl font-bold text-emerald-700 dark:text-emerald-400">
                    {stats.total_revenue_paid.toLocaleString()} {settings.currency_symbol_ar}
                  </span>
                </div>

                <h3 className="mt-5 text-sm font-bold text-[#111111] dark:text-[#F5F5F2]">آخر العمليات والتحديثات على الطلبات</h3>
                <div className="mt-3 divide-y divide-[#E2E2DD] text-xs dark:divide-[#2A2A27]">
                  {recentLogs.map((log) => (
                    <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div>
                        <span className="font-bold text-[#111111] dark:text-[#F5F5F2]">{log.action_type}</span>
                        {log.order_number && (
                          <span className="mx-2 font-mono-tabular font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">#{log.order_number}</span>
                        )}
                        <span className="text-[#5C5C58] dark:text-[#A8A8A0]">— {log.details}</span>
                      </div>
                      <div className="font-mono-tabular text-[11px] text-[#8A8A84]">
                        {log.employee_name} · {formatDateTime(log.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 2. إدارة الطلبات والبحث المتقدم + تصدير CSV */}
          {activeTab === 'orders' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 border border-[#E2E2DD] bg-white p-4 text-xs sm:grid-cols-2 lg:grid-cols-6 dark:border-[#2A2A27] dark:bg-[#161614]">
                <div className="relative lg:col-span-2">
                  <Search className="pointer-events-none absolute top-1/2 start-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#5C5C58]" />
                  <input
                    type="search"
                    aria-label="بحث في الطلبات"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    placeholder="رقم الطلب، اسم العميل، الهاتف، البريد، التتبع..."
                    className="h-9 w-full border border-[#E2E2DD] bg-white ps-8 pe-3 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                  />
                </div>
                <select
                  aria-label="تصفية بحالة الطلب"
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="h-9 border border-[#E2E2DD] bg-white px-2 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                >
                  <option value="ALL">جميع حالات الطلب</option>
                  {ORDER_STATUSES.map((s) => (
                    <option key={s} value={s}>{ORDER_STATUS_LABELS[s]?.ar}</option>
                  ))}
                </select>
                <select
                  aria-label="تصفية بطريقة الدفع"
                  value={filters.payment_method}
                  onChange={(e) => setFilters({ ...filters, payment_method: e.target.value })}
                  className="h-9 border border-[#E2E2DD] bg-white px-2 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                >
                  <option value="ALL">كل طرق الدفع</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]?.ar}</option>
                  ))}
                </select>
                <select
                  aria-label="تصفية بحالة الدفع"
                  value={filters.payment_status}
                  onChange={(e) => setFilters({ ...filters, payment_status: e.target.value })}
                  className="h-9 border border-[#E2E2DD] bg-white px-2 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                >
                  <option value="ALL">كل حالات الدفع</option>
                  {PAYMENT_STATUSES.map((ps) => (
                    <option key={ps} value={ps}>{PAYMENT_STATUS_LABELS[ps]?.ar}</option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label="شركة الشحن"
                  value={filters.shipping_company}
                  onChange={(e) => setFilters({ ...filters, shipping_company: e.target.value })}
                  placeholder="شركة الشحن..."
                  className="h-9 border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                />
                <div className="flex items-center gap-2 lg:col-span-2">
                  <input
                    type="date"
                    aria-label="من تاريخ"
                    value={filters.date_from}
                    onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
                    className="h-9 flex-1 border border-[#E2E2DD] bg-white px-2 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                  />
                  <span>إلى</span>
                  <input
                    type="date"
                    aria-label="إلى تاريخ"
                    value={filters.date_to}
                    onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
                    className="h-9 flex-1 border border-[#E2E2DD] bg-white px-2 font-mono-tabular dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 lg:col-span-4">
                  <button
                    type="button"
                    onClick={handleExportOrdersCsv}
                    className="inline-flex h-9 items-center gap-1.5 border border-[#111111] px-3 text-xs font-semibold text-[#111111] hover:bg-[#111111] hover:text-white dark:border-[#F5F5F2] dark:text-[#F5F5F2] dark:hover:bg-[#F5F5F2] dark:hover:text-[#111111]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>تصدير CSV ({orders.length})</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-[#E2E2DD] bg-white dark:border-[#2A2A27] dark:bg-[#161614]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#E2E2DD] bg-[#F6F6F4] text-[#5C5C58] dark:border-[#2A2A27] dark:bg-[#1E1E1B] dark:text-[#A8A8A0]">
                      <th className="px-4 py-3 text-start">رقم الطلب</th>
                      <th className="px-4 py-3 text-start">العميل</th>
                      <th className="px-4 py-3 text-start">طريقة الدفع</th>
                      <th className="px-4 py-3 text-start">حالة الدفع</th>
                      <th className="px-4 py-3 text-start">حالة الطلب</th>
                      <th className="px-4 py-3 text-start">الإجمالي</th>
                      <th className="px-4 py-3 text-start">التاريخ</th>
                      <th className="px-4 py-3 text-end">تفاصيل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E2DD] dark:divide-[#2A2A27]">
                    {orders.map((o) => (
                      <tr key={o.id} className="hover:bg-[#F6F6F4]/60 dark:hover:bg-[#1E1E1B]/60">
                        <td dir="ltr" className="px-4 py-3 text-start font-mono-tabular font-bold">#{o.order_number}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[#111111] dark:text-[#F5F5F2]">{o.customer_name}</div>
                          <div className="font-mono-tabular text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">{o.customer_phone}</div>
                        </td>
                        <td className="px-4 py-3">{PAYMENT_METHOD_LABELS[o.payment_method]?.ar}</td>
                        <td className="px-4 py-3">
                          <span className={`border px-2 py-0.5 text-[11px] font-semibold ${PAYMENT_STATUS_LABELS[o.payment_status]?.tone || ''}`}>
                            {PAYMENT_STATUS_LABELS[o.payment_status]?.ar}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`border px-2 py-0.5 text-[11px] font-semibold ${ORDER_STATUS_LABELS[o.status]?.tone || ''}`}>
                            {ORDER_STATUS_LABELS[o.status]?.ar}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono-tabular font-bold">{o.total_amount.toLocaleString()} ج.م</td>
                        <td className="px-4 py-3 font-mono-tabular text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">{formatDateTime(o.created_at)}</td>
                        <td className="px-4 py-3 text-end">
                          <button
                            type="button"
                            onClick={() => openOrder(o.id)}
                            className="inline-flex h-8 items-center gap-1.5 bg-[#111111] px-3 text-[11px] font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111] dark:hover:bg-[#E2E2DD]"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            <span>إدارة</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {orders.length === 0 && (
                  <div className="p-8 text-center text-xs text-[#5C5C58] dark:text-[#A8A8A0]">لا توجد طلبات مطابقة للفلاتر الحالية.</div>
                )}
              </div>
            </div>
          )}

          {/* 3. طابور مراجعة المدفوعات (Vodafone Cash & InstaPay) */}
          {activeTab === 'payments' && (
            <div className="space-y-4">
              <div className="border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                <strong>تنبيه مهم للمراجع: </strong>
                لا يتم اعتبار صورة الإيصال إثباتًا نهائيًا لوصول المبلغ. يجب التحقق من وصول التحويل فعليًا قبل الضغط على تأكيد الدفع.
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {orders.map((o) => (
                  <div key={o.id} className="flex gap-4 border border-[#E2E2DD] bg-white p-4 dark:border-[#2A2A27] dark:bg-[#161614]">
                    <div className="h-24 w-24 shrink-0 overflow-hidden border border-[#E2E2DD] bg-[#F6F6F4] dark:border-[#2A2A27] dark:bg-[#1E1E1B]">
                      <ImageWithFallback src={o.latest_receipt_url} alt={`إيصال #${o.order_number}`} className="h-full w-full object-cover" />
                    </div>
                    <div className="flex flex-1 flex-col justify-between text-xs">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono-tabular text-sm font-bold">#{o.order_number}</span>
                          <span className={`border px-2 py-0.5 text-[11px] font-semibold ${PAYMENT_STATUS_LABELS[o.payment_status]?.tone || ''}`}>
                            {PAYMENT_STATUS_LABELS[o.payment_status]?.ar}
                          </span>
                        </div>
                        <p className="mt-1 text-[#5C5C58] dark:text-[#A8A8A0]">
                          {o.customer_name} · {o.payment_method} ·{' '}
                          <strong className="font-mono-tabular text-[#111111] dark:text-[#F5F5F2]">{o.total_amount.toLocaleString()} ج.م</strong>
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#8A8A84]">
                          عدد الإيصالات المرفوعة: {o.receipt_count} · {formatDateTime(o.updated_at)}
                        </p>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => openOrder(o.id)}
                          className="h-8 bg-[#111111] px-4 text-[11px] font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111] dark:hover:bg-[#E2E2DD]"
                        >
                          فتح ومراجعة الإيصال
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. قسم الدفع عند الاستلام (COD) */}
          {activeTab === 'cod' && (
            <div className="space-y-4">
              <div className="border border-[#E2E2DD] bg-white p-4 text-xs text-[#5C5C58] dark:border-[#2A2A27] dark:bg-[#161614] dark:text-[#A8A8A0]">
                طلبات الدفع عند الاستلام تبدأ بحالة <strong className="text-[#111111] dark:text-[#F5F5F2]">Pending Confirmation</strong> وحالة دفع{' '}
                <strong className="text-[#111111] dark:text-[#F5F5F2]">Unpaid</strong>. بعد التسليم يمكن تسجيل التحصيل لتصبح <strong className="text-emerald-700 dark:text-emerald-400">Paid</strong>.
              </div>
              <div className="overflow-x-auto border border-[#E2E2DD] bg-white dark:border-[#2A2A27] dark:bg-[#161614]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#E2E2DD] bg-[#F6F6F4] text-[#5C5C58] dark:border-[#2A2A27] dark:bg-[#1E1E1B] dark:text-[#A8A8A0]">
                      <th className="px-4 py-3 text-start">رقم الطلب</th>
                      <th className="px-4 py-3 text-start">العميل</th>
                      <th className="px-4 py-3 text-start">حالة الطلب</th>
                      <th className="px-4 py-3 text-start">حالة التحصيل</th>
                      <th className="px-4 py-3 text-start">المطلوب تحصيله</th>
                      <th className="px-4 py-3 text-end">إدارة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E2DD] dark:divide-[#2A2A27]">
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td className="px-4 py-3 font-mono-tabular font-bold">#{o.order_number}</td>
                        <td className="px-4 py-3">{o.customer_name} ({o.customer_phone})</td>
                        <td className="px-4 py-3">{ORDER_STATUS_LABELS[o.status]?.ar}</td>
                        <td className="px-4 py-3">
                          <span className={`border px-2 py-0.5 text-[11px] font-semibold ${PAYMENT_STATUS_LABELS[o.payment_status]?.tone || ''}`}>
                            {PAYMENT_STATUS_LABELS[o.payment_status]?.ar}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono-tabular font-bold">{o.total_amount.toLocaleString()} ج.م</td>
                        <td className="px-4 py-3 text-end">
                          <button
                            type="button"
                            onClick={() => openOrder(o.id)}
                            className="h-8 bg-[#111111] px-3 text-[11px] font-semibold text-white dark:bg-[#F5F5F2] dark:text-[#111111]"
                          >
                            مراجعة / تسجيل تحصيل
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5. تخصيص المتجر والمنتجات */}
          {activeTab === 'store' && (
            <StoreAndProductsPanel
              settings={settings}
              products={products}
              canManageStore={hasPerm('manage_store_settings')}
              canManageProducts={hasPerm('manage_products')}
              onSettingsSaved={onSettingsUpdated}
              onProductsReload={async () => {
                await loadTabData();
                await onProductsChanged();
              }}
            />
          )}

          {/* 5b. منشئ صفحات الهبوط التسويقية */}
          {activeTab === 'landing_pages' && (
            <LandingPagesPanel
              pages={landingPages}
              products={products}
              onReload={async () => {
                await loadTabData();
                await onStoreConfigChanged();
              }}
              onPreviewSlug={onPreviewLandingPage}
            />
          )}

          {/* 5c. مدير حسابات السوشيال ميديا */}
          {activeTab === 'social_links' && (
            <SocialLinksPanel
              links={socialLinks}
              onReload={async () => {
                await loadTabData();
                await onStoreConfigChanged();
              }}
            />
          )}

          {/* 5d. أكواد الخصم */}
          {activeTab === 'promos' && (
            <PromoCodesPanel promos={promoCodes} onReload={loadTabData} />
          )}

          {/* 5e. دليل العملاء والمبيعات */}
          {activeTab === 'customers' && (
            <CustomersCrmPanel
              customers={customers}
              onFilterCustomerOrders={(phone) => {
                setFilters((prev) => ({ ...prev, search: phone }));
                setActiveTab('orders');
              }}
            />
          )}

          {/* 6. قوالب رسائل WhatsApp */}
          {activeTab === 'templates' && (
            <WhatsAppTemplatesPanel templates={templates} onReload={loadTabData} />
          )}

          {/* 7. WhatsApp Cloud API والـ Webhook */}
          {activeTab === 'whatsapp_api' && (
            <WhatsAppApiPanel config={waConfig} messages={waMessages} onReload={loadTabData} />
          )}

          {/* 8. سجل العمليات Audit Log */}
          {activeTab === 'audit' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border border-[#E2E2DD] bg-white p-4 dark:border-[#2A2A27] dark:bg-[#161614]">
                <h2 className="text-sm font-bold">سجل العمليات الدائم (Audit Log)</h2>
                <select
                  value={auditFilter}
                  onChange={(e) => setAuditFilter(e.target.value)}
                  className="h-9 border border-[#E2E2DD] bg-white px-3 text-xs dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                >
                  <option value="">كل العمليات</option>
                  <option value="إنشاء الطلب">إنشاء الطلب</option>
                  <option value="استلام إيصال">استلام إيصال</option>
                  <option value="تأكيد الدفع">تأكيد الدفع</option>
                  <option value="رفض الدفع">رفض الدفع</option>
                  <option value="تغيير حالة الطلب">تغيير حالة الطلب</option>
                  <option value="تحديث بيانات الشحن">تحديث بيانات الشحن</option>
                  <option value="إرسال رسالة WhatsApp">إرسال رسالة WhatsApp</option>
                  <option value="فشل إرسال رسالة WhatsApp">فشل إرسال رسالة WhatsApp</option>
                  <option value="إعادة إرسال الرسالة">إعادة إرسال الرسالة</option>
                  <option value="تحصيل الدفع عند الاستلام">تحصيل الدفع عند الاستلام</option>
                </select>
              </div>
              <div className="overflow-x-auto border border-[#E2E2DD] bg-white dark:border-[#2A2A27] dark:bg-[#161614]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#E2E2DD] bg-[#F6F6F4] text-[#5C5C58] dark:border-[#2A2A27] dark:bg-[#1E1E1B] dark:text-[#A8A8A0]">
                      <th className="px-4 py-2.5 text-start">الموظف</th>
                      <th className="px-4 py-2.5 text-start">نوع العملية</th>
                      <th className="px-4 py-2.5 text-start">رقم الطلب</th>
                      <th className="px-4 py-2.5 text-start">التفاصيل</th>
                      <th className="px-4 py-2.5 text-start">التاريخ والوقت</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E2DD] dark:divide-[#2A2A27]">
                    {auditLogs.map((l) => (
                      <tr key={l.id}>
                        <td className="px-4 py-2.5 font-semibold">{l.employee_name}</td>
                        <td className="px-4 py-2.5 font-semibold text-[#111111] dark:text-[#F5F5F2]">{l.action_type}</td>
                        <td className="px-4 py-2.5 font-mono-tabular">{l.order_number ? `#${l.order_number}` : '—'}</td>
                        <td className="px-4 py-2.5 text-[#5C5C58] dark:text-[#A8A8A0]">{l.details}</td>
                        <td className="px-4 py-2.5 font-mono-tabular text-[11px] text-[#8A8A84]">{formatDateTime(l.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 9. إدارة الموظفين والصلاحيات RBAC */}
          {activeTab === 'staff' && (
            <div className="space-y-6">
              <form onSubmit={handleCreateStaff} className="grid grid-cols-1 gap-3 border border-[#E2E2DD] bg-white p-5 text-xs sm:grid-cols-5 dark:border-[#2A2A27] dark:bg-[#161614]">
                <input
                  type="text"
                  required
                  placeholder="اسم الموظف"
                  value={newStaff.name}
                  onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                  className="h-9 border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                />
                <input
                  type="email"
                  required
                  placeholder="البريد الإلكتروني"
                  value={newStaff.email}
                  onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                  className="h-9 border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                />
                <input
                  type="password"
                  required
                  placeholder="كلمة المرور"
                  value={newStaff.password}
                  onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })}
                  className="h-9 border border-[#E2E2DD] bg-white px-2.5 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                />
                <select
                  value={newStaff.role}
                  onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value as StaffRole })}
                  className="h-9 border border-[#E2E2DD] bg-white px-2 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                >
                  {rolesList.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                <button type="submit" className="h-9 bg-[#111111] font-semibold text-white dark:bg-[#F5F5F2] dark:text-[#111111]">
                  إضافة موظف
                </button>
              </form>

              <div className="overflow-x-auto border border-[#E2E2DD] bg-white dark:border-[#2A2A27] dark:bg-[#161614]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#E2E2DD] bg-[#F6F6F4] text-[#5C5C58] dark:border-[#2A2A27] dark:bg-[#1E1E1B] dark:text-[#A8A8A0]">
                      <th className="px-4 py-2.5 text-start">الاسم</th>
                      <th className="px-4 py-2.5 text-start">البريد</th>
                      <th className="px-4 py-2.5 text-start">الدور الوظيفي</th>
                      <th className="px-4 py-2.5 text-start">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E2DD] dark:divide-[#2A2A27]">
                    {staffList.map((u) => (
                      <tr key={u.id}>
                        <td className="px-4 py-2.5 font-bold">{u.name}</td>
                        <td className="px-4 py-2.5 font-mono-tabular">{u.email}</td>
                        <td className="px-4 py-2.5">
                          <select
                            value={u.role}
                            onChange={async (e) => {
                              await updateStaffApi(u.id, { role: e.target.value as StaffRole });
                              await loadTabData();
                            }}
                            className="h-8 border border-[#E2E2DD] bg-white px-2 dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                          >
                            {rolesList.map((r) => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={async () => {
                              await updateStaffApi(u.id, { is_active: !u.is_active });
                              await loadTabData();
                            }}
                            className={`border px-2.5 py-1 text-[11px] font-semibold ${
                              u.is_active
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                            }`}
                          >
                            {u.is_active ? 'نشط' : 'معطل'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
                <h3 className="text-sm font-bold">دليل الصلاحيات المعتمدة بالنظام</h3>
                <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(PERMISSION_LABELS).map(([k, label]) => (
                    <div key={k} className="border border-[#E2E2DD] px-3 py-2 dark:border-[#2A2A27]">
                      <span className="font-semibold text-[#111111] dark:text-[#F5F5F2]">{label}</span>
                      <span className="block font-mono-tabular text-[11px] text-[#8A8A84]">{k}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 10. دليل الإعداد والتكاليف */}
          {activeTab === 'docs' && <SetupDocsAndCostPanel />}
        </main>
      </div>

      {/* نافذة تفاصيل الطلب */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          permissions={staff.effective_permissions}
          onClose={() => setSelectedOrder(null)}
          onUpdated={(updated) => {
            setSelectedOrder(updated);
            loadTabData();
          }}
        />
      )}
    </div>
  );
}

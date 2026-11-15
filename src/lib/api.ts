/**
 * ============================================================================
 * YUOP Streetwear — عميل واجهة برمجة التطبيقات (Frontend API Client)
 * يربط مكونات React بالخادم الخلفي عبر طلبات fetch القياسية.
 * ============================================================================
 */
import type {
  AuditLogEntry,
  CustomerSummary,
  DashboardStats,
  LandingPage,
  LowStockAlert,
  NotificationTemplate,
  OrderDetail,
  OrderStatus,
  OrderSummary,
  PaymentMethod,
  Permission,
  Product,
  PromoCode,
  SocialLink,
  StaffRole,
  StaffUser,
  StoreSettings,
  WhatsAppMessageRecord,
} from '../shared/types.ts';

const STAFF_TOKEN_KEY = 'yuop_staff_token';
let memoryStaffToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function getAdminToken(): string | null {
  try {
    const stored = window.localStorage.getItem(STAFF_TOKEN_KEY);
    if (stored) {
      memoryStaffToken = stored;
      return stored;
    }
  } catch {
    // ignore storage errors in restricted contexts
  }
  return memoryStaffToken;
}

export function setAdminToken(token: string | null): void {
  memoryStaffToken = token;
  try {
    if (token) {
      window.localStorage.setItem(STAFF_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(STAFF_TOKEN_KEY);
    }
  } catch {
    // ignore storage errors in restricted contexts
  }
}

export function onAdminUnauthorized(handler: (() => void) | null): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) {
      unauthorizedHandler = null;
    }
  };
}

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  };
  if (token && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && url.startsWith('/api/admin') && !url.startsWith('/api/admin/auth/login')) {
      setAdminToken(null);
      if (unauthorizedHandler) unauthorizedHandler();
    }
    throw new Error((data as { error?: string }).error || `خطأ في الخادم (${res.status})`);
  }
  return data as T;
}

// ============================================================================
// واجهات المتجر العامة
// ============================================================================
export function fetchStoreConfig() {
  return apiRequest<{
    settings: StoreSettings;
    products: Product[];
    social_links: SocialLink[];
    landing_pages: LandingPage[];
  }>('/api/store/config');
}

export function fetchLandingPageBySlug(slug: string) {
  return apiRequest<{ landing_page: LandingPage }>(`/api/store/landing-pages/${encodeURIComponent(slug)}`);
}

export function validatePromoApi(code: string, subtotal: number) {
  return apiRequest<{
    code: string;
    discount_type: 'percent' | 'fixed';
    discount_value: number;
    discount_amount: number;
  }>('/api/store/validate-promo', {
    method: 'POST',
    body: JSON.stringify({ code, subtotal }),
  });
}

export function createStoreOrder(payload: {
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  governorate: string;
  delivery_address: string;
  notes?: string;
  payment_method: PaymentMethod;
  promo_code?: string;
  items: Array<{ product_id: number; size: string; quantity: number }>;
}) {
  return apiRequest<{ order: OrderDetail; deduplicated: boolean }>('/api/store/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function trackStoreOrder(params: { orderNumber: string; token?: string; phone?: string }) {
  const qs = new URLSearchParams({ orderNumber: params.orderNumber });
  if (params.token) qs.set('token', params.token);
  if (params.phone) qs.set('phone', params.phone);
  return apiRequest<{ order: OrderDetail }>(`/api/store/orders/track?${qs.toString()}`);
}

export function uploadOrderReceipt(params: {
  orderNumber: string;
  tracking_token?: string;
  phone?: string;
  image_base64: string;
}) {
  return apiRequest<{ order: OrderDetail }>(`/api/store/orders/${encodeURIComponent(params.orderNumber)}/receipt`, {
    method: 'POST',
    body: JSON.stringify({
      tracking_token: params.tracking_token,
      phone: params.phone,
      image_base64: params.image_base64,
    }),
  });
}

// ============================================================================
// مصادقة الموظفين ولوحة التحكم
// ============================================================================
export interface AuthedStaffUser extends StaffUser {
  effective_permissions: Permission[];
}

export interface AdminSetupStatus {
  setupRequired: boolean;
  tokenRequired: boolean;
}

export function fetchAdminSetupStatus() {
  return apiRequest<AdminSetupStatus>('/api/admin/auth/setup-status');
}

export async function setupFirstAdminApi(payload: {
  name: string;
  email: string;
  password: string;
  setup_token?: string;
}) {
  const res = await apiRequest<{ token: string; user: AuthedStaffUser }>('/api/admin/auth/setup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (res.token) {
    setAdminToken(res.token);
  }
  return res;
}

export async function loginAdmin(email: string, password: string) {
  const res = await apiRequest<{ token: string; user: AuthedStaffUser }>('/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (res.token) {
    setAdminToken(res.token);
  }
  return res;
}

export async function logoutAdmin() {
  try {
    return await apiRequest<{ ok: boolean }>('/api/admin/auth/logout', { method: 'POST' });
  } finally {
    setAdminToken(null);
  }
}

export async function fetchCurrentStaff() {
  const res = await apiRequest<{ user: AuthedStaffUser | null }>('/api/admin/auth/me');
  if (!res.user) {
    setAdminToken(null);
  }
  return res;
}

export function fetchDashboardOverview() {
  return apiRequest<{
    stats: DashboardStats;
    recent_logs: AuditLogEntry[];
    low_stock_alerts: LowStockAlert[];
  }>('/api/admin/dashboard');
}

export function fetchAdminOrders(filters: Record<string, string>) {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  return apiRequest<{ orders: OrderSummary[] }>(`/api/admin/orders?${qs.toString()}`);
}

export function fetchAdminOrderDetail(orderId: number) {
  return apiRequest<{ order: OrderDetail }>(`/api/admin/orders/${orderId}`);
}

export function confirmOrderPayment(orderId: number) {
  return apiRequest<{ order: OrderDetail }>(`/api/admin/orders/${orderId}/payment/confirm`, {
    method: 'POST',
  });
}

export function rejectOrderPayment(orderId: number, reason: string) {
  return apiRequest<{ order: OrderDetail }>(`/api/admin/orders/${orderId}/payment/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function collectOrderCod(orderId: number) {
  return apiRequest<{ order: OrderDetail }>(`/api/admin/orders/${orderId}/payment/collect-cod`, {
    method: 'POST',
  });
}

export function updateOrderStatusApi(params: {
  orderId: number;
  status: OrderStatus;
  notes?: string;
  cancellation_reason?: string;
  delivery_failure_reason?: string;
}) {
  return apiRequest<{ order: OrderDetail; statusChanged: boolean }>(`/api/admin/orders/${params.orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(params),
  });
}

export function updateOrderShippingApi(
  orderId: number,
  payload: {
    shipping_company?: string | null;
    courier_name?: string | null;
    courier_phone?: string | null;
    tracking_number?: string | null;
    tracking_url?: string | null;
    shipped_at?: string | null;
    expected_delivery_at?: string | null;
    delivery_notes?: string | null;
    delivery_failure_reason?: string | null;
    send_whatsapp?: boolean;
  }
) {
  return apiRequest<{ order: OrderDetail }>(`/api/admin/orders/${orderId}/shipping`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function sendTrackingWhatsAppApi(orderId: number) {
  return apiRequest<{ message: WhatsAppMessageRecord | null; order: OrderDetail }>(
    `/api/admin/orders/${orderId}/whatsapp/send-tracking`,
    { method: 'POST' }
  );
}

export function retryWhatsAppMessageApi(messageId: number) {
  return apiRequest<{ message: WhatsAppMessageRecord }>(
    `/api/admin/whatsapp/messages/${messageId}/retry`,
    { method: 'POST' }
  );
}

export function fetchAdminProducts() {
  return apiRequest<{ products: Product[] }>('/api/admin/products');
}

export function createProductApi(payload: Partial<Product>) {
  return apiRequest<{ product: Product }>('/api/admin/products', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateProductApi(id: number, payload: Partial<Product>) {
  return apiRequest<{ product: Product }>(`/api/admin/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteProductApi(id: number) {
  return apiRequest<{ ok: boolean }>(`/api/admin/products/${id}`, { method: 'DELETE' });
}

export function updateStoreSettingsApi(payload: Partial<StoreSettings>) {
  return apiRequest<{ settings: StoreSettings }>('/api/admin/store-settings', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function fetchTemplatesApi() {
  return apiRequest<{ templates: NotificationTemplate[] }>('/api/admin/templates');
}

export function updateTemplateApi(key: string, payload: Partial<NotificationTemplate>) {
  return apiRequest<{ template: NotificationTemplate }>(`/api/admin/templates/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export interface WhatsAppConfigResponse {
  phone_number_id_configured: boolean;
  phone_number_id_masked: string;
  business_account_id_configured: boolean;
  business_account_id_masked: string;
  access_token_configured: boolean;
  webhook_verify_token_configured: boolean;
  app_secret_configured: boolean;
  api_version: string;
  webhook_url: string;
  email_provider_configured?: boolean;
  email_provider?: string;
}

export function fetchWhatsAppConfigApi() {
  return apiRequest<{ config: WhatsAppConfigResponse }>('/api/admin/whatsapp/config');
}

export function testWhatsAppConnectionApi() {
  return apiRequest<{ ok: boolean; details?: Record<string, unknown>; error?: string }>(
    '/api/admin/whatsapp/test',
    { method: 'POST' }
  );
}

export function fetchWhatsAppMessagesApi() {
  return apiRequest<{ messages: Array<WhatsAppMessageRecord & { order_number?: string }> }>('/api/admin/whatsapp/messages');
}

export function fetchAuditLogsApi(actionType?: string) {
  const qs = actionType ? `?action_type=${encodeURIComponent(actionType)}` : '';
  return apiRequest<{ logs: AuditLogEntry[] }>(`/api/admin/audit-logs${qs}`);
}

export function fetchStaffApi() {
  return apiRequest<{
    staff: StaffUser[];
    roles: StaffRole[];
    permissions: Permission[];
    role_defaults: Record<StaffRole, Permission[]>;
  }>('/api/admin/staff');
}

export function createStaffApi(payload: {
  name: string;
  email: string;
  password: string;
  role: StaffRole;
  custom_permissions?: Permission[] | null;
}) {
  return apiRequest<{ id: number }>('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateStaffApi(
  id: number,
  payload: { role?: StaffRole; custom_permissions?: Permission[] | null; is_active?: boolean }
) {
  return apiRequest<{ ok: boolean }>(`/api/admin/staff/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// صفحات الهبوط التسويقية
export function fetchLandingPagesApi() {
  return apiRequest<{ landing_pages: LandingPage[] }>('/api/admin/landing-pages');
}

export function createLandingPageApi(payload: Partial<LandingPage>) {
  return apiRequest<{ landing_page: LandingPage }>('/api/admin/landing-pages', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateLandingPageApi(id: number, payload: Partial<LandingPage>) {
  return apiRequest<{ landing_page: LandingPage }>(`/api/admin/landing-pages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteLandingPageApi(id: number) {
  return apiRequest<{ ok: boolean }>(`/api/admin/landing-pages/${id}`, { method: 'DELETE' });
}

// روابط التواصل الاجتماعي
export function fetchSocialLinksApi() {
  return apiRequest<{ social_links: SocialLink[] }>('/api/admin/social-links');
}

export function createSocialLinkApi(payload: Partial<SocialLink>) {
  return apiRequest<{ social_link: SocialLink }>('/api/admin/social-links', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSocialLinkApi(id: number, payload: Partial<SocialLink>) {
  return apiRequest<{ social_link: SocialLink }>(`/api/admin/social-links/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteSocialLinkApi(id: number) {
  return apiRequest<{ ok: boolean }>(`/api/admin/social-links/${id}`, { method: 'DELETE' });
}

// أكواد الخصم ودليل العملاء
export function fetchPromoCodesApi() {
  return apiRequest<{ promo_codes: PromoCode[] }>('/api/admin/promo-codes');
}

export function createPromoCodeApi(payload: Partial<PromoCode>) {
  return apiRequest<{ promo_code: PromoCode }>('/api/admin/promo-codes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updatePromoCodeApi(id: number, payload: Partial<PromoCode>) {
  return apiRequest<{ promo_code: PromoCode }>(`/api/admin/promo-codes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deletePromoCodeApi(id: number) {
  return apiRequest<{ ok: boolean }>(`/api/admin/promo-codes/${id}`, { method: 'DELETE' });
}

export function fetchCustomersApi() {
  return apiRequest<{ customers: CustomerSummary[] }>('/api/admin/customers');
}

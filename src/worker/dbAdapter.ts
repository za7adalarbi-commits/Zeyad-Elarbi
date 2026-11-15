/**
 * ============================================================================
 * YUOP Streetwear — طبقة تجريد قاعدة البيانات (Cloudflare D1 Adapter)
 * توحد التعامل بين Cloudflare D1 في الإنتاج و node:sqlite في التطوير المحلي والاختبارات.
 * ============================================================================
 */
import type { D1Database } from '@cloudflare/workers-types';
import type {
  LandingPage,
  NotificationTemplate,
  Permission,
  Product,
  PromoCode,
  SocialLink,
  SocialPlatform,
  StaffRole,
  StoreSettings,
  ThemeMode,
} from '../shared/types.ts';

export interface DbRunResult {
  meta: {
    last_row_id: number;
    changes: number;
  };
}

export interface DbStatementInput {
  sql: string;
  params?: unknown[];
}

export interface DbClient {
  first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<DbRunResult>;
  batch(statements: DbStatementInput[]): Promise<DbRunResult[]>;
}

/**
 * محول Cloudflare D1 الرسمي باستخدام Prepared Statements و D1 Batch
 */
export function createD1DbClient(d1: D1Database): DbClient {
  return {
    async first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null> {
      const stmt = params.length > 0 ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
      const row = await stmt.first<T>();
      return row ?? null;
    },
    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
      const stmt = params.length > 0 ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
      const res = await stmt.all<T>();
      return res.results || [];
    },
    async run(sql: string, ...params: unknown[]): Promise<DbRunResult> {
      const stmt = params.length > 0 ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
      const res = await stmt.run();
      return {
        meta: {
          last_row_id: Number(res.meta?.last_row_id ?? 0),
          changes: Number(res.meta?.changes ?? 0),
        },
      };
    },
    async batch(statements: DbStatementInput[]): Promise<DbRunResult[]> {
      if (statements.length === 0) return [];
      const prepared = statements.map((s) =>
        s.params && s.params.length > 0 ? d1.prepare(s.sql).bind(...s.params) : d1.prepare(s.sql)
      );
      const results = await d1.batch(prepared);
      return results.map((res) => ({
        meta: {
          last_row_id: Number(res.meta?.last_row_id ?? 0),
          changes: Number(res.meta?.changes ?? 0),
        },
      }));
    },
  };
}

export function mapProductRow(row: Record<string, unknown>): Product {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name_ar: String(row.name_ar),
    name_en: String(row.name_en),
    category: String(row.category),
    price: Number(row.price),
    compare_at_price: row.compare_at_price !== null && row.compare_at_price !== undefined ? Number(row.compare_at_price) : null,
    description_ar: String(row.description_ar),
    description_en: String(row.description_en),
    fabric_details: String(row.fabric_details),
    image_url: String(row.image_url),
    secondary_image_url: row.secondary_image_url ? String(row.secondary_image_url) : null,
    sizes_stock: JSON.parse(String(row.sizes_stock || '{}')) as Record<string, number>,
    is_featured: Boolean(row.is_featured),
    is_active: Boolean(row.is_active),
    badge_text: row.badge_text ? String(row.badge_text) : null,
    created_at: String(row.created_at),
  };
}

export function mapStoreSettingsRow(row: Record<string, unknown>): StoreSettings {
  return {
    id: Number(row.id),
    store_name: String(row.store_name),
    tagline_ar: String(row.tagline_ar),
    tagline_en: String(row.tagline_en),
    announcement_enabled: Boolean(row.announcement_enabled),
    announcement_text_ar: String(row.announcement_text_ar),
    announcement_text_en: String(row.announcement_text_en),
    hero_kicker_ar: String(row.hero_kicker_ar),
    hero_kicker_en: String(row.hero_kicker_en),
    hero_title_ar: String(row.hero_title_ar),
    hero_title_en: String(row.hero_title_en),
    hero_subtitle_ar: String(row.hero_subtitle_ar),
    hero_subtitle_en: String(row.hero_subtitle_en),
    hero_cta_ar: String(row.hero_cta_ar),
    hero_cta_en: String(row.hero_cta_en),
    hero_image_url: String(row.hero_image_url),
    accent_color: String(row.accent_color),
    default_theme: (String(row.default_theme || 'light') === 'dark' ? 'dark' : 'light') as ThemeMode,
    currency_code: String(row.currency_code),
    currency_symbol_ar: String(row.currency_symbol_ar),
    shipping_fee: Number(row.shipping_fee),
    free_shipping_threshold: Number(row.free_shipping_threshold),
    support_whatsapp: String(row.support_whatsapp),
    support_email: String(row.support_email),
    vodafone_cash_number: String(row.vodafone_cash_number),
    vodafone_cash_instructions_ar: String(row.vodafone_cash_instructions_ar),
    instapay_address: String(row.instapay_address),
    instapay_instructions_ar: String(row.instapay_instructions_ar),
    cod_enabled: Boolean(row.cod_enabled),
    vodafone_enabled: Boolean(row.vodafone_enabled),
    instapay_enabled: Boolean(row.instapay_enabled),
    footer_about_ar: String(row.footer_about_ar),
    footer_about_en: String(row.footer_about_en),
    updated_at: String(row.updated_at),
  };
}

export function mapTemplateRow(row: Record<string, unknown>): NotificationTemplate {
  return {
    id: Number(row.id),
    template_key: String(row.template_key),
    title_ar: String(row.title_ar),
    description_ar: String(row.description_ar),
    body: String(row.body),
    is_enabled: Boolean(row.is_enabled),
    meta_template_name: row.meta_template_name ? String(row.meta_template_name) : null,
    updated_at: String(row.updated_at),
  };
}

export function mapLandingPageRow(row: Record<string, unknown>): LandingPage {
  let highlights: string[] = [];
  let featuredProductIds: number[] = [];
  try {
    highlights = JSON.parse(String(row.highlights_json || '[]')) as string[];
  } catch {
    highlights = [];
  }
  try {
    featuredProductIds = JSON.parse(String(row.featured_product_ids_json || '[]')) as number[];
  } catch {
    featuredProductIds = [];
  }
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title_ar: String(row.title_ar),
    title_en: String(row.title_en),
    kicker_ar: String(row.kicker_ar),
    kicker_en: String(row.kicker_en),
    subtitle_ar: String(row.subtitle_ar),
    subtitle_en: String(row.subtitle_en),
    hero_image_url: String(row.hero_image_url),
    cta_text_ar: String(row.cta_text_ar),
    cta_text_en: String(row.cta_text_en),
    theme_style: (String(row.theme_style || 'dark') === 'light' ? 'light' : 'dark') as ThemeMode,
    highlights: Array.isArray(highlights) ? highlights : [],
    featured_product_ids: Array.isArray(featuredProductIds) ? featuredProductIds.map(Number) : [],
    is_published: Boolean(row.is_published),
    show_in_footer: Boolean(row.show_in_footer),
    views_count: Number(row.views_count || 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapSocialLinkRow(row: Record<string, unknown>): SocialLink {
  return {
    id: Number(row.id),
    platform: String(row.platform) as SocialPlatform,
    label: String(row.label),
    handle: row.handle ? String(row.handle) : null,
    url: String(row.url),
    sort_order: Number(row.sort_order || 0),
    is_active: Boolean(row.is_active),
    updated_at: String(row.updated_at),
  };
}

export function mapPromoCodeRow(row: Record<string, unknown>): PromoCode {
  return {
    id: Number(row.id),
    code: String(row.code),
    discount_type: String(row.discount_type) === 'fixed' ? 'fixed' : 'percent',
    discount_value: Number(row.discount_value),
    min_order_amount: Number(row.min_order_amount || 0),
    max_uses: row.max_uses !== null && row.max_uses !== undefined ? Number(row.max_uses) : null,
    used_count: Number(row.used_count || 0),
    is_active: Boolean(row.is_active),
    expires_at: row.expires_at ? String(row.expires_at) : null,
    created_at: String(row.created_at),
  };
}

export function parseStaffPermissions(raw: unknown): Permission[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(String(raw)) as Permission[];
  } catch {
    return null;
  }
}

export function castStaffRole(raw: unknown): StaffRole {
  return String(raw) as StaffRole;
}

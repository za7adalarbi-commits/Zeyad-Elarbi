/**
 * ============================================================================
 * YUOP Streetwear — تعريفات بيئة Cloudflare Workers (Bindings & Secrets)
 * ============================================================================
 */
import type { D1Database, Fetcher, R2Bucket } from '@cloudflare/workers-types';

export interface WorkerBindings {
  // قواعد البيانات والتخزين المجاني في Cloudflare
  DB: D1Database;
  RECEIPTS_BUCKET: R2Bucket;
  ASSETS?: Fetcher;

  // متغيرات البيئة العامة (wrangler.jsonc vars)
  APP_URL?: string;
  ENVIRONMENT?: string;
  WHATSAPP_API_VERSION?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  ALLOW_DEV_SEED?: string;

  // أسرار Cloudflare (يتم ضبطها عبر wrangler secret put أو لوحة التحكم)
  SESSION_SECRET?: string;
  ADMIN_SETUP_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
}

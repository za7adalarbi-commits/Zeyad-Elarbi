/**
 * ============================================================================
 * YUOP Streetwear — خدمة WhatsApp Cloud API الرسمي (Cloudflare Workers)
 * تعتمد كليًا على Web Standard fetch و Cloudflare R2 لحفظ وسائط الإيصالات.
 * ============================================================================
 */
import { normalizeWhatsAppPhone } from '../../shared/orderRules.ts';
import { randomHex } from '../crypto.ts';
import { validateReceiptBytes, type ReceiptStorage } from '../r2Storage.ts';
import type { WorkerBindings } from '../types.ts';

export interface WhatsAppConfigStatus {
  phone_number_id_configured: boolean;
  phone_number_id_masked: string;
  business_account_id_configured: boolean;
  business_account_id_masked: string;
  access_token_configured: boolean;
  webhook_verify_token_configured: boolean;
  app_secret_configured: boolean;
  api_version: string;
  webhook_url: string;
  email_provider_configured: boolean;
  email_provider: string;
}

export interface WhatsAppSendResult {
  ok: boolean;
  metaMessageId?: string;
  error?: string;
}

export interface WhatsAppTransport {
  sendText(toPhone: string, body: string): Promise<WhatsAppSendResult>;
  sendImage(toPhone: string, imageUrl: string, caption?: string): Promise<WhatsAppSendResult>;
  testConnection(): Promise<{ ok: boolean; details?: Record<string, unknown>; error?: string }>;
  downloadMediaToStorage(
    mediaId: string,
    storage: ReceiptStorage
  ): Promise<{ ok: boolean; filePath?: string; fileName?: string; error?: string }>;
}

function maskSecret(val: string | undefined): string {
  if (!val) return '';
  if (val.length <= 6) return '***';
  return `${val.slice(0, 3)}••••${val.slice(-3)}`;
}

export function getWhatsAppConfigStatus(
  env: Partial<WorkerBindings>,
  originFallback?: string
): WhatsAppConfigStatus {
  const baseUrl = (env.APP_URL || originFallback || 'http://localhost:3000').replace(/\/$/, '');
  const emailProvider = env.RESEND_API_KEY
    ? 'Resend HTTP API'
    : env.BREVO_API_KEY
      ? 'Brevo HTTP API'
      : 'غير مضبوط (اختياري)';

  return {
    phone_number_id_configured: Boolean(env.WHATSAPP_PHONE_NUMBER_ID),
    phone_number_id_masked: maskSecret(env.WHATSAPP_PHONE_NUMBER_ID),
    business_account_id_configured: Boolean(env.WHATSAPP_BUSINESS_ACCOUNT_ID),
    business_account_id_masked: maskSecret(env.WHATSAPP_BUSINESS_ACCOUNT_ID),
    access_token_configured: Boolean(env.WHATSAPP_ACCESS_TOKEN),
    webhook_verify_token_configured: Boolean(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    app_secret_configured: Boolean(env.WHATSAPP_APP_SECRET),
    api_version: env.WHATSAPP_API_VERSION || 'v21.0',
    webhook_url: `${baseUrl}/api/webhooks/whatsapp`,
    email_provider_configured: Boolean(env.RESEND_API_KEY || env.BREVO_API_KEY),
    email_provider: emailProvider,
  };
}

export function createWhatsAppTransport(
  env: Partial<WorkerBindings>,
  customFetch?: typeof fetch
): WhatsAppTransport {
  const fetchFn = customFetch || fetch;

  const getCreds = () => ({
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
    apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
  });

  return {
    async sendText(toPhone: string, body: string): Promise<WhatsAppSendResult> {
      const { phoneNumberId, accessToken, apiVersion } = getCreds();
      const recipient = normalizeWhatsAppPhone(toPhone);
      if (!recipient) {
        return { ok: false, error: 'رقم هاتف العميل غير صالح للإرسال عبر واتساب.' };
      }
      if (!phoneNumberId || !accessToken) {
        return {
          ok: false,
          error: 'إعدادات WhatsApp Cloud API غير مكتملة في Secrets (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN).',
        };
      }

      try {
        const res = await fetchFn(
          `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: recipient,
              type: 'text',
              text: { preview_url: true, body },
            }),
          }
        );

        const data = (await res.json()) as {
          messages?: Array<{ id: string }>;
          error?: { message?: string; code?: number };
        };

        if (!res.ok) {
          return {
            ok: false,
            error: data?.error?.message || `فشل الإرسال عبر Meta API (HTTP ${res.status})`,
          };
        }

        return { ok: true, metaMessageId: data?.messages?.[0]?.id };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'خطأ في الاتصال بخوادم Meta WhatsApp API',
        };
      }
    },

    async sendImage(toPhone: string, imageUrl: string, caption?: string): Promise<WhatsAppSendResult> {
      const { phoneNumberId, accessToken, apiVersion } = getCreds();
      const recipient = normalizeWhatsAppPhone(toPhone);
      if (!phoneNumberId || !accessToken) {
        return { ok: false, error: 'إعدادات WhatsApp Cloud API غير مكتملة في Secrets.' };
      }

      try {
        const res = await fetchFn(
          `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: recipient,
              type: 'image',
              image: { link: imageUrl, caption },
            }),
          }
        );
        const data = (await res.json()) as {
          messages?: Array<{ id: string }>;
          error?: { message?: string };
        };
        if (!res.ok) {
          return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
        }
        return { ok: true, metaMessageId: data?.messages?.[0]?.id };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
      }
    },

    async testConnection() {
      const { phoneNumberId, accessToken, apiVersion } = getCreds();
      if (!phoneNumberId || !accessToken) {
        return {
          ok: false,
          error: 'يرجى ضبط WHATSAPP_PHONE_NUMBER_ID و WHATSAPP_ACCESS_TOKEN في Cloudflare Secrets أولًا.',
        };
      }
      try {
        const res = await fetchFn(
          `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) {
          const errObj = data.error as { message?: string } | undefined;
          return { ok: false, error: errObj?.message || `HTTP ${res.status}` };
        }
        return { ok: true, details: data };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
      }
    },

    async downloadMediaToStorage(mediaId: string, storage: ReceiptStorage) {
      const { accessToken, apiVersion } = getCreds();
      if (!accessToken) {
        return { ok: false, error: 'WHATSAPP_ACCESS_TOKEN غير متوفر لتحميل المرفق.' };
      }
      try {
        const metaRes = await fetchFn(
          `https://graph.facebook.com/${apiVersion}/${mediaId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const metaData = (await metaRes.json()) as {
          url?: string;
          mime_type?: string;
          error?: { message?: string };
        };
        if (!metaRes.ok || !metaData.url) {
          return { ok: false, error: metaData.error?.message || 'تعذر جلب رابط الوسائط من Meta' };
        }

        const binaryRes = await fetchFn(metaData.url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!binaryRes.ok) {
          return { ok: false, error: `فشل تحميل ملف الصورة (HTTP ${binaryRes.status})` };
        }
        const rawBytes = new Uint8Array(await binaryRes.arrayBuffer());
        const validated = validateReceiptBytes(rawBytes);

        const safeMediaId = mediaId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'media';
        const fileName = `wa_${safeMediaId}_${randomHex(6)}.${validated.ext}`;
        const storageKey = `receipts/${fileName}`;
        await storage.put(storageKey, validated.bytes, validated.contentType);

        return { ok: true, filePath: storageKey, fileName };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'فشل تحميل المرفق' };
      }
    },
  };
}

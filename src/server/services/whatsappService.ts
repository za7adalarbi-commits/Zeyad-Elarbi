/**
 * ============================================================================
 * YUOP Streetwear — خدمة WhatsApp Cloud API الرسمي (Meta Graph API)
 * تتعامل مباشرة مع Meta WhatsApp Cloud API لتقليل التكلفة (بدون وسطاء).
 * جميع الأسرار تُقرأ من متغيرات البيئة (process.env) ولا تُرسل للواجهة أبدًا.
 * ============================================================================
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeWhatsAppPhone } from '../../shared/orderRules.ts';

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
  downloadMedia(mediaId: string, uploadsDir: string): Promise<{ ok: boolean; filePath?: string; fileName?: string; error?: string }>;
}

function maskSecret(val: string | undefined): string {
  if (!val) return '';
  if (val.length <= 6) return '***';
  return `${val.slice(0, 3)}••••${val.slice(-3)}`;
}

export function getWhatsAppConfigStatus(appUrl?: string): WhatsAppConfigStatus {
  const baseUrl = (appUrl || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return {
    phone_number_id_configured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    phone_number_id_masked: maskSecret(process.env.WHATSAPP_PHONE_NUMBER_ID),
    business_account_id_configured: Boolean(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID),
    business_account_id_masked: maskSecret(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID),
    access_token_configured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    webhook_verify_token_configured: Boolean(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    app_secret_configured: Boolean(process.env.WHATSAPP_APP_SECRET),
    api_version: process.env.WHATSAPP_API_VERSION || 'v21.0',
    webhook_url: `${baseUrl}/api/webhooks/whatsapp`,
  };
}

/**
 * إنشاء موصل Meta WhatsApp Cloud API الرسمي
 * يقبل دالة fetch مخصصة لتسهيل الاختبارات التلقائية دون اتصال خارجي.
 */
export function createWhatsAppTransport(customFetch?: typeof fetch): WhatsAppTransport {
  const fetchFn = customFetch || fetch;

  const getCreds = () => ({
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
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
          error: 'إعدادات WhatsApp Cloud API غير مكتملة في متغيرات البيئة (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN).',
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

        return {
          ok: true,
          metaMessageId: data?.messages?.[0]?.id,
        };
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
        return { ok: false, error: 'إعدادات WhatsApp Cloud API غير مكتملة في متغيرات البيئة.' };
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
          error: 'يرجى ضبط WHATSAPP_PHONE_NUMBER_ID و WHATSAPP_ACCESS_TOKEN في ملف .env أو متغيرات البيئة أولًا.',
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

    /**
     * تحميل صورة الإيصال من خوادم Meta وحفظها محليًا بشكل دائم
     * لأن روابط وسائط WhatsApp مؤقتة وتنتهي صلاحيتها (القسم الثامن عشر).
     */
    async downloadMedia(mediaId: string, uploadsDir: string) {
      const { accessToken, apiVersion } = getCreds();
      if (!accessToken) {
        return { ok: false, error: 'WHATSAPP_ACCESS_TOKEN غير متوفر لتحميل المرفق.' };
      }
      try {
        const metaRes = await fetchFn(
          `https://graph.facebook.com/${apiVersion}/${mediaId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const metaData = (await metaRes.json()) as { url?: string; mime_type?: string; error?: { message?: string } };
        if (!metaRes.ok || !metaData.url) {
          return { ok: false, error: metaData.error?.message || 'تعذر جلب رابط الوسائط من Meta' };
        }

        const binaryRes = await fetchFn(metaData.url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!binaryRes.ok) {
          return { ok: false, error: `فشل تحميل ملف الصورة (HTTP ${binaryRes.status})` };
        }
        const arrayBuf = await binaryRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        const ext = metaData.mime_type?.includes('png')
          ? 'png'
          : metaData.mime_type?.includes('webp')
            ? 'webp'
            : 'jpg';
        const fileName = `wa_${mediaId}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
        fs.mkdirSync(uploadsDir, { recursive: true });
        const filePath = path.join(uploadsDir, fileName);
        fs.writeFileSync(filePath, buffer);
        return { ok: true, filePath, fileName };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'فشل تحميل المرفق' };
      }
    },
  };
}

/**
 * ============================================================================
 * YUOP Streetwear — خدمة البريد الإلكتروني المتوافقة مع Cloudflare Workers
 * تعتمد على HTTP Email APIs المجانية (Resend / Brevo) بدلًا من SMTP التقليدي
 * غير المتاح في Cloudflare Workers. الإرسال اختياري ولا يعطل الطلب أبدًا.
 * ============================================================================
 */
import type { WorkerBindings } from '../types.ts';
import type { DbClient } from '../dbAdapter.ts';

export interface EmailSendResult {
  sent: boolean;
  provider: 'resend' | 'brevo' | 'none';
  reason?: string;
}

export async function sendOrderEmailNotification(params: {
  env: Partial<WorkerBindings>;
  db?: DbClient;
  orderId?: number | null;
  to: string | null | undefined;
  subject: string;
  text: string;
  customFetch?: typeof fetch;
}): Promise<EmailSendResult> {
  if (!params.to) {
    return { sent: false, provider: 'none', reason: 'لا يوجد بريد إلكتروني للعميل.' };
  }

  const fetchFn = params.customFetch || fetch;
  const resendKey = params.env.RESEND_API_KEY?.trim();
  const brevoKey = params.env.BREVO_API_KEY?.trim();
  const preferred = (params.env.EMAIL_PROVIDER || '').toLowerCase();
  const fromEmail = params.env.EMAIL_FROM?.trim() || 'orders@yuop.store';
  const fromName = params.env.EMAIL_FROM_NAME?.trim() || 'YUOP Streetwear';

  let provider: 'resend' | 'brevo' | 'none' = 'none';
  if (preferred === 'brevo' && brevoKey) provider = 'brevo';
  else if (preferred === 'resend' && resendKey) provider = 'resend';
  else if (resendKey) provider = 'resend';
  else if (brevoKey) provider = 'brevo';

  if (provider === 'none') {
    const reason = 'خدمة البريد الإلكتروني (RESEND_API_KEY أو BREVO_API_KEY) غير مضبوطة (اختياري).';
    if (params.db) {
      try {
        await params.db.run(
          `INSERT INTO email_logs (order_id, recipient_email, provider, status, error_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          params.orderId ?? null,
          params.to,
          'none',
          'Skipped',
          reason,
          new Date().toISOString()
        );
      } catch {
        // ignore
      }
    }
    return {
      sent: false,
      provider: 'none',
      reason,
    };
  }

  let result: EmailSendResult;
  try {
    if (provider === 'resend') {
      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [params.to],
          subject: params.subject,
          text: params.text,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        result = {
          sent: false,
          provider: 'resend',
          reason: `Resend HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`,
        };
      } else {
        result = { sent: true, provider: 'resend' };
      }
    } else {
      const res = await fetchFn('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': brevoKey!,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email: params.to }],
          subject: params.subject,
          textContent: params.text,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        result = {
          sent: false,
          provider: 'brevo',
          reason: `Brevo HTTP ${res.status}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`,
        };
      } else {
        result = { sent: true, provider: 'brevo' };
      }
    }
  } catch (err) {
    result = {
      sent: false,
      provider,
      reason: err instanceof Error ? err.message : 'فشل الاتصال بمزود البريد الإلكتروني',
    };
  }

  if (params.db) {
    try {
      await params.db.run(
        `INSERT INTO email_logs (order_id, recipient_email, provider, status, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        params.orderId ?? null,
        params.to,
        result.provider,
        result.sent ? 'Sent' : 'Failed',
        result.reason || null,
        new Date().toISOString()
      );
    } catch {
      // لا نعطل الطلب أبدًا بسبب تسجيل البريد
    }
  }

  return result;
}

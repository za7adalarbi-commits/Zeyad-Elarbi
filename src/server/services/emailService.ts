/**
 * ============================================================================
 * YUOP Streetwear — خدمة البريد الإلكتروني عبر Gmail SMTP (مجانية)
 * تستخدم مكتبة nodemailer عند توفر GMAIL_USER و GMAIL_APP_PASSWORD في البيئة.
 * ============================================================================
 */
import nodemailer from 'nodemailer';

export async function sendOrderEmailNotification(params: {
  to: string | null | undefined;
  subject: string;
  text: string;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!params.to) {
    return { sent: false, reason: 'لا يوجد بريد إلكتروني للعميل.' };
  }
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    return { sent: false, reason: 'إعدادات Gmail SMTP غير مضبوطة (اختياري).' };
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: `"${process.env.GMAIL_FROM_NAME || 'YUOP Streetwear'}" <${user}>`,
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : 'فشل إرسال البريد الإلكتروني',
    };
  }
}

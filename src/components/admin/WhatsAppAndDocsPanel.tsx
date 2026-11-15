/**
 * ============================================================================
 * لوحة إدارة قوالب WhatsApp، إعدادات Cloud API، ودليل الإعداد والتكاليف
 * تغطي الأقسام: الحادي عشر، الثاني عشر، العشرون، والثاني والعشرون.
 * ============================================================================
 */
import { useState } from 'react';
import { Save, Wifi, RotateCcw, Copy, Check, ShieldAlert, BookOpen } from 'lucide-react';
import type { NotificationTemplate, WhatsAppMessageRecord } from '../../shared/types.ts';
import {
  retryWhatsAppMessageApi,
  testWhatsAppConnectionApi,
  updateTemplateApi,
  type WhatsAppConfigResponse,
} from '../../lib/api.ts';
import { formatDateTime } from '../../lib/i18n.ts';

interface TemplatesPanelProps {
  templates: NotificationTemplate[];
  onReload: () => Promise<void>;
}

export function WhatsAppTemplatesPanel({ templates, onReload }: TemplatesPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, { body: string; is_enabled: boolean; meta_template_name: string }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const getDraft = (t: NotificationTemplate) =>
    drafts[t.template_key] || {
      body: t.body,
      is_enabled: t.is_enabled,
      meta_template_name: t.meta_template_name || '',
    };

  const handleSave = async (t: NotificationTemplate) => {
    const d = getDraft(t);
    setSavingKey(t.template_key);
    setMsg(null);
    try {
      await updateTemplateApi(t.template_key, d);
      await onReload();
      setMsg(`تم حفظ قالب "${t.title_ar}" بنجاح.`);
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
        <h2 className="text-base font-bold text-[#111111] dark:text-[#F5F5F2]">إدارة قوالب رسائل WhatsApp التلقائية</h2>
        <p className="mt-1 text-xs leading-relaxed text-[#5C5C58] dark:text-[#A8A8A0]">
          المتغيرات المتاحة للاستخدام داخل النصوص:{' '}
          <span className="font-mono-tabular font-semibold text-[#111111] dark:text-[#F5F5F2]">
            ORDER_ID · CUSTOMER_NAME · TOTAL_AMOUNT · PAYMENT_METHOD · SHIPPING_COMPANY · TRACKING_NUMBER · TRACKING_URL · REJECTION_REASON · CANCELLATION_REASON · VODAFONE_NUMBER · INSTAPAY_ADDRESS
          </span>
        </p>
        <div className="mt-3 border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          <strong>قواعد Meta WhatsApp الرسمية: </strong>
          الرسائل التي يبدؤها المتجر خارج نافذة خدمة العملاء (24 ساعة من آخر رسالة للعميل) تتطلب قوالب معتمدة مسبقًا في حساب WhatsApp Manager لتجنب حظر الإرسال.
        </div>
        {msg && <div className="mt-3 border border-emerald-300 bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">{msg}</div>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {templates.map((t) => {
          const d = getDraft(t);
          return (
            <div key={t.template_key} className="flex flex-col justify-between border border-[#E2E2DD] bg-white p-5 dark:border-[#2A2A27] dark:bg-[#161614]">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#111111] dark:text-[#F5F5F2]">{t.title_ar}</h3>
                    <p className="mt-0.5 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">{t.description_ar}</p>
                  </div>
                  <label className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={d.is_enabled}
                      onChange={(e) =>
                        setDrafts({ ...drafts, [t.template_key]: { ...d, is_enabled: e.target.checked } })
                      }
                    />
                    <span>{d.is_enabled ? 'مفعل' : 'معطل'}</span>
                  </label>
                </div>

                <div className="mt-3">
                  <label className="block text-[11px] font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">
                    اسم القالب المعتمد في Meta (اختياري)
                  </label>
                  <input
                    type="text"
                    value={d.meta_template_name}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [t.template_key]: { ...d, meta_template_name: e.target.value } })
                    }
                    className="mt-1 h-8 w-full border border-[#E2E2DD] px-2.5 font-mono-tabular text-xs dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                  />
                </div>

                <div className="mt-3">
                  <label className="block text-[11px] font-semibold text-[#5C5C58] dark:text-[#A8A8A0]">نص الرسالة</label>
                  <textarea
                    rows={4}
                    value={d.body}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [t.template_key]: { ...d, body: e.target.value } })
                    }
                    className="mt-1 w-full border border-[#E2E2DD] p-2.5 text-xs leading-relaxed focus:border-[#111111] focus:outline-none dark:border-[#2A2A27] dark:bg-[#0D0D0C]"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={savingKey === t.template_key}
                  onClick={() => handleSave(t)}
                  className="inline-flex h-9 items-center gap-1.5 bg-[#111111] px-4 text-xs font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{savingKey === t.template_key ? 'جاري الحفظ...' : 'حفظ القالب'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface WhatsAppApiPanelProps {
  config: WhatsAppConfigResponse | null;
  messages: Array<WhatsAppMessageRecord & { order_number?: string }>;
  onReload: () => Promise<void>;
}

export function WhatsAppApiPanel({ config, messages, onReload }: WhatsAppApiPanelProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testWhatsAppConnectionApi();
      setTestResult({
        ok: true,
        text: `الاتصال ناجح! الرقم: ${String(res.details?.display_phone_number || 'متصل')} — ${String(res.details?.verified_name || 'YUOP')}`,
      });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : 'فشل الاتصال بخادم Meta' });
    } finally {
      setTesting(false);
    }
  };

  const handleRetry = async (id: number) => {
    await retryWhatsAppMessageApi(id);
    await onReload();
  };

  return (
    <div className="space-y-6">
      <div className="border border-[#E2E2DD] bg-white p-6 dark:border-[#2A2A27] dark:bg-[#161614]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E2DD] pb-4 dark:border-[#2A2A27]">
          <div>
            <h2 className="text-base font-bold text-[#111111] dark:text-[#F5F5F2]">إعدادات WhatsApp Cloud API الرسمي (Meta)</h2>
            <p className="mt-0.5 text-xs text-[#5C5C58] dark:text-[#A8A8A0]">
              الربط المباشر مع Meta بدون وسطاء مدفوعين. يتم حفظ التوكن والأسرار في متغيرات البيئة (Environment Variables) فقط.
            </p>
          </div>
          <button
            type="button"
            disabled={testing}
            onClick={handleTest}
            className="inline-flex h-10 items-center gap-2 bg-[#111111] px-4 text-xs font-semibold text-white hover:bg-[#2A2A28] dark:bg-[#F5F5F2] dark:text-[#111111]"
          >
            <Wifi className="h-4 w-4" />
            <span>{testing ? 'جاري اختبار الاتصال...' : 'Test Connection — اختبار الاتصال'}</span>
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 border border-neutral-300 bg-[#F6F6F4] p-3 text-xs dark:border-[#2A2A27] dark:bg-[#0D0D0C]">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>
            أمان الأسرار: لا يتم إرسال <code className="font-mono-tabular">WHATSAPP_ACCESS_TOKEN</code> أو{' '}
            <code className="font-mono-tabular">WHATSAPP_APP_SECRET</code> إلى الواجهة الأمامية إطلاقًا.
          </span>
        </div>

        {testResult && (
          <div
            className={`mt-4 border p-3 text-xs font-semibold ${
              testResult.ok
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
                : 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200'
            }`}
          >
            {testResult.text}
          </div>
        )}

        {config && (
          <div className="mt-5 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
            <div className="border border-[#E2E2DD] p-3 dark:border-[#2A2A27]">
              <span className="text-[#5C5C58] dark:text-[#A8A8A0]">WHATSAPP_PHONE_NUMBER_ID</span>
              <div className="mt-1 font-mono-tabular font-bold">
                {config.phone_number_id_configured ? config.phone_number_id_masked : 'غير مضبوط في Secrets'}
              </div>
            </div>
            <div className="border border-[#E2E2DD] p-3 dark:border-[#2A2A27]">
              <span className="text-[#5C5C58] dark:text-[#A8A8A0]">WHATSAPP_BUSINESS_ACCOUNT_ID</span>
              <div className="mt-1 font-mono-tabular font-bold">
                {config.business_account_id_configured ? config.business_account_id_masked : 'غير مضبوط في Secrets'}
              </div>
            </div>
            <div className="border border-[#E2E2DD] p-3 dark:border-[#2A2A27]">
              <span className="text-[#5C5C58] dark:text-[#A8A8A0]">WHATSAPP_ACCESS_TOKEN</span>
              <div className="mt-1 font-bold">
                {config.access_token_configured ? 'مضبوط بالخادم (محمي)' : 'غير مضبوط في Secrets'}
              </div>
            </div>
            <div className="border border-[#E2E2DD] p-3 dark:border-[#2A2A27]">
              <span className="text-[#5C5C58] dark:text-[#A8A8A0]">WHATSAPP_WEBHOOK_VERIFY_TOKEN</span>
              <div className="mt-1 font-bold">
                {config.webhook_verify_token_configured ? 'مضبوط بالخادم' : 'غير مضبوط في Secrets'}
              </div>
            </div>
            <div className="border border-[#E2E2DD] p-3 dark:border-[#2A2A27]">
              <span className="text-[#5C5C58] dark:text-[#A8A8A0]">WHATSAPP_APP_SECRET (توقيع Webhook)</span>
              <div className="mt-1 font-bold">
                {config.app_secret_configured ? 'مفعل ومؤمن' : 'غير مضبوط في Secrets'}
              </div>
            </div>
            <div className="border border-[#E2E2DD] p-3 dark:border-[#2A2A27]">
              <span className="text-[#5C5C58] dark:text-[#A8A8A0]">بريد الطلبات (HTTP Email API)</span>
              <div className="mt-1 font-bold">
                {config.email_provider_configured ? `${config.email_provider || 'مفعل'} (جاهز)` : 'غير مضبوط (اختياري)'}
              </div>
            </div>
            <div className="border border-[#E2E2DD] p-3 sm:col-span-2 lg:col-span-3 dark:border-[#2A2A27]">
              <span className="text-[#5C5C58] dark:text-[#A8A8A0]">WEBHOOK_URL (للربط في Meta App)</span>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate font-mono-tabular font-bold">{config.webhook_url}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(config.webhook_url);
                    setCopiedUrl(true);
                    setTimeout(() => setCopiedUrl(false), 1500);
                  }}
                  className="shrink-0 border border-[#E2E2DD] p-1 hover:border-[#111111] dark:border-[#2A2A27]"
                  aria-label="نسخ رابط Webhook"
                >
                  {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* سجل الرسائل العام مع إمكانية إعادة المحاولة */}
      <div className="border border-[#E2E2DD] bg-white p-6 dark:border-[#2A2A27] dark:bg-[#161614]">
        <h3 className="text-sm font-bold text-[#111111] dark:text-[#F5F5F2]">سجل رسائل WhatsApp الأخيرة ({messages.length})</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#E2E2DD] text-[#5C5C58] dark:border-[#2A2A27] dark:text-[#A8A8A0]">
                <th className="py-2 text-start">الطلب</th>
                <th className="py-2 text-start">الاتجاه</th>
                <th className="py-2 text-start">الهاتف</th>
                <th className="py-2 text-start">المحتوى</th>
                <th className="py-2 text-start">الحالة</th>
                <th className="py-2 text-start">التاريخ</th>
                <th className="py-2 text-end">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E2DD] dark:divide-[#2A2A27]">
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className="py-2.5 font-mono-tabular font-semibold">{m.order_number || '—'}</td>
                  <td className="py-2.5">{m.direction === 'outbound' ? 'صادر' : 'وارد'}</td>
                  <td className="py-2.5 font-mono-tabular">{m.recipient_phone}</td>
                  <td className="max-w-xs truncate py-2.5 text-[#5C5C58] dark:text-[#A8A8A0]">{m.body}</td>
                  <td className="py-2.5 font-semibold">{m.status}</td>
                  <td className="py-2.5 font-mono-tabular text-[11px] text-[#5C5C58] dark:text-[#A8A8A0]">{formatDateTime(m.created_at)}</td>
                  <td className="py-2.5 text-end">
                    {m.status === 'Failed' && (
                      <button
                        type="button"
                        onClick={() => handleRetry(m.id)}
                        className="inline-flex items-center gap-1 bg-red-700 px-2.5 py-1 text-[11px] font-semibold text-white"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>إعادة إرسال</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function SetupDocsAndCostPanel() {
  return (
    <div className="space-y-6 text-xs leading-relaxed text-[#111111] dark:text-[#F5F5F2]">
      <div className="border border-[#E2E2DD] bg-white p-6 dark:border-[#2A2A27] dark:bg-[#161614]">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          <h2 className="text-base font-bold">دليل الإعداد الشامل، البنية التقنية، وتحليل التكاليف (YUOP)</h2>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="border border-[#E2E2DD] p-4 dark:border-[#2A2A27]">
            <h3 className="text-sm font-bold">1. البنية السحابية المجانية (Cloudflare Edge Stack)</h3>
            <ul className="mt-2 list-inside list-disc space-y-1.5 text-[#5C5C58] dark:text-[#A8A8A0]">
              <li>الواجهة والخادم: <strong>Cloudflare Workers + Static Assets + Hono</strong> (100,000 طلب/يوم مجانًا في الخطة المجانية).</li>
              <li>قاعدة البيانات: <strong>Cloudflare D1 (SQLite الموزعة)</strong> — 5 جيجابايت مجانية مع استعلامات ومعاملات <code className="font-mono-tabular">batch()</code> ذرية، ومطابقة محليًا عبر <code className="font-mono-tabular">node:sqlite</code>.</li>
              <li>تخزين الإيصالات: <strong>Cloudflare R2</strong> (10 جيجابايت مجانية شهريًا بدون رسوم سحب Egress)، مع فحص Magic Bytes ورابط محمي <code className="font-mono-tabular">/api/receipts/:filename</code>.</li>
              <li>النشر التلقائي: عبر <strong>GitHub Actions</strong> وملف <code className="font-mono-tabular">wrangler.jsonc</code> وتشفير الأسرار في <strong>Cloudflare Secrets</strong>.</li>
            </ul>
          </div>

          <div className="border border-[#E2E2DD] p-4 dark:border-[#2A2A27]">
            <h3 className="text-sm font-bold">2. إعداد WhatsApp Cloud API الرسمي واستقبال الإيصالات</h3>
            <ol className="mt-2 list-inside list-decimal space-y-1.5 text-[#5C5C58] dark:text-[#A8A8A0]">
              <li>أنشئ تطبيق Business من بوابة Meta for Developers وأدخل رابط <code className="font-mono-tabular">https://YOUR_WORKER_DOMAIN/api/webhooks/whatsapp</code>.</li>
              <li>احفظ الأسرار عبر <code className="font-mono-tabular">wrangler secret put</code> (<code className="font-mono-tabular">WHATSAPP_ACCESS_TOKEN</code>، <code className="font-mono-tabular">WHATSAPP_APP_SECRET</code>، <code className="font-mono-tabular">WHATSAPP_WEBHOOK_VERIFY_TOKEN</code>).</li>
              <li>التسعير الرسمي من Meta: محادثات الخدمة الواردة خلال نافذة الـ 24 ساعة مجانية، بينما القوالب الصادرة التي يبدؤها المتجر خارج نافذة الـ 24 ساعة تخضع لتسعيرة Meta لكل محادثة/قالب حسب الدولة (بدون اشتراك شهري لوسيط).</li>
              <li>عند إرسال العميل صورة إيصال عبر واتساب، يجلبها Worker عبر <code className="font-mono-tabular">fetch</code> ويدقق البايتات ويحفظها مباشرة في R2.</li>
            </ol>
          </div>

          <div className="border border-[#E2E2DD] p-4 dark:border-[#2A2A27]">
            <h3 className="text-sm font-bold">3. البريد الإلكتروني المتوافق مع Workers (HTTP Email API)</h3>
            <ul className="mt-2 list-inside list-disc space-y-1.5 text-[#5C5C58] dark:text-[#A8A8A0]">
              <li>نظرًا لعدم دعم بروتوكول SMTP التقليدي في بيئة Workers المجانية، تم استبدال <code className="font-mono-tabular">nodemailer</code> بخدمات HTTP API مجانية عبر <code className="font-mono-tabular">fetch()</code>.</li>
              <li>يدعم النظام <strong>Resend</strong> (100 إيميل/يوم مجانًا، حتى 3,000 شهريًا) أو <strong>Brevo</strong> (300 إيميل/يوم مجانًا) عبر ضبط <code className="font-mono-tabular">RESEND_API_KEY</code> أو <code className="font-mono-tabular">BREVO_API_KEY</code> و<code className="font-mono-tabular">EMAIL_FROM</code>.</li>
              <li>يتم تسجيل كل محاولة إرسال في جدول <code className="font-mono-tabular">email_logs</code> دون تعطيل إنشاء الطلب إذا كان البريد اختياريًا.</li>
            </ul>
          </div>

          <div className="border border-[#E2E2DD] p-4 dark:border-[#2A2A27]">
            <h3 className="text-sm font-bold">4. الأمان وتأسيس حساب المدير الأول</h3>
            <ul className="mt-2 list-inside list-disc space-y-1.5 text-[#5C5C58] dark:text-[#A8A8A0]">
              <li>تجزئة كلمات المرور عبر <strong>Web Crypto PBKDF2-SHA256</strong> مع توقيع جلسات HttpOnly بمفتاح <code className="font-mono-tabular">SESSION_SECRET</code>.</li>
              <li>لا توجد أي حسابات أو كلمات مرور افتراضية في الإنتاج؛ عند تشغيل قاعدة بيانات جديدة يظهر نموذج تأسيس المدير الأعلى لمرة واحدة (محمي بـ <code className="font-mono-tabular">ADMIN_SETUP_TOKEN</code> اختياري).</li>
              <li>حماية Rate Limiting في D1 على تسجيل الدخول والتأسيس، وحماية CSRF على مسارات التعديل الإدارية.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

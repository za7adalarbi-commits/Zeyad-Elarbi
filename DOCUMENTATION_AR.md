# توثيق نظام متجر **YUOP Streetwear** ولوحة التحكم المتكاملة (بنية Cloudflare المجانية)

## 1. نظرة عامة على النظام
نظام متكامل لمتجر ملابس ستريت وير (**YUOP**) معاد هندسته ليعمل بالكامل على خدمات سحابية مجانية (**Cloudflare Workers + Static Assets + D1 + R2**) مع الحفاظ على التوافق التام للتشغيل المحلي على Node.js:
- واجهة متجر سريعة وحديثة (ثيم ليلي/صباحي، دعم كامل للجوال، حقيبة تسوق، صفحة تفاصيل المنتج، صفحات هبوط تسويقية، إتمام الطلب، وتتبع الطلب مع رفع إيصالات التحويل).
- لوحة تحكم شاملة للموظفين والمدير (RBAC) مع تخصيص كامل للمتجر، إدارة المنتجات والمخزون، طابور مراجعة المدفوعات، قسم الدفع عند الاستلام (COD)، تحديث حالات الشحن، أكواد الخصم، دليل العملاء CRM، قوالب وإعدادات WhatsApp، سجل العمليات Audit Log، وتأسيس المدير الأول لمرة واحدة.
- ربط مباشر مع **WhatsApp Cloud API الرسمي من Meta** بدون وسطاء مدفوعين.

---

## 2. التقنيات والبنية المستهدفة (Tech Stack)
- **Cloudflare Workers + Hono (`src/worker/index.ts`, `src/worker/app.ts`)**: تشغيل الـ API الخلفي في بيئة Edge خفيفة ومجانية (حتى 100,000 طلب/يوم).
- **Cloudflare Workers Static Assets (`./dist`)**: استضافة الواجهة المبنية عبر Vite + React 19 + Tailwind CSS v4 مع توجيه SPA.
- **Cloudflare D1 (`migrations/`)**: قاعدة بيانات SQLite موزعة (5 GB مجانًا)، مع محول `DbClient` موحد يعمل على D1 في الإنتاج وعلى `node:sqlite` محليًا.
- **Cloudflare R2 (`src/worker/r2Storage.ts`)**: تخزين صور إيصالات الدفع المرفوعة من الموقع أو الواردة عبر WhatsApp Webhook (10 GB/شهر مجانًا بدون رسوم Egress)، مع التحقق الصارم من Magic Bytes (`PNG / JPG / WEBP` حتى 5 MB).
- **Web Crypto API (`src/worker/crypto.ts`)**: تجزئة كلمات المرور بـ `PBKDF2-SHA256`، توقيع الجلسات بـ `SESSION_SECRET`، والتحقق من توقيع Meta Webhook (`HMAC-SHA256`).
- **Workers HTTP Email API (`src/worker/services/emailService.ts`)**: إرسال إيميلات تأكيد الطلبات عبر **Resend** أو **Brevo** باستخدام `fetch()` (متوافق 100% مع Workers بدلًا من SMTP) مع تسجيل المحاولات في جدول `email_logs`.

---

## 3. هيكل قاعدة البيانات (21 جدولًا)
1. `store_settings`: جميع تخصيصات المتجر والمظهر والهيرو ووسائل الدفع.
2. `products`: المنتجات، الأسعار، المقاسات والمخزون (`sizes_stock`).
3. `staff_users` و `staff_sessions`: الموظفون، الأدوار الوظيفية، وجلسات الدخول الموقعة.
4. `auth_rate_limits`: تتبع محاولات تسجيل الدخول والتأسيس الفاشلة لمنع التخمين (Brute Force).
5. `customers`: بيانات العملاء الموحدة برقم الهاتف المطبّع.
6. `orders` و `order_items`: الطلبات، بصمة منع التكرار (`idempotency_hash`)، أكواد الخصم، وتوكن التتبع (`tracking_token`).
7. `payments` و `payment_receipts`: حالة الدفع وسجل جميع محاولات رفع الإيصالات مع مسار R2 وسبب الرفض.
8. `shipping_details`: شركة الشحن، المندوب، رقم التتبع، الرابط، وملاحظات/أسباب تعذر التوصيل.
9. `order_status_history`: التسلسل الزمني الكامل لتغييرات حالة الطلب.
10. `whatsapp_conversations` و `whatsapp_messages`: سجل المحادثات والرسائل وحالاتها (`Sent / Delivered / Read / Failed`).
11. `whatsapp_webhook_events`: سجل منع تكرار معالجة أحداث Webhook (`event_id PRIMARY KEY`).
12. `notification_templates`: قوالب رسائل WhatsApp القابلة للتعديل والتفعيل/التعطيل.
13. `audit_logs`: سجل العمليات الدائم.
14. `landing_pages` و `social_links` و `promo_codes`: صفحات الهبوط التسويقية وروابط التواصل وأكواد الخصم.
15. `email_logs`: سجل إرسال رسائل البريد الإلكتروني عبر Resend / Brevo.

---

## 4. توثيق نقاط النهاية (API Endpoints)

### أ. واجهات المتجر العامة
- `GET /api/health`: فحص حالة الـ Worker والاتصال بقاعدة البيانات.
- `GET /api/store/config`: جلب إعدادات المتجر والمنتجات والروابط وصفحات الهبوط المنشورة.
- `GET /api/store/landing-pages/:slug`: جلب صفحة هبوط منشورة وزيادة عداد المشاهدات.
- `POST /api/store/validate-promo`: التحقق من كود الخصم وحساب قيمة التخفيض.
- `POST /api/store/orders`: إنشاء طلب جديد مع خصم مخزون ذري ومنع الطلبات المكررة.
- `GET /api/store/orders/track?orderNumber=...&phone=...`: تتبع حالة الطلب للعميل.
- `POST /api/store/orders/:orderNumber/receipt`: رفع أو إعادة رفع صورة الإيصال مع التحقق من Magic Bytes وحفظه في R2.
- `GET /api/receipts/:filename`: عرض صورة الإيصال بشكل محمي (يتطلب جلسة موظف مصرح له أو `tracking_token` للطلب).

### ب. Webhook الرسمي لـ WhatsApp Cloud API
- `GET /api/webhooks/whatsapp`: التحقق الأولي من Meta (`hub.challenge` + `WHATSAPP_WEBHOOK_VERIFY_TOKEN`).
- `POST /api/webhooks/whatsapp`: استقبال الرسائل والصور وتحديثات الحالة بعد التحقق من `X-Hub-Signature-256` باستخدام `WHATSAPP_APP_SECRET` وتنزيل صور الإيصالات إلى R2.

### ج. التأسيس الأول ولوحة التحكم المحمية (RBAC)
- `GET /api/admin/auth/setup-status`: معرفة ما إذا كان النظام يحتاج تأسيس المدير الأول (`setupRequired`).
- `POST /api/admin/auth/setup`: إنشاء حساب المدير الأعلى الأول لمرة واحدة فقط (محمي بـ `ADMIN_SETUP_TOKEN` الاختياري وRate Limiting).
- `POST /api/admin/auth/login` و `POST /api/admin/auth/logout` و `GET /api/admin/auth/me`
- `GET /api/admin/dashboard`, `GET /api/admin/orders`, `POST /api/admin/orders/:id/payment/confirm|reject|collect-cod`
- `PATCH /api/admin/orders/:id/status|shipping`, `POST /api/admin/orders/:id/whatsapp/send-tracking`
- `GET/POST/PATCH/DELETE` لـ `products`, `landing-pages`, `social-links`, `promo-codes`
- `GET/PATCH` لـ `store-settings` و `templates`، وإدارة الموظفين `staff`، وسجلات `audit-logs` و `customers`.

---

## 5. الترحيل من SQLite المحلية والنشر على Cloudflare

1. تصدير قاعدة البيانات المحلية (إن وجدت):
   ```bash
   npm run db:export-d1
   ```
   ينتج ملف `migrations/exported_data.sql` مع تقرير مطابقة أعداد الصفوف وأوامر رفع الإيصالات إلى R2.
2. إنشاء الموارد على Cloudflare وتطبيق الهجرة:
   ```bash
   npx wrangler d1 create yuop-db
   npx wrangler r2 bucket create yuop-receipts
   npm run db:migrate:remote
   ```
3. ضبط الأسرار عبر `npx wrangler secret put <SECRET_NAME>`:
   `SESSION_SECRET`, `ADMIN_SETUP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `RESEND_API_KEY` (أو `BREVO_API_KEY`), `EMAIL_FROM`.
4. تشغيل الاختبارات والبناء والنشر:
   ```bash
   npm test
   npm run lint
   npm run worker:deploy
   ```
   كما يتوفر نشر تلقائي عند الدفع لفرع `main` عبر `.github/workflows/deploy.yml`.

---

## 6. تحليل التكاليف والحدود المجانية
- **Cloudflare Workers + Static Assets**: مجاني حتى 100,000 طلب/يوم.
- **Cloudflare D1**: مجاني حتى 5 GB تخزين، 5 مليون قراءة/يوم، 100,000 كتابة/يوم.
- **Cloudflare R2**: مجاني حتى 10 GB تخزين/شهر وبدون رسوم سحب (Egress = 0$).
- **البريد الإلكتروني (Resend / Brevo HTTP API)**: Resend مجاني حتى 100 رسالة/يوم (3,000/شهر)، وBrevo مجاني حتى 300 رسالة/يوم.
- **WhatsApp Cloud API**: بدون اشتراك شهري لوسيط؛ محادثات الخدمة الواردة خلال نافذة الـ 24 ساعة مجانية، بينما القوالب الصادرة خارج الـ 24 ساعة تخضع لتسعيرة Meta الرسمية لكل محادثة/رسالة حسب الدولة.

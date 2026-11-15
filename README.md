# YUOP Streetwear — Full-Stack E-Commerce on Free Cloudflare Infrastructure

متجر **YUOP Streetwear** ونظام إدارة الطلبات والمدفوعات ولوحة التحكم الكاملة، معاد هندسته ليعمل بالكامل على البنية السحابية المجانية من **Cloudflare** (Workers + Static Assets + D1 + R2) مع الاحتفاظ بالتشغيل المحلي السريع على المنفذ `3000`.

---

## البنية المعمارية (Free-Tier Stack)

- **Frontend Hosting**: Vite + React 19 + Tailwind CSS v4 مستضاف مجانًا على **Cloudflare Workers Static Assets** (`./dist`) مع دعم SPA routing.
- **Backend API**: **Hono** (`src/worker/app.ts`) يعمل داخل **Cloudflare Workers** (`src/worker/index.ts`) — خطة مجانية حتى `100,000` طلب/يوم.
- **Database**: **Cloudflare D1** (SQLite الموزعة) — خطة مجانية `5 GB` تخزين و`5 مليون` قراءة/يوم.
- **Receipt Storage**: **Cloudflare R2** — خطة مجانية `10 GB/شهر` مع **0 رسوم Egress** وحماية Magic Bytes (`PNG / JPG / WEBP`) ووصول مصادق عبر `/api/receipts/:filename`.
- **Email Service**: **Workers HTTP Email API** (`fetch`) يدعم **Resend** (`100` إيميل/يوم مجانًا) أو **Brevo** (`300` إيميل/يوم مجانًا) كبديل لـ `nodemailer` SMTP غير المدعوم في Workers.
- **WhatsApp Cloud API**: ربط مباشر مع **Meta Graph API** + Webhook موقّع بـ `X-Hub-Signature-256` + تنزيل إيصالات العملاء إلى **R2** تلقائيًا.
  - *ملاحظة التكلفة*: استضافة التطبيق وقاعدة البيانات وتخزين الصور والبريد على Cloudflare/Resend مجانية ضمن حدود الخطة المجانية؛ بينما **Meta WhatsApp Cloud API** يقدم محادثات الخدمة الواردة خلال نافذة الـ 24 ساعة مجانًا، ويحاسب على القوالب الصادرة التي يبدأها المتجر خارج الـ 24 ساعة حسب تسعيرة Meta الرسمية لكل دولة.

---

## التشغيل المحلي (Local Development — Port 3000)

```bash
npm install
npm test
npm run dev
```

يعمل الخادم محليًا على `http://localhost:3000` مستخدمًا نفس نواة Hono API (`src/worker/app.ts`) فوق `node:sqlite` ونظام الملفات المحلي للإيصالات.

عند فتح `/admin` لأول مرة على قاعدة بيانات جديدة، ستظهر شاشة **تأسيس حساب المدير الأعلى الأول (First-Time Super Admin Setup)** لإنشاء حساب الإدارة بكلمة مرور قوية دون وجود أي كلمات مرور افتراضية مكشوفة.

---

## خطوات النشر المجاني على Cloudflare + GitHub

### 1. إنشاء قاعدة بيانات D1 وحاوية R2
```bash
npx wrangler login
npx wrangler d1 create yuop-db
npx wrangler r2 bucket create yuop-receipts
```
انسخ `database_id` الناتج وضعه داخل `wrangler.jsonc` بدلًا من `YOUR_D1_DATABASE_ID`.

### 2. تطبيق جداول D1 والبيانات الافتراضية
```bash
npx wrangler d1 migrations apply yuop-db --remote
```
أو إذا أردت نقل بيانات من قاعدة SQLite محلية قائمة:
```bash
npm run db:export-d1
npx wrangler d1 execute yuop-db --remote --file=./migrations/0001_initial_schema.sql
npx wrangler d1 execute yuop-db --remote --file=./migrations/exported_data.sql
```

### 3. ضبط الأسرار في Cloudflare Secrets (بدون تخزينها في الكود)
```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ADMIN_SETUP_TOKEN          # اختياري: رمز حماية صفحة التأسيس الأولى
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put WHATSAPP_BUSINESS_ACCOUNT_ID
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_WEBHOOK_VERIFY_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET
npx wrangler secret put RESEND_API_KEY             # أو BREVO_API_KEY
npx wrangler secret put EMAIL_FROM
```

### 4. النشر اليدوي أو التلقائي عبر GitHub Actions
- **يدويًا**:
  ```bash
  npm run worker:deploy
  ```
- **تلقائيًا عبر GitHub**: أضف `CLOUDFLARE_API_TOKEN` و`CLOUDFLARE_ACCOUNT_ID` في **GitHub Repository Secrets**، وبمجرد الرفع إلى فرع `main` سيعمل ملف `.github/workflows/deploy.yml` لتشغيل الاختبارات والبناء وتطبيق migrations والنشر تلقائيًا.

---

## ملاحظات الأمان والاعتمادية
- تجزئة كلمات المرور عبر **Web Crypto `PBKDF2-SHA256`** (`100,000` iteration) مع ترقية تلقائية لأي كلمات مرور `scrypt` قديمة عند تسجيل الدخول.
- جلسات لوحة التحكم محمية بـ **HttpOnly Cookies** وتوقيع `HMAC-SHA256` عبر `SESSION_SECRET` + حماية **CSRF** (`Origin` / `Referer`) + **Rate Limiting** في D1.
- تحديث المخزون يستخدم شرط التفاؤل الذري (`UPDATE products SET sizes_stock = ? WHERE id = ? AND sizes_stock = ?`) لمنع البيع على المكشوف في D1.

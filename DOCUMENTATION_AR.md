# توثيق نظام متجر **YUOP Streetwear** ولوحة التحكم المتكاملة

## 1. نظرة عامة على النظام
نظام متكامل لمتجر ملابس ستريت وير (**YUOP**) يجمع بين:
- واجهة متجر سريعة وحديثة مع حقيبة تسوق، صفحة تفاصيل المنتج، إتمام الطلب، وصفحة تتبع الطلب ورفع إيصالات التحويل.
- لوحة تحكم شاملة للموظفين والمدير مع تخصيص كامل لمظهر المتجر، إدارة المنتجات والمخزون، طابور مراجعة المدفوعات، قسم الدفع عند الاستلام، تحديث حالات الشحن والتوصيل، سجل العمليات (Audit Log)، وإدارة الصلاحيات (RBAC).
- ربط مباشر مع **WhatsApp Cloud API الرسمي من Meta** بدون وسطاء مدفوعين.

---

## 2. المكتبات المستخدمة (Tech Stack)
- **Express 4 (`express`)**: خادم الـ API الخلفي واستقبال أحداث WhatsApp Webhook.
- **Node.js `node:sqlite` (`DatabaseSync`)**: قاعدة بيانات SQLite مدمجة في Node.js v22 بتكلفة تشغيل 0$ ودعم كامل للمعاملات الذرية (ACID).
- **Node.js `node:crypto`**: تشفير كلمات المرور (`scryptSync`)، توليد التوكنات، والتحقق من توقيع Meta Webhook (`HMAC-SHA256`).
- **Nodemailer (`nodemailer`)**: إرسال إشعارات البريد الإلكتروني عبر Gmail SMTP مجانًا ضمن حدود Gmail.
- **React 19 + TypeScript + Tailwind CSS v4 + Lucide Icons**: واجهات المتجر ولوحة التحكم.

---

## 3. هيكل قاعدة البيانات (15 جدول)
1. `store_settings`: جميع تخصيصات المتجر (الاسم، الإعلانات، الهيرو، الشحن، أرقام فودافون كاش وإنستا باي).
2. `products`: المنتجات، الأسعار، المقاسات والمخزون (`sizes_stock`).
3. `staff_users` و `staff_sessions`: الموظفون، الأدوار الوظيفية، وجلسات الدخول المحمية.
4. `customers`: بيانات العملاء الموحدة برقم الهاتف المطبّع.
5. `orders` و `order_items`: الطلبات، بصمة منع التكرار (`idempotency_hash`)، وتوكن التتبع (`tracking_token`).
6. `payments` و `payment_receipts`: حالة الدفع وسجل جميع محاولات رفع الإيصالات مع سبب الرفض والموظف.
7. `shipping_details`: شركة الشحن، المندوب، رقم التتبع، الرابط، وملاحظات/أسباب تعذر التوصيل.
8. `order_status_history`: التسلسل الزمني الكامل لتغييرات حالة الطلب.
9. `whatsapp_conversations` و `whatsapp_messages`: سجل المحادثات والرسائل الصادرة والواردة وحالاتها (`Sent / Delivered / Read / Failed`) وعدد محاولات الإعادة.
10. `whatsapp_webhook_events`: سجل منع تكرار معالجة نفس حدث الـ Webhook (`event_id UNIQUE`).
11. `notification_templates`: قوالب رسائل WhatsApp القابلة للتعديل والتفعيل/التعطيل.
12. `audit_logs`: سجل العمليات الدائم.

---

## 4. توثيق نقاط النهاية (API Endpoints)

### أ. واجهات المتجر العامة
- `GET /api/store/config`: جلب إعدادات المتجر والمنتجات النشطة.
- `POST /api/store/orders`: إنشاء طلب جديد مع التحقق من المخزون ومنع الطلبات المكررة.
- `GET /api/store/orders/track?orderNumber=...&phone=...`: تتبع حالة الطلب للعميل.
- `POST /api/store/orders/:orderNumber/receipt`: رفع أو إعادة رفع صورة الإيصال مع التحقق من البصمة السحرية للصورة (`PNG/JPG/WEBP`).
- `GET /api/receipts/:filename`: عرض صورة الإيصال بشكل محمي (يتطلب جلسة موظف أو `tracking_token` الخاص بالطلب).

### ب. Webhook الرسمي لـ WhatsApp Cloud API
- `GET /api/webhooks/whatsapp`: التحقق الأولي من Meta (`hub.challenge` + `WHATSAPP_WEBHOOK_VERIFY_TOKEN`).
- `POST /api/webhooks/whatsapp`: استقبال الرسائل والصور وتحديثات الحالة بعد التحقق من `X-Hub-Signature-256` باستخدام `WHATSAPP_APP_SECRET` ومنع المعالجة المكررة.

### ج. واجهات لوحة التحكم المحمية (RBAC)
- `POST /api/admin/auth/login` و `POST /api/admin/auth/logout` و `GET /api/admin/auth/me`
- `GET /api/admin/dashboard`: الإحصائيات الـ 12 + آخر العمليات.
- `GET /api/admin/orders` و `GET /api/admin/orders/:id`
- `POST /api/admin/orders/:id/payment/confirm` و `POST /api/admin/orders/:id/payment/reject`
- `POST /api/admin/orders/:id/payment/collect-cod`
- `PATCH /api/admin/orders/:id/status` و `PATCH /api/admin/orders/:id/shipping`
- `POST /api/admin/orders/:id/whatsapp/send-tracking` و `POST /api/admin/whatsapp/messages/:messageId/retry`
- `GET/POST/PATCH/DELETE /api/admin/products` و `GET/PATCH /api/admin/store-settings`
- `GET/PATCH /api/admin/templates`
- `GET /api/admin/whatsapp/config` و `POST /api/admin/whatsapp/test`
- `GET /api/admin/audit-logs` و `GET/POST/PATCH /api/admin/staff`

---

## 5. إعداد WhatsApp Cloud API والـ Webhook وتخزين الإيصالات
1. أنشئ تطبيق Business في [Meta for Developers](https://developers.facebook.com) وأضف منتج WhatsApp.
2. أنشئ **System User** في Business Settings للحصول على **Permanent Access Token**.
3. ضع المتغيرات في البيئة (`.env`):
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
   - `WHATSAPP_APP_SECRET`
4. فعّل Webhook في Meta App على المسار `https://YOUR_DOMAIN/api/webhooks/whatsapp` واشترك في `messages`.
5. تخزين الإيصالات: يتم تنزيل أي صورة واردة عبر WhatsApp وحفظها محليًا في `UPLOADS_DIR` (`./uploads/receipts`) حتى لا تعتمد على روابط Meta المؤقتة. في بيئة الإنتاج يمكن ربط `UPLOADS_DIR` و `DATABASE_PATH` بقرص دائم (Persistent Disk / Volume).

---

## 6. تقليل التكاليف والرسوم المحتملة
- **قاعدة البيانات**: مجانية تمامًا (SQLite مدمجة).
- **تخزين الإيصالات**: مجاني محليًا على القرص الدائم (أو Cloudflare R2 مجاني حتى 10GB/شهر عند التوسع).
- **البريد الإلكتروني**: Gmail SMTP مجاني (حتى 500 رسالة/يوم).
- **SMS**: غير مستخدم لتفادي التكاليف الشهرية.
- **WhatsApp Cloud API**: بدون اشتراك شهري لوسيط؛ المحادثات التي يبدأها العميل مجانية (ضمن شروط Meta)، وتُحاسب Meta فقط على الرسائل التي يبدأها المتجر خارج نافذة الـ 24 ساعة حسب تسعيرة الدولة.

---

## 7. الاختبار والنشر
- تشغيل الاختبارات التلقائية لجميع السيناريوهات الـ 6:
  ```bash
  npm test
  ```
- بناء المشروع للإنتاج:
  ```bash
  npm run build
  NODE_ENV=production npm start
  ```

/**
 * ============================================================================
 * اختبارات شاملة لطبقة Cloudflare Workers + Hono + Web Crypto + R2 + Email API
 * تُشغّل عبر node:test دون الحاجة لـ Cloudflare خارجي عبر محولات الذاكرة.
 * ============================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase, hashPassword } from '../server/db.ts';
import { createNodeSqliteDbClient } from '../server/nodeAdapters.ts';
import { createWorkerApp } from './app.ts';
import { hmacSha256Hex } from './crypto.ts';
import { inferContentTypeFromFileName, type ReceiptStorage } from './r2Storage.ts';
import { sendOrderEmailNotification } from './services/emailService.ts';
import type { WorkerBindings } from './types.ts';

const VALID_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function createMemoryR2Storage(): ReceiptStorage & { files: Map<string, { bytes: Uint8Array; contentType: string }> } {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    files,
    async put(key, bytes, contentType) {
      files.set(key, { bytes, contentType });
    },
    async get(key) {
      return files.get(key) || null;
    },
    async delete(key) {
      files.delete(key);
    },
  };
}

function createWorkerTestHarness(overrides: Partial<WorkerBindings> = {}, customFetch?: typeof fetch) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuop-worker-test-'));
  const sqliteDb = createDatabase(':memory:', tmpDir);
  const dbClient = createNodeSqliteDbClient(sqliteDb);
  const storage = createMemoryR2Storage();

  const app = createWorkerApp({
    createDb: () => dbClient,
    createStorage: () => storage,
    legacyPasswordVerifier: async (pw, stored) => {
      const { verifyPassword } = await import('../server/db.ts');
      return verifyPassword(pw, stored);
    },
    customFetch,
  });

  const env: WorkerBindings = {
    DB: undefined as unknown as WorkerBindings['DB'],
    RECEIPTS_BUCKET: undefined as unknown as WorkerBindings['RECEIPTS_BUCKET'],
    ASSETS: undefined as unknown as WorkerBindings['ASSETS'],
    APP_URL: 'https://yuop.workers.dev',
    ENVIRONMENT: 'production',
    SESSION_SECRET: 'test-session-secret-64-chars-long-1234567890abcdef',
    ADMIN_SETUP_TOKEN: '',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321',
    WHATSAPP_ACCESS_TOKEN: 'wa_test_token',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify_me_yuop',
    WHATSAPP_APP_SECRET: 'meta_app_secret_test',
    WHATSAPP_API_VERSION: 'v21.0',
    RESEND_API_KEY: '',
    BREVO_API_KEY: '',
    EMAIL_FROM: 'orders@yuop.store',
    EMAIL_FROM_NAME: 'YUOP Streetwear',
    ...overrides,
  };

  const req = (pathname: string, init: RequestInit = {}) =>
    app.fetch(new Request(`https://yuop.workers.dev${pathname}`, init), env);

  return {
    sqliteDb,
    dbClient,
    storage,
    env,
    req,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

test('تأسيس حساب المدير الأول لمرة واحدة + Rate Limiting + CSRF + الصلاحيات', async () => {
  const { req, cleanup } = createWorkerTestHarness({ ADMIN_SETUP_TOKEN: 'boot-secret-99' });
  try {
    // 1. الحالة المبدئية: التأسيس مطلوب ويطلب ADMIN_SETUP_TOKEN
    const statusRes1 = await req('/api/admin/auth/setup-status');
    assert.equal(statusRes1.status, 200);
    const status1 = (await statusRes1.json()) as { setupRequired: boolean; tokenRequired: boolean };
    assert.equal(status1.setupRequired, true);
    assert.equal(status1.tokenRequired, true);

    // 2. رمز التأسيس الخاطئ يُرفض
    const badSetup = await req('/api/admin/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'مدير المتجر',
        email: 'owner@yuop.store',
        password: 'StrongPassword2026!',
        setup_token: 'wrong-token',
      }),
    });
    assert.equal(badSetup.status, 403);

    // 3. تأسيس صحيح يُنشئ Super Admin ويصدر توكن موقع + كوكي HttpOnly
    const okSetup = await req('/api/admin/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'مدير المتجر',
        email: 'owner@yuop.store',
        password: 'StrongPassword2026!',
        setup_token: 'boot-secret-99',
      }),
    });
    assert.equal(okSetup.status, 201);
    const setupBody = (await okSetup.json()) as { token: string; user: { role: string; email: string } };
    assert.ok(setupBody.token.includes('.'));
    assert.equal(setupBody.user.role, 'Super Admin');
    const setCookie = okSetup.headers.get('set-cookie') || '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /yuop_staff_session=/);

    // 4. محاولة التأسيس مرة ثانية تُرفض نهائيًا بـ 403
    const secondSetup = await req('/api/admin/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'مهاجم',
        email: 'attacker@yuop.store',
        password: 'StrongPassword2026!',
        setup_token: 'boot-secret-99',
      }),
    });
    assert.equal(secondSetup.status, 403);

    // 5. حماية CSRF: طلب تعديل عبر Cookie من Origin خارجي يُرفض بـ 403
    const cookiePair = setCookie.split(';')[0];
    const csrfBlocked = await req('/api/admin/store-settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookiePair,
        Origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ store_name: 'HACKED' }),
    });
    assert.equal(csrfBlocked.status, 403);

    // 6. Rate Limiting: 5 محاولات دخول فاشلة ثم 429
    for (let i = 0; i < 5; i++) {
      const failLogin = await req('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.55' },
        body: JSON.stringify({ email: 'owner@yuop.store', password: 'WrongPassword' }),
      });
      assert.equal(failLogin.status, 401);
    }
    const rateLimited = await req('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.55' },
      body: JSON.stringify({ email: 'owner@yuop.store', password: 'StrongPassword2026!' }),
    });
    assert.equal(rateLimited.status, 429);
  } finally {
    cleanup();
  }
});

test('ترقية تجزئة scrypt القديمة تلقائيًا إلى PBKDF2-SHA256 عند تسجيل الدخول', async () => {
  const { sqliteDb, req, cleanup } = createWorkerTestHarness();
  try {
    const legacyHash = hashPassword('LegacyPass2026');
    assert.ok(!legacyHash.startsWith('pbkdf2_sha256$'));
    sqliteDb
      .prepare(
        `INSERT INTO staff_users (name, email, password_hash, role, custom_permissions, is_active, created_at)
         VALUES ('موظف قديم', 'legacy@yuop.store', ?, 'Payment Reviewer', NULL, 1, ?)`
      )
      .run(legacyHash, new Date().toISOString());

    const loginRes = await req('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'legacy@yuop.store', password: 'LegacyPass2026' }),
    });
    assert.equal(loginRes.status, 200);

    const row = sqliteDb
      .prepare('SELECT password_hash FROM staff_users WHERE email = ?')
      .get('legacy@yuop.store') as { password_hash: string };
    assert.ok(row.password_hash.startsWith('pbkdf2_sha256$'));
  } finally {
    cleanup();
  }
});

test('تدفق الطلب ورفع الإيصال في R2 وحماية /api/receipts/:filename ومكافحة ملفات HTML المزيفة', async () => {
  const { storage, req, cleanup } = createWorkerTestHarness();
  try {
    // تأسيس مدير للاستعلامات الإدارية لاحقًا
    const setupRes = await req('/api/admin/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'مدير',
        email: 'admin@yuop.store',
        password: 'AdminPassword2026!',
      }),
    });
    const { token: adminToken } = (await setupRes.json()) as { token: string };

    // إنشاء طلب فودافون كاش
    const orderRes = await req('/api/store/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'زياد طارق',
        customer_phone: '01033445566',
        governorate: 'القاهرة',
        delivery_address: 'مدينة نصر',
        payment_method: 'Vodafone Cash',
        items: [{ product_id: 1, size: 'L', quantity: 1 }],
      }),
    });
    assert.equal(orderRes.status, 201);
    const { order } = (await orderRes.json()) as { order: { order_number: string; tracking_token: string } };

    // رفض رفع HTML مزيف بصيغة data:image/png
    const fakeHtmlBase64 = `data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`;
    const badReceiptRes = await req(`/api/store/orders/${order.order_number}/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tracking_token: order.tracking_token,
        image_base64: fakeHtmlBase64,
      }),
    });
    assert.equal(badReceiptRes.status, 400);

    // رفع PNG حقيقي يُخزن في R2
    const goodReceiptRes = await req(`/api/store/orders/${order.order_number}/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tracking_token: order.tracking_token,
        image_base64: VALID_PNG_BASE64,
      }),
    });
    assert.equal(goodReceiptRes.status, 200);
    const receiptBody = (await goodReceiptRes.json()) as { receipt: { file_path: string } };
    assert.ok(storage.files.has(receiptBody.receipt.file_path));

    const fileName = receiptBody.receipt.file_path.split('/').pop()!;

    // الوصول بدون تصريح مرفوض
    const unauthImg = await req(`/api/receipts/${fileName}`);
    assert.equal(unauthImg.status, 401);

    // الوصول بتوكن التتبع الخاص بالطلب مسموح
    const tokenImg = await req(`/api/receipts/${fileName}?token=${order.tracking_token}`);
    assert.equal(tokenImg.status, 200);
    assert.equal(tokenImg.headers.get('content-type'), inferContentTypeFromFileName(fileName));
    assert.equal(tokenImg.headers.get('x-content-type-options'), 'nosniff');

    // الوصول بتوكن موظف مسموح
    const staffImg = await req(`/api/receipts/${fileName}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(staffImg.status, 200);
  } finally {
    cleanup();
  }
});

test('Meta WhatsApp Webhook: التحقق من التحدي وتوقيع HMAC-SHA256 وتنزيل الإيصال إلى R2', async () => {
  const pngRaw = Buffer.from(VALID_PNG_BASE64.split(',')[1], 'base64');
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/media_123')) {
      return new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/wa-media-file', mime_type: 'image/png' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('lookaside.fbsbx.com')) {
      return new Response(pngRaw, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.outbound.1' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { storage, env, req, cleanup } = createWorkerTestHarness({}, mockFetch);
  try {
    // 1. التحقق من GET hub.challenge
    const verifyOk = await req(
      '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify_me_yuop&hub.challenge=CHALLENGE_991'
    );
    assert.equal(verifyOk.status, 200);
    assert.equal(await verifyOk.text(), 'CHALLENGE_991');

    const verifyFail = await req(
      '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=NO'
    );
    assert.equal(verifyFail.status, 403);

    // 2. إنشاء طلب عميل قبل وصول صورة واتساب
    await req('/api/store/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'ليلى حسن',
        customer_phone: '01066778899',
        governorate: 'الجيزة',
        delivery_address: 'المهندسين',
        payment_method: 'Vodafone Cash',
        items: [{ product_id: 1, size: 'M', quantity: 1 }],
      }),
    });

    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.inbound.test.55',
                    from: '201066778899',
                    type: 'image',
                    image: { id: 'media_123' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    // 3. توقيع خاطئ يُرفض بـ 401
    const badSig = await req('/api/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
      body: payload,
    });
    assert.equal(badSig.status, 401);

    // 4. توقيع HMAC-SHA256 صحيح يحمّل الصورة ويخزنها في R2
    const sig = await hmacSha256Hex(env.WHATSAPP_APP_SECRET!, payload);
    const goodWebhook = await req('/api/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': `sha256=${sig}` },
      body: payload,
    });
    assert.equal(goodWebhook.status, 200);
    const whData = (await goodWebhook.json()) as { processed: number };
    assert.equal(whData.processed, 1);
    assert.equal(storage.files.size, 1);
  } finally {
    cleanup();
  }
});

test('خدمة البريد الإلكتروني المتوافقة مع Workers (Resend / Brevo / التخطي الآمن بدون تعطيل الطلب)', async () => {
  const { dbClient, sqliteDb, cleanup } = createWorkerTestHarness();
  try {
    // 1. بدون مفاتيح بريد: تُسجل Skipped وتُرجع sent: false دون رمي استثناء
    const skipped = await sendOrderEmailNotification({
      db: dbClient,
      env: {},
      orderId: null,
      to: 'buyer@example.com',
      subject: 'تأكيد طلب YUOP-9001',
      text: 'تفاصيل الطلب',
    });
    assert.equal(skipped.sent, false);
    assert.equal(skipped.provider, 'none');

    // 2. مع RESEND_API_KEY: تستدعي Resend API وتسجل في email_logs
    let calledUrl = '';
    const resendFetch: typeof fetch = async (input) => {
      calledUrl = String(input);
      return new Response(JSON.stringify({ id: 're_msg_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const resendRes = await sendOrderEmailNotification({
      db: dbClient,
      env: { RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'orders@yuop.store', EMAIL_FROM_NAME: 'YUOP' },
      orderId: null,
      to: 'buyer@example.com',
      subject: 'تأكيد طلب YUOP-9002',
      text: 'تفاصيل الطلب',
      customFetch: resendFetch,
    });
    assert.equal(resendRes.sent, true);
    assert.equal(resendRes.provider, 'resend');
    assert.match(calledUrl, /api\.resend\.com\/emails/);

    const logs = sqliteDb.prepare('SELECT provider, status FROM email_logs ORDER BY id ASC').all() as Array<{
      provider: string;
      status: string;
    }>;
    assert.equal(logs.length, 2);
    assert.equal(logs[0].status, 'Skipped');
    assert.equal(logs[1].provider, 'resend');
    assert.equal(logs[1].status, 'Sent');
  } finally {
    cleanup();
  }
});

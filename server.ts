/**
 * ============================================================================
 * YUOP Streetwear — خادم التطوير والتشغيل المحلي (Node.js + Vite + Hono)
 * يشغّل نفس نواة Hono API المصممة لـ Cloudflare Workers على المنفذ 3000
 * باستخدام node:sqlite ونظام الملفات المحلي للإيصالات، مع Vite Middleware في التطوير.
 * ============================================================================
 */
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createDatabase, verifyPassword } from './src/server/db.ts';
import { createFsReceiptStorage, createNodeSqliteDbClient } from './src/server/nodeAdapters.ts';
import { createWorkerApp } from './src/worker/app.ts';
import type { WorkerBindings } from './src/worker/types.ts';

const PORT = Number(process.env.PORT || 3000);
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || './uploads/receipts');
const DB_PATH = process.env.DATABASE_PATH || './data/yuop.db';

const db = createDatabase(DB_PATH, UPLOADS_DIR);
const dbClient = createNodeSqliteDbClient(db);
const receiptStorage = createFsReceiptStorage(UPLOADS_DIR);

const workerApi = createWorkerApp({
  createDb: () => dbClient,
  createStorage: () => receiptStorage,
  legacyPasswordVerifier: async (password, storedHash) => verifyPassword(password, storedHash),
});

function getLocalWorkerEnv(req: express.Request): WorkerBindings {
  const host = req.get('host') || `localhost:${PORT}`;
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const inferredUrl = `${proto}://${host}`;

  return {
    DB: undefined as unknown as WorkerBindings['DB'],
    RECEIPTS_BUCKET: undefined as unknown as WorkerBindings['RECEIPTS_BUCKET'],
    ASSETS: undefined as unknown as WorkerBindings['ASSETS'],
    APP_URL: process.env.APP_URL || inferredUrl,
    ENVIRONMENT: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    SESSION_SECRET: process.env.SESSION_SECRET || 'yuop-local-dev-secret-change-in-cloudflare',
    ADMIN_SETUP_TOKEN: process.env.ADMIN_SETUP_TOKEN || '',
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    WHATSAPP_BUSINESS_ACCOUNT_ID: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
    WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET || '',
    WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION || 'v21.0',
    RESEND_API_KEY: process.env.RESEND_API_KEY || '',
    BREVO_API_KEY: process.env.BREVO_API_KEY || '',
    EMAIL_FROM: process.env.EMAIL_FROM || '',
    EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME || 'YUOP Streetwear',
  };
}

const app = express();

// تمرير جميع طلبات /api/* بالبايتات الخام إلى Hono لضمان دقة توقيع Webhook ورفع الإيصالات
app.use('/api', express.raw({ type: '*/*', limit: '10mb' }), async (req, res, next) => {
  try {
    const host = req.get('host') || `localhost:${PORT}`;
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const fullUrl = `${proto}://${host}${req.originalUrl}`;

    const headers = new Headers();
    for (const [key, val] of Object.entries(req.headers)) {
      if (val === undefined) continue;
      if (Array.isArray(val)) {
        for (const item of val) headers.append(key, item);
      } else {
        headers.set(key, val);
      }
    }

    const method = req.method.toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const bodyBytes =
      hasBody && Buffer.isBuffer(req.body) && req.body.length > 0
        ? new Uint8Array(req.body.buffer, req.body.byteOffset, req.body.byteLength)
        : undefined;

    const webRequest = new Request(fullUrl, {
      method,
      headers,
      body: bodyBytes as unknown as BodyInit | undefined,
    });

    const webResponse = await workerApi.fetch(webRequest, getLocalWorkerEnv(req));

    res.status(webResponse.status);

    // الحفاظ على تعدد رؤوس Set-Cookie عند وجودها
    const setCookies =
      typeof (webResponse.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (webResponse.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : [];
    if (setCookies.length > 0) {
      res.setHeader('Set-Cookie', setCookies);
    }

    webResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return;
      res.setHeader(key, value);
    });

    const buf = Buffer.from(await webResponse.arrayBuffer());
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('./dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`YUOP Store & Admin Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start YUOP server:', err);
  process.exit(1);
});

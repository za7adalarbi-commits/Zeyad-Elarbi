/**
 * ============================================================================
 * YUOP Streetwear — طبقة التشفير القياسية (Web Crypto API)
 * تعمل داخل Cloudflare Workers و Node.js >= 20 بدون أي اعتماد على مكتبات Node الأصلية.
 * ============================================================================
 */

const textEncoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomHex(byteLength = 16): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export function constantTimeEqualStrings(a: string, b: string): boolean {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

export function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

const DEFAULT_PBKDF2_ITERATIONS = 100_000;

/**
 * تجزئة كلمة المرور باستخدام PBKDF2-SHA256 عبر Web Crypto API
 * الصيغة: pbkdf2_sha256$<iterations>$<saltHex>$<derivedHex>
 */
export async function hashPasswordWeb(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: DEFAULT_PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  return `pbkdf2_sha256$${DEFAULT_PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(derivedBits))}`;
}

export type LegacyPasswordVerifier = (password: string, storedHash: string) => Promise<boolean> | boolean;

/**
 * التحقق من كلمة المرور بصيغة PBKDF2-SHA256 مع دعم التحقق من الصيغ القديمة عند التمرير في Node
 */
export async function verifyPasswordWeb(
  password: string,
  storedHash: string,
  legacyVerifier?: LegacyPasswordVerifier
): Promise<boolean> {
  if (!storedHash) return false;

  if (storedHash.startsWith('pbkdf2_sha256$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 4) return false;
    const iterations = Number(parts[1]);
    const salt = hexToBytes(parts[2]);
    const expected = hexToBytes(parts[3]);
    if (!Number.isFinite(iterations) || iterations < 10_000 || !salt || !expected) {
      return false;
    }

    const baseKey = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt as Uint8Array<ArrayBuffer>,
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      expected.length * 8
    );
    return constantTimeEqualBytes(new Uint8Array(derivedBits), expected);
  }

  // التوافق العكسي مع تجزئة scrypt القديمة أثناء الترحيل في Node.js فقط
  if (legacyVerifier && storedHash.includes(':')) {
    return await legacyVerifier(password, storedHash);
  }
  return false;
}

/**
 * توقيع HMAC-SHA256 بصيغة hex عبر Web Crypto API
 */
export async function hmacSha256Hex(secret: string, payload: string | Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data = typeof payload === 'string' ? textEncoder.encode(payload) : payload;
  const sig = await crypto.subtle.sign('HMAC', key, data as Uint8Array<ArrayBuffer>);
  return bytesToHex(new Uint8Array(sig));
}

/**
 * التحقق من توقيع Meta Webhook (X-Hub-Signature-256) باستخدام crypto.subtle
 */
export async function verifyMetaWebhookSignatureAsync(
  rawBody: string | Uint8Array,
  signatureHeader: string | undefined,
  appSecret: string
): Promise<boolean> {
  if (!appSecret || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const providedSig = signatureHeader.slice('sha256='.length).trim().toLowerCase();
  const expectedSig = await hmacSha256Hex(appSecret, rawBody);
  return constantTimeEqualStrings(providedSig, expectedSig);
}

/**
 * توقيع رمز الجلسة بمفتاح SESSION_SECRET لضمان عدم تزوير التوكن
 */
export async function signSessionToken(rawToken: string, sessionSecret?: string): Promise<string> {
  if (!sessionSecret) return rawToken;
  const mac = await hmacSha256Hex(sessionSecret, rawToken);
  return `${rawToken}.${mac.slice(0, 32)}`;
}

export async function extractVerifiedSessionToken(
  presentedToken: string,
  sessionSecret?: string
): Promise<string | null> {
  if (!presentedToken) return null;
  if (!sessionSecret) return presentedToken;
  const dotIdx = presentedToken.lastIndexOf('.');
  if (dotIdx <= 0) {
    // في حالة الجلسات القديمة غير الموقعة قبل ضبط SESSION_SECRET: نتحقق في DB إذا لم يكن منتهيًا
    return presentedToken;
  }
  const rawToken = presentedToken.slice(0, dotIdx);
  const sig = presentedToken.slice(dotIdx + 1);
  const expected = (await hmacSha256Hex(sessionSecret, rawToken)).slice(0, 32);
  if (!constantTimeEqualStrings(sig, expected)) {
    return null;
  }
  return rawToken;
}

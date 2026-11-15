/**
 * ============================================================================
 * YUOP Streetwear — طبقة تخزين صور الإيصالات (Cloudflare R2 + التحقق الأمني)
 * تتحقق من البصمة السحرية للملفات (Magic Bytes) وتحد الحجم بـ 5 ميجابايت
 * وتمنع رفع الملفات التنفيذية أو نصوص HTML/SVG الخبيثة.
 * ============================================================================
 */
import type { R2Bucket } from '@cloudflare/workers-types';

export interface StoredReceiptObject {
  bytes: Uint8Array;
  contentType: string;
}

export interface ReceiptStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredReceiptObject | null>;
  delete(key: string): Promise<void>;
}

const MAX_RECEIPT_SIZE_BYTES = 5 * 1024 * 1024;

export function createR2ReceiptStorage(bucket: R2Bucket): ReceiptStorage {
  return {
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, {
        httpMetadata: {
          contentType,
          cacheControl: 'private, max-age=3600',
        },
      });
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      const buf = await obj.arrayBuffer();
      return {
        bytes: new Uint8Array(buf),
        contentType: obj.httpMetadata?.contentType || inferContentTypeFromFileName(key),
      };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

export function inferContentTypeFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

export function decodeBase64ToBytes(rawBase64: string): Uint8Array {
  const cleaned = rawBase64.replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface ValidatedReceiptImage {
  bytes: Uint8Array;
  ext: 'png' | 'jpg' | 'webp';
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
}

/**
 * التحقق من البصمة السحرية (Magic Bytes) لصور PNG / JPG / WEBP فقط
 * ورفض أي ملفات تنفيذية (MZ/ELF) أو نصوص HTML/JS/SVG.
 */
export function validateReceiptBytes(bytes: Uint8Array): ValidatedReceiptImage {
  if (bytes.length === 0 || bytes.length > MAX_RECEIPT_SIZE_BYTES) {
    throw new Error('VALIDATION: حجم صورة الإيصال غير صالح (الحد الأقصى 5 ميجابايت).');
  }

  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;

  const isJpg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;

  const isWebp =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50; // P

  if (isPng) {
    return { bytes, ext: 'png', contentType: 'image/png' };
  }
  if (isJpg) {
    return { bytes, ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (isWebp) {
    return { bytes, ext: 'webp', contentType: 'image/webp' };
  }

  throw new Error('VALIDATION: صيغة الملف غير مدعومة أو غير آمنة. يرجى رفع صورة PNG أو JPG أو WEBP صالحة فقط.');
}

export function validateAndDecodeBase64Receipt(base64Input: string): ValidatedReceiptImage {
  const match = base64Input.match(/^data:([^;]+);base64,(.+)$/i);
  if (match) {
    const mime = match[1].toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mime)) {
      throw new Error('VALIDATION: صيغة الملف غير مدعومة. يسمح فقط بصور PNG أو JPG أو WEBP.');
    }
  }
  const rawBase64 = match ? match[2] : base64Input;
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64ToBytes(rawBase64);
  } catch {
    throw new Error('VALIDATION: بيانات الصورة المشفرة غير صالحة.');
  }
  return validateReceiptBytes(bytes);
}

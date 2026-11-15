/**
 * ============================================================================
 * YUOP Streetwear — محولات التشغيل المحلي في Node.js (Port 3000)
 * تتيح تشغيل نفس تطبيق Hono Workers حرفيًا فوق node:sqlite ونظام الملفات المحلي
 * أثناء التطوير في AI Studio أو الاستضافة الذاتية عبر Node.js.
 * ============================================================================
 */
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { DbClient, DbRunResult, DbStatementInput } from '../worker/dbAdapter.ts';
import { inferContentTypeFromFileName, type ReceiptStorage } from '../worker/r2Storage.ts';

export function createNodeSqliteDbClient(db: DatabaseSync): DbClient {
  return {
    async first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null> {
      const row = db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined;
      return row ?? null;
    },
    async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
      return db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
    },
    async run(sql: string, ...params: unknown[]): Promise<DbRunResult> {
      const res = db.prepare(sql).run(...(params as SQLInputValue[]));
      return {
        meta: {
          last_row_id: Number(res.lastInsertRowid ?? 0),
          changes: Number(res.changes ?? 0),
        },
      };
    },
    async batch(statements: DbStatementInput[]): Promise<DbRunResult[]> {
      if (statements.length === 0) return [];
      db.exec('BEGIN IMMEDIATE;');
      try {
        const results: DbRunResult[] = [];
        for (const s of statements) {
          const res = db.prepare(s.sql).run(...((s.params || []) as SQLInputValue[]));
          results.push({
            meta: {
              last_row_id: Number(res.lastInsertRowid ?? 0),
              changes: Number(res.changes ?? 0),
            },
          });
        }
        db.exec('COMMIT;');
        return results;
      } catch (err) {
        try {
          db.exec('ROLLBACK;');
        } catch {
          // ignore
        }
        throw err;
      }
    },
  };
}

export function createFsReceiptStorage(uploadsDir: string): ReceiptStorage {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const resolveKeyPath = (key: string) => {
    const baseName = path.basename(key);
    return path.join(uploadsDir, baseName);
  };

  return {
    async put(key, bytes) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(resolveKeyPath(key), bytes);
    },
    async get(key) {
      const target = resolveKeyPath(key);
      if (!fs.existsSync(target)) return null;
      const buf = fs.readFileSync(target);
      return {
        bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        contentType: inferContentTypeFromFileName(target),
      };
    },
    async delete(key) {
      const target = resolveKeyPath(key);
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    },
  };
}

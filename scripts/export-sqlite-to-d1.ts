/**
 * ============================================================================
 * YUOP Streetwear — أداة تصدير بيانات SQLite المحلية إلى Cloudflare D1 و R2
 *
 * الاستخدام:
 *   npm run db:export-d1
 *   أو: npx tsx scripts/export-sqlite-to-d1.ts [path/to/yuop.db] [output.sql]
 *
 * ينتج ملف SQL يحتوي على جميع البيانات بترتيب التبعيات، ثم يطبع
 * أوامر Wrangler لتطبيقها على D1 ورفع ملفات الإيصالات إلى R2.
 * ============================================================================
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE_DB = path.resolve(process.argv[2] || process.env.DATABASE_PATH || './data/yuop.db');
const OUTPUT_SQL = path.resolve(process.argv[3] || './migrations/exported_data.sql');
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || './uploads/receipts');

// ترتيب الجداول حسب العلاقات الأجنبية (Foreign Keys)
const TABLES_IN_ORDER = [
  'store_settings',
  'products',
  'staff_users',
  'staff_sessions',
  'customers',
  'orders',
  'order_items',
  'payments',
  'payment_receipts',
  'shipping_details',
  'order_status_history',
  'whatsapp_conversations',
  'whatsapp_messages',
  'whatsapp_webhook_events',
  'notification_templates',
  'audit_logs',
  'landing_pages',
  'social_links',
  'promo_codes',
  'auth_rate_limits',
  'email_logs',
] as const;

function sqlEscape(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') {
    return Number.isFinite(val) ? String(val) : 'NULL';
  }
  if (typeof val === 'bigint') {
    return val.toString();
  }
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    const hex = Buffer.from(val).toString('hex');
    return `X'${hex}'`;
  }
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

function main() {
  if (!fs.existsSync(SOURCE_DB)) {
    console.error(`❌ لم يتم العثور على ملف قاعدة البيانات المصدر: ${SOURCE_DB}`);
    process.exit(1);
  }

  const db = new DatabaseSync(SOURCE_DB, { readOnly: true });
  const existingTables = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name)
  );

  const lines: string[] = [
    '-- ============================================================================',
    `-- YUOP Streetwear — تصدير البيانات من SQLite (${path.basename(SOURCE_DB)}) إلى Cloudflare D1`,
    `-- تاريخ التصدير: ${new Date().toISOString()}`,
    '-- تنبيه: نفّذ أولًا migrations/0001_initial_schema.sql على D1 قبل استيراد هذا الملف.',
    '-- ============================================================================',
    'PRAGMA foreign_keys = OFF;',
    '',
  ];

  const report: Array<{ table: string; sourceCount: number; exportedCount: number }> = [];

  for (const table of TABLES_IN_ORDER) {
    if (!existingTables.has(table)) continue;

    const colsInfo = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const colNames = colsInfo.map((c) => c.name);
    if (colNames.length === 0) continue;

    const rows = db.prepare(`SELECT ${colNames.map((c) => `"${c}"`).join(', ')} FROM "${table}"`).all() as Array<
      Record<string, unknown>
    >;

    report.push({ table, sourceCount: rows.length, exportedCount: rows.length });
    if (rows.length === 0) continue;

    lines.push(`-- Table: ${table} (${rows.length} rows)`);
    for (const row of rows) {
      const vals = colNames.map((c) => sqlEscape(row[c]));
      lines.push(
        `INSERT OR REPLACE INTO "${table}" (${colNames.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`
      );
    }
    lines.push('');
  }

  lines.push('PRAGMA foreign_keys = ON;');

  fs.mkdirSync(path.dirname(OUTPUT_SQL), { recursive: true });
  fs.writeFileSync(OUTPUT_SQL, lines.join('\n'), 'utf8');

  console.log('\n✅ تم تصدير البيانات بنجاح إلى:', OUTPUT_SQL);
  console.log('\n📊 ملخص مطابقة عدد الصفوف (Source vs Exported):');
  for (const item of report) {
    console.log(`  - ${item.table.padEnd(26)} : ${item.sourceCount} -> ${item.exportedCount}`);
  }

  console.log('\n🚀 الخطوات التالية للرفع على Cloudflare D1 و R2:');
  console.log('  1) تطبيق هيكل الجداول:');
  console.log('     npx wrangler d1 execute yuop-db --remote --file=./migrations/0001_initial_schema.sql');
  console.log('  2) استيراد البيانات المصدرة:');
  console.log(`     npx wrangler d1 execute yuop-db --remote --file=${path.relative(process.cwd(), OUTPUT_SQL)}`);

  if (fs.existsSync(UPLOADS_DIR)) {
    const files = fs.readdirSync(UPLOADS_DIR).filter((f) => !f.startsWith('.'));
    if (files.length > 0) {
      console.log(`\n  3) رفع صور الإيصالات المحلية (${files.length} ملف) إلى Cloudflare R2:`);
      for (const file of files) {
        const localFile = path.relative(process.cwd(), path.join(UPLOADS_DIR, file));
        console.log(`     npx wrangler r2 object put yuop-receipts/receipts/${file} --file="${localFile}"`);
      }
    }
  }
}

main();

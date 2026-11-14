/**
 * ============================================================================
 * YUOP Streetwear — طبقة قاعدة البيانات (SQLite via node:sqlite)
 * تستخدم SQLite المدمجة في Node.js v22 لتقليل التكلفة التشغيلية إلى الصفر
 * مع دعم كامل للمعاملات الذرية (ACID Transactions) والمفاتيح الأجنبية.
 * ============================================================================
 */
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LandingPage,
  NotificationTemplate,
  Permission,
  Product,
  PromoCode,
  SocialLink,
  SocialPlatform,
  StaffRole,
  StoreSettings,
  ThemeMode,
} from '../shared/types.ts';

// دالة تجزئة كلمات المرور باستخدام scrypt وملح عشوائي آمن
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

// تنفيذ العمليات داخل معاملة قاعدة بيانات ذرية لضمان عدم تضارب البيانات (القسم التاسع عشر)
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // تجاهل خطأ التراجع إذا لم تكن المعاملة نشطة
    }
    throw err;
  }
}

export function createDatabase(
  dbPath: string = process.env.DATABASE_PATH || './data/yuop.db',
  uploadsDir: string = process.env.UPLOADS_DIR || './uploads/receipts'
): DatabaseSync {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(uploadsDir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }

  // إنشاء جميع الجداول المطلوبة (القسم الثامن عشر)
  db.exec(`
    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      store_name TEXT NOT NULL DEFAULT 'YUOP',
      tagline_ar TEXT NOT NULL,
      tagline_en TEXT NOT NULL,
      announcement_enabled INTEGER NOT NULL DEFAULT 1,
      announcement_text_ar TEXT NOT NULL,
      announcement_text_en TEXT NOT NULL,
      hero_kicker_ar TEXT NOT NULL,
      hero_kicker_en TEXT NOT NULL,
      hero_title_ar TEXT NOT NULL,
      hero_title_en TEXT NOT NULL,
      hero_subtitle_ar TEXT NOT NULL,
      hero_subtitle_en TEXT NOT NULL,
      hero_cta_ar TEXT NOT NULL,
      hero_cta_en TEXT NOT NULL,
      hero_image_url TEXT NOT NULL,
      accent_color TEXT NOT NULL DEFAULT '#111111',
      default_theme TEXT NOT NULL DEFAULT 'light',
      currency_code TEXT NOT NULL DEFAULT 'EGP',
      currency_symbol_ar TEXT NOT NULL DEFAULT 'ج.م',
      shipping_fee REAL NOT NULL DEFAULT 85,
      free_shipping_threshold REAL NOT NULL DEFAULT 2500,
      support_whatsapp TEXT NOT NULL DEFAULT '201000000000',
      support_email TEXT NOT NULL DEFAULT 'support@yuop.store',
      vodafone_cash_number TEXT NOT NULL DEFAULT '01099887766',
      vodafone_cash_instructions_ar TEXT NOT NULL,
      instapay_address TEXT NOT NULL DEFAULT 'yuop.store@instapay',
      instapay_instructions_ar TEXT NOT NULL,
      cod_enabled INTEGER NOT NULL DEFAULT 1,
      vodafone_enabled INTEGER NOT NULL DEFAULT 1,
      instapay_enabled INTEGER NOT NULL DEFAULT 1,
      footer_about_ar TEXT NOT NULL,
      footer_about_en TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      compare_at_price REAL,
      description_ar TEXT NOT NULL,
      description_en TEXT NOT NULL,
      fabric_details TEXT NOT NULL,
      image_url TEXT NOT NULL,
      secondary_image_url TEXT,
      sizes_stock TEXT NOT NULL,
      is_featured INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      badge_text TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      custom_permissions TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff_sessions (
      token TEXT PRIMARY KEY,
      staff_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      normalized_phone TEXT NOT NULL UNIQUE,
      email TEXT,
      governorate TEXT NOT NULL,
      address TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      normalized_phone TEXT NOT NULL,
      customer_email TEXT,
      governorate TEXT NOT NULL,
      delivery_address TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      subtotal REAL NOT NULL,
      discount_amount REAL NOT NULL DEFAULT 0,
      promo_code TEXT,
      shipping_fee REAL NOT NULL,
      total_amount REAL NOT NULL,
      tracking_token TEXT NOT NULL UNIQUE,
      idempotency_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(normalized_phone);
    CREATE INDEX IF NOT EXISTS idx_orders_idempotency ON orders(idempotency_hash, created_at);

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name_ar TEXT NOT NULL,
      product_name_en TEXT NOT NULL,
      size TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      image_url TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      amount REAL NOT NULL,
      confirmed_by TEXT,
      confirmed_at TEXT,
      rejected_by TEXT,
      rejected_at TEXT,
      rejection_reason TEXT,
      cod_collected_by TEXT,
      cod_collected_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      public_url TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'web',
      whatsapp_media_id TEXT,
      status TEXT NOT NULL DEFAULT 'Under Review',
      rejection_reason TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shipping_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      shipping_company TEXT,
      courier_name TEXT,
      courier_phone TEXT,
      tracking_number TEXT,
      tracking_url TEXT,
      shipped_at TEXT,
      expected_delivery_at TEXT,
      delivery_notes TEXT,
      delivery_failure_reason TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      wa_phone TEXT NOT NULL UNIQUE,
      last_order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      last_customer_message_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      direction TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      template_key TEXT,
      recipient_phone TEXT NOT NULL,
      body TEXT NOT NULL,
      media_url TEXT,
      status TEXT NOT NULL,
      meta_message_id TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_key TEXT NOT NULL UNIQUE,
      title_ar TEXT NOT NULL,
      description_ar TEXT NOT NULL,
      body TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      meta_template_name TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      order_number TEXT,
      employee_name TEXT NOT NULL,
      employee_role TEXT,
      action_type TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS landing_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title_ar TEXT NOT NULL,
      title_en TEXT NOT NULL,
      kicker_ar TEXT NOT NULL,
      kicker_en TEXT NOT NULL,
      subtitle_ar TEXT NOT NULL,
      subtitle_en TEXT NOT NULL,
      hero_image_url TEXT NOT NULL,
      cta_text_ar TEXT NOT NULL,
      cta_text_en TEXT NOT NULL,
      theme_style TEXT NOT NULL DEFAULT 'dark',
      highlights_json TEXT NOT NULL DEFAULT '[]',
      featured_product_ids_json TEXT NOT NULL DEFAULT '[]',
      is_published INTEGER NOT NULL DEFAULT 1,
      show_in_footer INTEGER NOT NULL DEFAULT 1,
      views_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS social_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      label TEXT NOT NULL,
      handle TEXT,
      url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      discount_type TEXT NOT NULL,
      discount_value REAL NOT NULL,
      min_order_amount REAL NOT NULL DEFAULT 0,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // ترحيل الأعمدة الجديدة بأمان لقواعد البيانات القائمة على القرص
  const ensureColumn = (table: string, colName: string, alterSql: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === colName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${alterSql};`);
    }
  };
  ensureColumn('store_settings', 'default_theme', `default_theme TEXT NOT NULL DEFAULT 'light'`);
  ensureColumn('orders', 'discount_amount', `discount_amount REAL NOT NULL DEFAULT 0`);
  ensureColumn('orders', 'promo_code', `promo_code TEXT`);

  seedInitialData(db, uploadsDir);
  return db;
}

function seedInitialData(db: DatabaseSync, uploadsDir: string) {
  const now = new Date().toISOString();

  // 1. إعدادات المتجر الافتراضية لبراند YUOP
  const settingsCount = (db.prepare('SELECT COUNT(*) as c FROM store_settings').get() as { c: number }).c;
  if (settingsCount === 0) {
    db.prepare(`
      INSERT INTO store_settings (
        id, store_name, tagline_ar, tagline_en, announcement_enabled,
        announcement_text_ar, announcement_text_en,
        hero_kicker_ar, hero_kicker_en, hero_title_ar, hero_title_en,
        hero_subtitle_ar, hero_subtitle_en, hero_cta_ar, hero_cta_en,
        hero_image_url, accent_color, currency_code, currency_symbol_ar,
        shipping_fee, free_shipping_threshold, support_whatsapp, support_email,
        vodafone_cash_number, vodafone_cash_instructions_ar,
        instapay_address, instapay_instructions_ar,
        cod_enabled, vodafone_enabled, instapay_enabled,
        footer_about_ar, footer_about_en, updated_at
      ) VALUES (
        1, 'YUOP',
        'ستريت وير مصمم بخامات ثقيلة وقصّات عصرية', 'Heavyweight Urban Streetwear',
        1,
        'شحن مجاني للطلبات فوق 2500 ج.م · الدفع عبر فودافون كاش أو إنستا باي أو عند الاستلام',
        'Free shipping over 2,500 EGP · Vodafone Cash, InstaPay & Cash on Delivery',
        'إصدار الخريف / الشتاء 2026', 'DROP 04 // FW26',
        'قصّات ستريت وير ثقيلة بتصميم معماري', 'ARCHITECTURAL HEAVYWEIGHT STREETWEAR',
        'أقمشة قطن 480 GSM مغسولة بعناية، قصّات Boxy متقنة، وشحن سريع لجميع المحافظات مع متابعة فورية عبر واتساب.',
        '480 GSM washed cotton silhouettes, engineered boxy fits, and real-time WhatsApp order tracking.',
        'تسوق الإصدار الجديد', 'Shop New Drop',
        '/src/assets/images/hero_yuop_editorial_1794551310693.jpg',
        '#111111', 'EGP', 'ج.م',
        85, 2500, '201099887766', 'support@yuop.store',
        '01099887766',
        'قم بتحويل إجمالي المبلغ إلى رقم فودافون كاش الموضح أعلاه، ثم ارفع صورة إيصال التحويل أو أرسلها عبر واتساب لتأكيد الطلب.',
        'yuop.store@instapay',
        'قم بالتحويل عبر تطبيق InstaPay إلى العنوان الموضح أعلاه، ثم ارفع صورة الإيصال ليتم مراجعتها وتأكيد طلبك فورًا.',
        1, 1, 1,
        'علامة YUOP متخصصة في ملابس الستريت وير الثقيلة بتفاصيل صناعية دقيقة وجودة تدوم.',
        'YUOP crafts heavyweight urban essentials with architectural proportions and lasting fabric weight.',
        ?
      )
    `).run(now);
  } else {
    // ترقية صورة البانر الافتراضية القديمة تلقائيًا إذا لم يقم المدير بتخصيصها
    db.prepare(`
      UPDATE store_settings
      SET hero_image_url = '/src/assets/images/hero_yuop_editorial_1794551310693.jpg'
      WHERE id = 1 AND hero_image_url = '/src/assets/images/hero_yuop_streetwear_1794549969761.jpg'
    `).run();
    db.prepare(`
      UPDATE products SET image_url = '/src/assets/images/cat_hoodies_editorial_1794551311689.jpg', secondary_image_url = '/src/assets/images/product_hoodie_obsidian_1794549969578.jpg'
      WHERE slug = 'yuop-obsidian-boxy-hoodie' AND image_url = '/src/assets/images/product_hoodie_obsidian_1794549969578.jpg'
    `).run();
    db.prepare(`
      UPDATE products SET image_url = '/src/assets/images/cat_tees_editorial_1794551311360.jpg', secondary_image_url = '/src/assets/images/product_tee_chalk_1794549970590.jpg'
      WHERE slug = 'yuop-chalk-architectural-tee' AND image_url = '/src/assets/images/product_tee_chalk_1794549970590.jpg'
    `).run();
    db.prepare(`
      UPDATE products SET image_url = '/src/assets/images/cat_cargos_editorial_1794551311969.jpg', secondary_image_url = '/src/assets/images/product_cargo_slate_1794549970140.jpg'
      WHERE slug = 'yuop-slate-technical-cargo' AND image_url = '/src/assets/images/product_cargo_slate_1794549970140.jpg'
    `).run();
  }

  // 2. المنتجات الافتراضية
  const productsCount = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;
  if (productsCount === 0) {
    const insertProduct = db.prepare(`
      INSERT INTO products (
        slug, name_ar, name_en, category, price, compare_at_price,
        description_ar, description_en, fabric_details,
        image_url, secondary_image_url, sizes_stock,
        is_featured, is_active, badge_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seedProducts = [
      {
        slug: 'yuop-obsidian-boxy-hoodie',
        name_ar: 'هودي أوبسيديان أوفرسايز — أسود مغسول',
        name_en: 'Obsidian Heavyweight Boxy Hoodie',
        category: 'Hoodies',
        price: 1450,
        compare_at_price: 1700,
        description_ar: 'هودي قطن ثقيل 480 GSM بقصة Boxy واسعة، غسيل إنزيمي فحمي وتفاصيل خياطة مزدوجة.',
        description_en: '480 GSM enzyme-washed charcoal cotton hoodie with dropped shoulders and double-lined hood.',
        fabric_details: '100% قطن مصري ممشط · 480 GSM · غسيل فحمي',
        image_url: '/src/assets/images/cat_hoodies_editorial_1794551311689.jpg',
        secondary_image_url: '/src/assets/images/product_hoodie_obsidian_1794549969578.jpg',
        sizes_stock: JSON.stringify({ S: 6, M: 14, L: 12, XL: 8 }),
        is_featured: 1,
        is_active: 1,
        badge_text: 'الأكثر مبيعًا',
      },
      {
        slug: 'yuop-chalk-architectural-tee',
        name_ar: 'تيشيرت تشوك بوكسي — أبيض طباشيري',
        name_en: 'Chalk 300GSM Boxy Tee',
        category: 'Tees',
        price: 720,
        compare_at_price: null,
        description_ar: 'تيشيرت ثقيل بياقة سميكة مضلعة وقصة مربعة مريحة لا يتغير مقاسها مع الغسيل.',
        description_en: '300 GSM heavyweight combed jersey tee with thick ribbed collar and relaxed boxy drape.',
        fabric_details: '100% قطن سنجل جيرسي · 300 GSM · معالج ضد الانكماش',
        image_url: '/src/assets/images/cat_tees_editorial_1794551311360.jpg',
        secondary_image_url: '/src/assets/images/product_tee_chalk_1794549970590.jpg',
        sizes_stock: JSON.stringify({ S: 10, M: 18, L: 15, XL: 9 }),
        is_featured: 1,
        is_active: 1,
        badge_text: 'إصدار أساسي',
      },
      {
        slug: 'yuop-slate-technical-cargo',
        name_ar: 'بنطلون كارجو سليت — رمادي تقني',
        name_en: 'Slate Wide Technical Cargo',
        category: 'Cargos',
        price: 1650,
        compare_at_price: 1900,
        description_ar: 'بنطلون كارجو واسع بجيوب جانبية كبيرة وإكسسوارات معدنية مطفية وأربطة ضبط سفلية.',
        description_en: 'Wide-leg ripstop cotton cargo trousers with matte black D-rings, bellows pockets, and ankle toggles.',
        fabric_details: 'قطن ريبستوب مقاوم للتمزق · 340 GSM · إكسسوارات معدنية',
        image_url: '/src/assets/images/cat_cargos_editorial_1794551311969.jpg',
        secondary_image_url: '/src/assets/images/product_cargo_slate_1794549970140.jpg',
        sizes_stock: JSON.stringify({ S: 5, M: 10, L: 10, XL: 6 }),
        is_featured: 1,
        is_active: 1,
        badge_text: 'كمية محدودة',
      },
      {
        slug: 'yuop-workwear-cropped-jacket',
        name_ar: 'جاكيت وورك وير كروبد — زيتوني فحمي',
        name_en: 'Monolith Cropped Workwear Jacket',
        category: 'Jackets',
        price: 2250,
        compare_at_price: 2600,
        description_ar: 'جاكيت كانفاس ثقيل بقصة كروبد عصرية، سحاب معدني متين وبطانة داخلية ناعمة.',
        description_en: 'Structured heavyweight canvas cropped work jacket with YKK metal zip and concealed pocket.',
        fabric_details: 'كانفاس قطني ثقيل · 520 GSM · سحاب معدني مزدوج',
        image_url: '/src/assets/images/product_jacket_bomber_1794549971089.jpg',
        secondary_image_url: '/src/assets/images/cat_cargos_editorial_1794551311969.jpg',
        sizes_stock: JSON.stringify({ S: 4, M: 8, L: 7, XL: 3 }),
        is_featured: 1,
        is_active: 1,
        badge_text: 'إصدار خاص',
      },
      {
        slug: 'yuop-concrete-zip-hoodie',
        name_ar: 'هودي سحاب كونكريت — أسود مطفي',
        name_en: 'Concrete Heavy Zip Hoodie',
        category: 'Hoodies',
        price: 1580,
        compare_at_price: null,
        description_ar: 'سويت شيرت بسحاب كامل وخامة فرينش تيري غير مبطنة تناسب جميع الفصول.',
        description_en: 'Full-zip heavyweight French terry hoodie with matte gunmetal hardware.',
        fabric_details: '100% قطن فرينش تيري · 450 GSM',
        image_url: '/src/assets/images/product_hoodie_obsidian_1794549969578.jpg',
        secondary_image_url: '/src/assets/images/cat_hoodies_editorial_1794551311689.jpg',
        sizes_stock: JSON.stringify({ S: 7, M: 11, L: 9, XL: 5 }),
        is_featured: 0,
        is_active: 1,
        badge_text: null,
      },
      {
        slug: 'yuop-raw-canvas-overshirt',
        name_ar: 'أوفرشيرت كانفاس — رمادي داكن',
        name_en: 'Raw Canvas Utility Overshirt',
        category: 'Jackets',
        price: 1790,
        compare_at_price: null,
        description_ar: 'قطعة عملية متعددة الجيوب بتصميم مينيمال تناسب التنسيق اليومي فوق التيشيرت.',
        description_en: 'Minimalist utility overshirt cut from heavyweight brushed cotton twill.',
        fabric_details: 'تويل قطني ثقيل · 400 GSM',
        image_url: '/src/assets/images/product_jacket_bomber_1794549971089.jpg',
        secondary_image_url: '/src/assets/images/hero_yuop_streetwear_1794549969761.jpg',
        sizes_stock: JSON.stringify({ S: 6, M: 9, L: 8, XL: 4 }),
        is_featured: 0,
        is_active: 1,
        badge_text: null,
      },
    ];

    for (const p of seedProducts) {
      insertProduct.run(
        p.slug, p.name_ar, p.name_en, p.category, p.price, p.compare_at_price,
        p.description_ar, p.description_en, p.fabric_details,
        p.image_url, p.secondary_image_url, p.sizes_stock,
        p.is_featured, p.is_active, p.badge_text, now
      );
    }
  }

  // 3. قوالب رسائل WhatsApp الافتراضية المطابقة تمامًا للمواصفات (القسم السادس، التاسع، الحادي عشر)
  const templatesCount = (db.prepare('SELECT COUNT(*) as c FROM notification_templates').get() as { c: number }).c;
  if (templatesCount === 0) {
    const insertTemplate = db.prepare(`
      INSERT INTO notification_templates (template_key, title_ar, description_ar, body, is_enabled, meta_template_name, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `);

    const templates = [
      {
        key: 'order_created',
        title_ar: 'رسالة إنشاء الطلب الجديد',
        description_ar: 'تُرسل فور إنشاء العميل للطلب من المتجر.',
        meta_template_name: 'yuop_order_created',
        body: `أهلًا CUSTOMER_NAME ❤️\nتم استلام طلبك رقم #ORDER_ID بنجاح بقيمة TOTAL_AMOUNT ج.م.\nطريقة الدفع المختارة: PAYMENT_METHOD\nسنتابع معك كافة التفاصيل أولًا بأول.`,
      },
      {
        key: 'payment_instructions',
        title_ar: 'رسالة بيانات التحويل (فودافون كاش / إنستا باي)',
        description_ar: 'تُرسل مع بيانات التحويل عندما يختار العميل فودافون كاش أو إنستا باي.',
        meta_template_name: 'yuop_payment_instructions',
        body: `طلبك رقم #ORDER_ID بانتظار إتمام الدفع عبر PAYMENT_METHOD.\nالإجمالي المطلوب: TOTAL_AMOUNT ج.م\nرقم فودافون كاش: VODAFONE_NUMBER\nعنوان InstaPay: INSTAPAY_ADDRESS\nيرجى إرسال صورة الإيصال هنا أو عبر صفحة تتبع الطلب لمراجعة الدفع وتأكيده.`,
      },
      {
        key: 'payment_confirmed',
        title_ar: 'رسالة تأكيد استلام الدفع',
        description_ar: 'تُرسل عند ضغط الموظف على زر Confirm Payment.',
        meta_template_name: 'yuop_payment_confirmed',
        body: `مبروك ❤️\nتم تأكيد استلام الدفع الخاص بطلبك رقم #ORDER_ID بنجاح.\nجاري تجهيز طلبك، وسنرسل لك تحديثات حالة التوصيل أولًا بأول.`,
      },
      {
        key: 'payment_rejected',
        title_ar: 'رسالة رفض الدفع مع السبب',
        description_ar: 'تُرسل عند رفض الإيصال مع إدراج سبب الرفض.',
        meta_template_name: 'yuop_payment_rejected',
        body: `نعتذر منك ❤️\nلم نتمكن من تأكيد الدفع للطلب رقم #ORDER_ID.\nسبب الرفض: REJECTION_REASON\nيمكنك إعادة إرسال إيصال واضح لإعادة مراجعة طلبك.`,
      },
      {
        key: 'order_confirmed',
        title_ar: 'رسالة تأكيد الطلب',
        description_ar: 'تُرسل عند تحول حالة الطلب إلى Confirmed (مثل تأكيد الدفع عند الاستلام).',
        meta_template_name: 'yuop_order_confirmed',
        body: `مبروك ❤️\nتم تأكيد طلبك رقم #ORDER_ID بنجاح.`,
      },
      {
        key: 'order_preparing',
        title_ar: 'رسالة جاري تجهيز الطلب',
        description_ar: 'تُرسل عند تحديث الحالة إلى Preparing.',
        meta_template_name: 'yuop_order_preparing',
        body: `أهلًا بك ❤️\nطلبك رقم #ORDER_ID جاري تجهيزه الآن.`,
      },
      {
        key: 'order_ready_for_shipping',
        title_ar: 'رسالة جاهز للشحن',
        description_ar: 'تُرسل عند تحديث الحالة إلى Ready for Shipping.',
        meta_template_name: 'yuop_order_ready',
        body: `طلبك رقم #ORDER_ID أصبح جاهزًا للشحن.\nسنوافيك بالتحديثات قريبًا.`,
      },
      {
        key: 'order_shipped',
        title_ar: 'رسالة تم شحن الطلب + بيانات التتبع',
        description_ar: 'تُرسل عند تحديث الحالة إلى Shipped أو عند إرسال رابط التتبع.',
        meta_template_name: 'yuop_order_shipped',
        body: `طلبك رقم #ORDER_ID تم شحنه بنجاح 🚚\nشركة الشحن: SHIPPING_COMPANY\nرقم التتبع: TRACKING_NUMBER\nرابط التتبع: TRACKING_URL`,
      },
      {
        key: 'order_out_for_delivery',
        title_ar: 'رسالة خرج للتوصيل',
        description_ar: 'تُرسل عند تحديث الحالة إلى Out for Delivery.',
        meta_template_name: 'yuop_out_for_delivery',
        body: `طلبك رقم #ORDER_ID خرج للتوصيل إليك.\nيرجى التأكد من جاهزيتك لاستلام الطلب.`,
      },
      {
        key: 'order_delivered',
        title_ar: 'رسالة تم تسليم الطلب',
        description_ar: 'تُرسل عند تحديث الحالة إلى Delivered.',
        meta_template_name: 'yuop_order_delivered',
        body: `تم تسليم طلبك رقم #ORDER_ID بنجاح ❤️\nشكرًا لثقتك بنا، ونتمنى أن تنال منتجاتنا إعجابك.`,
      },
      {
        key: 'order_delivery_failed',
        title_ar: 'رسالة تعذر التسليم',
        description_ar: 'تُرسل عند تحديث الحالة إلى Delivery Failed.',
        meta_template_name: 'yuop_delivery_failed',
        body: `نعتذر منك، تعذر تسليم طلبك رقم #ORDER_ID.\nيرجى التواصل معنا لتحديد موعد مناسب لإعادة التوصيل.`,
      },
      {
        key: 'order_returned',
        title_ar: 'رسالة تم إرجاع الطلب',
        description_ar: 'تُرسل عند تحديث الحالة إلى Returned.',
        meta_template_name: 'yuop_order_returned',
        body: `تم تحديث حالة طلبك رقم #ORDER_ID إلى مرتجع.\nيمكنك التواصل معنا إذا كنت تحتاج إلى أي مساعدة.`,
      },
      {
        key: 'order_cancelled',
        title_ar: 'رسالة إلغاء الطلب',
        description_ar: 'تُرسل عند تحديث الحالة إلى Cancelled.',
        meta_template_name: 'yuop_order_cancelled',
        body: `تم إلغاء طلبك رقم #ORDER_ID.\nسبب الإلغاء: CANCELLATION_REASON`,
      },
    ];

    for (const t of templates) {
      insertTemplate.run(t.key, t.title_ar, t.description_ar, t.body, t.meta_template_name, now);
    }
  }

  // 4. حسابات الموظفين الافتراضية لتجربة جميع مستويات الصلاحيات (RBAC)
  const staffCount = (db.prepare('SELECT COUNT(*) as c FROM staff_users').get() as { c: number }).c;
  if (staffCount === 0) {
    const insertStaff = db.prepare(`
      INSERT INTO staff_users (name, email, password_hash, role, custom_permissions, is_active, created_at)
      VALUES (?, ?, ?, ?, NULL, 1, ?)
    `);
    insertStaff.run('أحمد منصور (المدير العام)', 'admin@yuop.store', hashPassword('yuop2026'), 'Super Admin', now);
    insertStaff.run('سارة خالد (مراجعة المدفوعات)', 'payments@yuop.store', hashPassword('yuop2026'), 'Payment Reviewer', now);
    insertStaff.run('كريم عادل (مدير الشحن)', 'shipping@yuop.store', hashPassword('yuop2026'), 'Shipping Manager', now);
    insertStaff.run('نور طارق (دعم العملاء)', 'support@yuop.store', hashPassword('yuop2026'), 'Customer Support', now);
  }

  // 5. بيانات طلبات أولية واقعية (تغطي مراجعة الدفع، الدفع عند الاستلام، والشحن)
  const ordersCount = (db.prepare('SELECT COUNT(*) as c FROM orders').get() as { c: number }).c;
  if (ordersCount === 0) {
    // إنشاء صورة إيصال تجريبية محفوظة فعليًا على القرص لمراجعة الدفع
    const sampleReceiptName = 'sample_vodafone_receipt.svg';
    const sampleReceiptPath = path.join(uploadsDir, sampleReceiptName);
    if (!fs.existsSync(sampleReceiptPath)) {
      fs.writeFileSync(
        sampleReceiptPath,
        `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="580" viewBox="0 0 420 580">
  <rect width="420" height="580" fill="#fafafa"/>
  <rect x="20" y="20" width="380" height="540" rx="12" fill="#ffffff" stroke="#e5e5e5" stroke-width="2"/>
  <rect x="20" y="20" width="380" height="72" rx="12" fill="#e60000"/>
  <text x="210" y="64" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#ffffff" text-anchor="middle">Vodafone Cash Receipt</text>
  <text x="210" y="135" font-family="monospace" font-size="14" fill="#555" text-anchor="middle">Transaction Ref: VF-992847102</text>
  <text x="210" y="185" font-family="Arial, sans-serif" font-size="34" font-weight="bold" fill="#111" text-anchor="middle">1,535.00 EGP</text>
  <line x1="48" y1="220" x2="372" y2="220" stroke="#eee" stroke-width="2"/>
  <text x="54" y="260" font-family="Arial, sans-serif" font-size="14" fill="#666">To Wallet:</text>
  <text x="366" y="260" font-family="monospace" font-size="14" font-weight="bold" fill="#111" text-anchor="end">01099887766</text>
  <text x="54" y="300" font-family="Arial, sans-serif" font-size="14" fill="#666">From Wallet:</text>
  <text x="366" y="300" font-family="monospace" font-size="14" font-weight="bold" fill="#111" text-anchor="end">01023456789</text>
  <text x="54" y="340" font-family="Arial, sans-serif" font-size="14" fill="#666">Status:</text>
  <text x="366" y="340" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#16a34a" text-anchor="end">Transfer Successful</text>
  <text x="210" y="450" font-family="monospace" font-size="12" fill="#999" text-anchor="middle">Order Ref #YUOP-1001 · YUOP Streetwear</text>
</svg>`,
        'utf8'
      );
    }

    // عميل 1: طلب Vodafone Cash بانتظار مراجعة الدفع
    const c1 = db.prepare(`
      INSERT INTO customers (name, phone, normalized_phone, email, governorate, address, created_at, updated_at)
      VALUES ('يوسف إبراهيم', '01023456789', '201023456789', 'youssef@example.com', 'القاهرة', '14 شارع عباس العقاد، مدينة نصر', ?, ?)
    `).run(now, now).lastInsertRowid as number;

    const o1 = db.prepare(`
      INSERT INTO orders (
        order_number, customer_id, customer_name, customer_phone, normalized_phone, customer_email,
        governorate, delivery_address, notes, status, payment_method, payment_status,
        subtotal, shipping_fee, total_amount, tracking_token, idempotency_hash, created_at, updated_at
      ) VALUES (
        'YUOP-1001', ?, 'يوسف إبراهيم', '01023456789', '201023456789', 'youssef@example.com',
        'القاهرة', '14 شارع عباس العقاد، مدينة نصر', 'الاتصال قبل التوصيل بساعة',
        'Payment Review', 'Vodafone Cash', 'Under Review',
        1450, 85, 1535, 'trk_demo_1001', 'seed_hash_1001', ?, ?
      )
    `).run(c1, now, now).lastInsertRowid as number;

    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name_ar, product_name_en, size, quantity, unit_price, line_total, image_url)
      VALUES (?, 1, 'هودي أوبسيديان أوفرسايز — أسود مغسول', 'Obsidian Heavyweight Boxy Hoodie', 'L', 1, 1450, 1450, '/src/assets/images/product_hoodie_obsidian_1794549969578.jpg')
    `).run(o1);

    const p1 = db.prepare(`
      INSERT INTO payments (order_id, method, status, amount, updated_at)
      VALUES (?, 'Vodafone Cash', 'Under Review', 1535, ?)
    `).run(o1, now).lastInsertRowid as number;

    db.prepare(`
      INSERT INTO payment_receipts (order_id, payment_id, attempt_number, file_path, public_url, source, status, received_at)
      VALUES (?, ?, 1, ?, '/api/receipts/sample_vodafone_receipt.svg?token=trk_demo_1001', 'web', 'Under Review', ?)
    `).run(o1, p1, sampleReceiptPath, now);

    db.prepare(`INSERT INTO shipping_details (order_id, updated_at) VALUES (?, ?)`).run(o1, now);
    db.prepare(`INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at) VALUES (?, NULL, 'Awaiting Payment', 'النظام', 'تم إنشاء الطلب من المتجر', ?)`).run(o1, now);
    db.prepare(`INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at) VALUES (?, 'Awaiting Payment', 'Payment Review', 'العميل', 'تم رفع إيصال فودافون كاش للمراجعة', ?)`).run(o1, now);
    db.prepare(`INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (?, 'YUOP-1001', 'العميل', 'Customer', 'استلام إيصال', 'تم استلام إيصال الدفع رقم #1 عبر الموقع', ?)`).run(o1, now);

    // عميل 2: طلب الدفع عند الاستلام (Pending Confirmation / Unpaid)
    const c2 = db.prepare(`
      INSERT INTO customers (name, phone, normalized_phone, email, governorate, address, created_at, updated_at)
      VALUES ('عمر الشريف', '01155667788', '201155667788', 'omar@example.com', 'الجيزة', 'الشيخ زايد، الحي الثامن، فيلا 22', ?, ?)
    `).run(now, now).lastInsertRowid as number;

    const o2 = db.prepare(`
      INSERT INTO orders (
        order_number, customer_id, customer_name, customer_phone, normalized_phone, customer_email,
        governorate, delivery_address, notes, status, payment_method, payment_status,
        subtotal, shipping_fee, total_amount, tracking_token, idempotency_hash, created_at, updated_at
      ) VALUES (
        'YUOP-1002', ?, 'عمر الشريف', '01155667788', '201155667788', 'omar@example.com',
        'الجيزة', 'الشيخ زايد، الحي الثامن، فيلا 22', NULL,
        'Pending Confirmation', 'Cash on Delivery', 'Unpaid',
        2370, 85, 2455, 'trk_demo_1002', 'seed_hash_1002', ?, ?
      )
    `).run(c2, now, now).lastInsertRowid as number;

    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name_ar, product_name_en, size, quantity, unit_price, line_total, image_url)
      VALUES (?, 3, 'بنطلون كارجو سليت — رمادي تقني', 'Slate Wide Technical Cargo', 'M', 1, 1650, 1650, '/src/assets/images/product_cargo_slate_1794549970140.jpg')
    `).run(o2);
    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name_ar, product_name_en, size, quantity, unit_price, line_total, image_url)
      VALUES (?, 2, 'تيشيرت تشوك بوكسي — أبيض طباشيري', 'Chalk 300GSM Boxy Tee', 'L', 1, 720, 720, '/src/assets/images/product_tee_chalk_1794549970590.jpg')
    `).run(o2);

    db.prepare(`INSERT INTO payments (order_id, method, status, amount, updated_at) VALUES (?, 'Cash on Delivery', 'Unpaid', 2455, ?)`).run(o2, now);
    db.prepare(`INSERT INTO shipping_details (order_id, updated_at) VALUES (?, ?)`).run(o2, now);
    db.prepare(`INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at) VALUES (?, NULL, 'Pending Confirmation', 'النظام', 'طلب دفع عند الاستلام بانتظار التأكيد', ?)`).run(o2, now);
    db.prepare(`INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (?, 'YUOP-1002', 'العميل', 'Customer', 'إنشاء الطلب', 'تم إنشاء طلب دفع عند الاستلام بقيمة 2455 ج.م', ?)`).run(o2, now);

    // عميل 3: طلب InstaPay مؤكد وتم شحنه مع بيانات شركة الشحن
    const c3 = db.prepare(`
      INSERT INTO customers (name, phone, normalized_phone, email, governorate, address, created_at, updated_at)
      VALUES ('مريم حسن', '01299881122', '201299881122', 'mariam@example.com', 'الإسكندرية', 'سموحة، شارع فوزي معاذ، برج الصفوة', ?, ?)
    `).run(now, now).lastInsertRowid as number;

    const o3 = db.prepare(`
      INSERT INTO orders (
        order_number, customer_id, customer_name, customer_phone, normalized_phone, customer_email,
        governorate, delivery_address, notes, status, payment_method, payment_status,
        subtotal, shipping_fee, total_amount, tracking_token, idempotency_hash, created_at, updated_at
      ) VALUES (
        'YUOP-1003', ?, 'مريم حسن', '01299881122', '201299881122', 'mariam@example.com',
        'الإسكندرية', 'سموحة، شارع فوزي معاذ، برج الصفوة', 'مناسب التوصيل مساءً',
        'Shipped', 'InstaPay', 'Paid',
        2250, 85, 2335, 'trk_demo_1003', 'seed_hash_1003', ?, ?
      )
    `).run(c3, now, now).lastInsertRowid as number;

    db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name_ar, product_name_en, size, quantity, unit_price, line_total, image_url)
      VALUES (?, 4, 'جاكيت وورك وير كروبد — زيتوني فحمي', 'Monolith Cropped Workwear Jacket', 'M', 1, 2250, 2250, '/src/assets/images/product_jacket_bomber_1794549971089.jpg')
    `).run(o3);

    db.prepare(`
      INSERT INTO payments (order_id, method, status, amount, confirmed_by, confirmed_at, updated_at)
      VALUES (?, 'InstaPay', 'Paid', 2335, 'سارة خالد (مراجعة المدفوعات)', ?, ?)
    `).run(o3, now, now);

    db.prepare(`
      INSERT INTO shipping_details (
        order_id, shipping_company, courier_name, courier_phone,
        tracking_number, tracking_url, shipped_at, expected_delivery_at,
        delivery_notes, updated_at
      ) VALUES (
        ?, 'Bosta', 'محمود سامي', '01044556677',
        'BST-884120', 'https://bosta.co/tracking-shipment/?shipmentId=BST-884120',
        ?, ?, 'التسليم بعد الساعة 5 مساءً', ?
      )
    `).run(o3, now, new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10), now);

    db.prepare(`INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at) VALUES (?, NULL, 'Confirmed', 'سارة خالد (مراجعة المدفوعات)', 'تم تأكيد تحويل InstaPay', ?)`).run(o3, now);
    db.prepare(`INSERT INTO order_status_history (order_id, previous_status, new_status, employee_name, notes, created_at) VALUES (?, 'Confirmed', 'Shipped', 'كريم عادل (مدير الشحن)', 'تم تسليم الشحنة لشركة Bosta', ?)`).run(o3, now);
    db.prepare(`INSERT INTO audit_logs (order_id, order_number, employee_name, employee_role, action_type, details, created_at) VALUES (?, 'YUOP-1003', 'كريم عادل (مدير الشحن)', 'Shipping Manager', 'تحديث بيانات الشحن', 'شركة Bosta — رقم التتبع BST-884120', ?)`).run(o3, now);
  }

  // 6. صفحات الهبوط التسويقية الافتراضية
  const lpCount = (db.prepare('SELECT COUNT(*) as c FROM landing_pages').get() as { c: number }).c;
  if (lpCount === 0) {
    const insertLp = db.prepare(`
      INSERT INTO landing_pages (
        slug, title_ar, title_en, kicker_ar, kicker_en, subtitle_ar, subtitle_en,
        hero_image_url, cta_text_ar, cta_text_en, theme_style,
        highlights_json, featured_product_ids_json, is_published, show_in_footer, views_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)
    `);

    insertLp.run(
      'drop-04-fw26',
      'إصدار الشتاء الثقيل FW26',
      'DROP 04 // ARCHITECTURAL FLEECE',
      'حملة حصرية · كمية محدودة',
      'LIMITED CAMPAIGN · FW26',
      'تشكيلة محدودة من هوديز 480 GSM وكارجو ريبستوب بقصّات أوفرسايز مرسومة يدويًا في القاهرة.',
      'Limited edition 480 GSM enzyme-washed fleece hoodies and technical ripstop cargos.',
      '/src/assets/images/hero_yuop_editorial_1794551310693.jpg',
      'اطلب قطع الإصدار الآن',
      'Shop Drop 04 Pieces',
      'dark',
      JSON.stringify([
        'قطن مصري ثقيل 480 GSM مقاوم للانكماش',
        'غسيل إنزيمي فحمي وتفاصيل خياطة مزدوجة',
        'شحن سريع خلال 48 ساعة مع متابعة عبر واتساب',
      ]),
      JSON.stringify([1, 3, 4]),
      now,
      now
    );

    insertLp.run(
      'heavyweight-essentials',
      'أساسيات الستريت وير اليومية',
      'HEAVYWEIGHT URBAN ESSENTIALS',
      'كبسولة الأساسيات',
      'CORE CAPSULE // ESSENTIALS',
      'تيشيرتات 300 GSM بياقة مضلعة سميكة وقصات مريحة تدوم طويلًا للتنسيق اليومي.',
      '300 GSM combed cotton boxy tees and daily silhouettes built for daily rotation.',
      '/src/assets/images/cat_tees_editorial_1794551311360.jpg',
      'تصفح الكبسولة الأساسية',
      'Explore Essentials',
      'light',
      JSON.stringify([
        'سنجل جيرسي 300 GSM غير شفاف وثابت القصة',
        'ياقة مضلعة بسمك 2.8 سم لا ترتخي مع الغسيل',
        'متاح خصم 10% بكود YUOP10 للطلبات فوق 1000 ج.م',
      ]),
      JSON.stringify([2, 5, 6]),
      now,
      now
    );
  }

  // 7. روابط السوشيال ميديا الافتراضية
  const socialCount = (db.prepare('SELECT COUNT(*) as c FROM social_links').get() as { c: number }).c;
  if (socialCount === 0) {
    const insertSocial = db.prepare(`
      INSERT INTO social_links (platform, label, handle, url, sort_order, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    insertSocial.run('instagram', 'Instagram', '@yuop.streetwear', 'https://instagram.com/yuop.streetwear', 1, now);
    insertSocial.run('tiktok', 'TikTok', '@yuop.eg', 'https://tiktok.com/@yuop.eg', 2, now);
    insertSocial.run('whatsapp', 'WhatsApp', '01099887766', 'https://wa.me/201099887766', 3, now);
    insertSocial.run('facebook', 'Facebook', 'YUOP Streetwear', 'https://facebook.com/yuop.streetwear', 4, now);
  }

  // 8. أكواد الخصم الافتراضية
  const promoCount = (db.prepare('SELECT COUNT(*) as c FROM promo_codes').get() as { c: number }).c;
  if (promoCount === 0) {
    const insertPromo = db.prepare(`
      INSERT INTO promo_codes (code, discount_type, discount_value, min_order_amount, max_uses, used_count, is_active, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, 0, 1, NULL, ?)
    `);
    insertPromo.run('YUOP10', 'percent', 10, 1000, 200, now);
    insertPromo.run('DROP150', 'fixed', 150, 2000, 100, now);
  }
}

export function mapProductRow(row: Record<string, unknown>): Product {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name_ar: String(row.name_ar),
    name_en: String(row.name_en),
    category: String(row.category),
    price: Number(row.price),
    compare_at_price: row.compare_at_price !== null ? Number(row.compare_at_price) : null,
    description_ar: String(row.description_ar),
    description_en: String(row.description_en),
    fabric_details: String(row.fabric_details),
    image_url: String(row.image_url),
    secondary_image_url: row.secondary_image_url ? String(row.secondary_image_url) : null,
    sizes_stock: JSON.parse(String(row.sizes_stock || '{}')) as Record<string, number>,
    is_featured: Boolean(row.is_featured),
    is_active: Boolean(row.is_active),
    badge_text: row.badge_text ? String(row.badge_text) : null,
    created_at: String(row.created_at),
  };
}

export function mapStoreSettingsRow(row: Record<string, unknown>): StoreSettings {
  return {
    id: Number(row.id),
    store_name: String(row.store_name),
    tagline_ar: String(row.tagline_ar),
    tagline_en: String(row.tagline_en),
    announcement_enabled: Boolean(row.announcement_enabled),
    announcement_text_ar: String(row.announcement_text_ar),
    announcement_text_en: String(row.announcement_text_en),
    hero_kicker_ar: String(row.hero_kicker_ar),
    hero_kicker_en: String(row.hero_kicker_en),
    hero_title_ar: String(row.hero_title_ar),
    hero_title_en: String(row.hero_title_en),
    hero_subtitle_ar: String(row.hero_subtitle_ar),
    hero_subtitle_en: String(row.hero_subtitle_en),
    hero_cta_ar: String(row.hero_cta_ar),
    hero_cta_en: String(row.hero_cta_en),
    hero_image_url: String(row.hero_image_url),
    accent_color: String(row.accent_color),
    default_theme: (String(row.default_theme || 'light') === 'dark' ? 'dark' : 'light') as ThemeMode,
    currency_code: String(row.currency_code),
    currency_symbol_ar: String(row.currency_symbol_ar),
    shipping_fee: Number(row.shipping_fee),
    free_shipping_threshold: Number(row.free_shipping_threshold),
    support_whatsapp: String(row.support_whatsapp),
    support_email: String(row.support_email),
    vodafone_cash_number: String(row.vodafone_cash_number),
    vodafone_cash_instructions_ar: String(row.vodafone_cash_instructions_ar),
    instapay_address: String(row.instapay_address),
    instapay_instructions_ar: String(row.instapay_instructions_ar),
    cod_enabled: Boolean(row.cod_enabled),
    vodafone_enabled: Boolean(row.vodafone_enabled),
    instapay_enabled: Boolean(row.instapay_enabled),
    footer_about_ar: String(row.footer_about_ar),
    footer_about_en: String(row.footer_about_en),
    updated_at: String(row.updated_at),
  };
}

export function mapTemplateRow(row: Record<string, unknown>): NotificationTemplate {
  return {
    id: Number(row.id),
    template_key: String(row.template_key),
    title_ar: String(row.title_ar),
    description_ar: String(row.description_ar),
    body: String(row.body),
    is_enabled: Boolean(row.is_enabled),
    meta_template_name: row.meta_template_name ? String(row.meta_template_name) : null,
    updated_at: String(row.updated_at),
  };
}

export function mapLandingPageRow(row: Record<string, unknown>): LandingPage {
  let highlights: string[] = [];
  let featuredProductIds: number[] = [];
  try {
    highlights = JSON.parse(String(row.highlights_json || '[]')) as string[];
  } catch {
    highlights = [];
  }
  try {
    featuredProductIds = JSON.parse(String(row.featured_product_ids_json || '[]')) as number[];
  } catch {
    featuredProductIds = [];
  }
  return {
    id: Number(row.id),
    slug: String(row.slug),
    title_ar: String(row.title_ar),
    title_en: String(row.title_en),
    kicker_ar: String(row.kicker_ar),
    kicker_en: String(row.kicker_en),
    subtitle_ar: String(row.subtitle_ar),
    subtitle_en: String(row.subtitle_en),
    hero_image_url: String(row.hero_image_url),
    cta_text_ar: String(row.cta_text_ar),
    cta_text_en: String(row.cta_text_en),
    theme_style: (String(row.theme_style || 'dark') === 'light' ? 'light' : 'dark') as ThemeMode,
    highlights: Array.isArray(highlights) ? highlights : [],
    featured_product_ids: Array.isArray(featuredProductIds) ? featuredProductIds.map(Number) : [],
    is_published: Boolean(row.is_published),
    show_in_footer: Boolean(row.show_in_footer),
    views_count: Number(row.views_count || 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function mapSocialLinkRow(row: Record<string, unknown>): SocialLink {
  return {
    id: Number(row.id),
    platform: String(row.platform) as SocialPlatform,
    label: String(row.label),
    handle: row.handle ? String(row.handle) : null,
    url: String(row.url),
    sort_order: Number(row.sort_order || 0),
    is_active: Boolean(row.is_active),
    updated_at: String(row.updated_at),
  };
}

export function mapPromoCodeRow(row: Record<string, unknown>): PromoCode {
  return {
    id: Number(row.id),
    code: String(row.code),
    discount_type: String(row.discount_type) === 'fixed' ? 'fixed' : 'percent',
    discount_value: Number(row.discount_value),
    min_order_amount: Number(row.min_order_amount || 0),
    max_uses: row.max_uses !== null && row.max_uses !== undefined ? Number(row.max_uses) : null,
    used_count: Number(row.used_count || 0),
    is_active: Boolean(row.is_active),
    expires_at: row.expires_at ? String(row.expires_at) : null,
    created_at: String(row.created_at),
  };
}

export function parseStaffPermissions(raw: unknown): Permission[] | null {
  if (!raw) return null;
  try {
    return JSON.parse(String(raw)) as Permission[];
  } catch {
    return null;
  }
}

export function castStaffRole(raw: unknown): StaffRole {
  return String(raw) as StaffRole;
}

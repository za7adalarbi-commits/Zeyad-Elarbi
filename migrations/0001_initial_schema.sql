-- ============================================================================
-- YUOP Streetwear — Cloudflare D1 Initial Schema (0001_initial_schema.sql)
-- متوافق بالكامل مع Cloudflare D1 (SQLite) وجميع جداول النظام + أمان الجلسات والبريد
-- ============================================================================

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

CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff ON staff_sessions(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_expires ON staff_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  rate_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  locked_until TEXT
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
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

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

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

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

CREATE INDEX IF NOT EXISTS idx_receipts_order ON payment_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_file_path ON payment_receipts(file_path);

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

CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_status_history(order_id);

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
  message_type TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_wa_messages_order ON whatsapp_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_meta_id ON whatsapp_messages(meta_message_id);

CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL
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

CREATE INDEX IF NOT EXISTS idx_audit_logs_order ON audit_logs(order_id);

CREATE TABLE IF NOT EXISTS landing_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  kicker_ar TEXT NOT NULL DEFAULT '',
  kicker_en TEXT NOT NULL DEFAULT '',
  subtitle_ar TEXT NOT NULL DEFAULT '',
  subtitle_en TEXT NOT NULL DEFAULT '',
  hero_image_url TEXT NOT NULL,
  cta_text_ar TEXT NOT NULL DEFAULT 'اكتشف التشكيلة',
  cta_text_en TEXT NOT NULL DEFAULT 'Explore Drop',
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
  discount_type TEXT NOT NULL DEFAULT 'percent',
  discount_value REAL NOT NULL,
  min_order_amount REAL NOT NULL DEFAULT 0,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL
);

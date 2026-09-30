-- One-time database setup for the iSelectStore backend (Neon Postgres).
-- Run this SQL once after creating the database / connecting Neon.
-- Bestaande tabellen (marktplaats_*, sold_image_*) worden hier opgenomen
-- zodat een nieuwe database in één keer volledig ingericht kan worden.

-- =============================================================================
-- Marktplaats-integratie
-- =============================================================================

CREATE TABLE IF NOT EXISTS marktplaats_connection (
  id SERIAL PRIMARY KEY,
  environment VARCHAR(20) NOT NULL DEFAULT 'mock',
  connected BOOLEAN NOT NULL DEFAULT false,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  scope TEXT,
  last_successful_call_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marktplaats_category_mapping (
  shopify_product_type VARCHAR(100) PRIMARY KEY,
  marktplaats_l1_category_id VARCHAR(100) NOT NULL,
  marktplaats_l1_category_name VARCHAR(255),
  marktplaats_l2_category_id VARCHAR(100) NOT NULL,
  marktplaats_l2_category_name VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marktplaats_attribute_mapping (
  marktplaats_l2_category_id VARCHAR(100) NOT NULL,
  internal_field VARCHAR(100) NOT NULL,
  marktplaats_attribute_key VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (marktplaats_l2_category_id, internal_field)
);

CREATE TABLE IF NOT EXISTS marktplaats_attribute_cache (
  marktplaats_l2_category_id VARCHAR(100) PRIMARY KEY,
  attributes_json JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  ttl_seconds INTEGER NOT NULL DEFAULT 86400,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marktplaats_product (
  shopify_product_id VARCHAR(64) PRIMARY KEY,
  product_type VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  marktplaats_advertisement_id VARCHAR(255),
  sync_hash VARCHAR(255),
  custom_title TEXT,
  custom_description TEXT,
  sold_behavior VARCHAR(50) NOT NULL DEFAULT 'manual',
  sold_keep_days INTEGER,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marktplaats_sync_log (
  id SERIAL PRIMARY KEY,
  shopify_product_id VARCHAR(64),
  marktplaats_advertisement_id VARCHAR(255),
  test_advertisement_id VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  api_operation VARCHAR(255),
  http_status INTEGER,
  error_code VARCHAR(255),
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marktplaats_sync_log_product ON marktplaats_sync_log(shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_marktplaats_sync_log_created ON marktplaats_sync_log(created_at DESC);

CREATE TABLE IF NOT EXISTS marktplaats_integration_test (
  id SERIAL PRIMARY KEY,
  shopify_product_id VARCHAR(64) NOT NULL,
  test_advertisement_id VARCHAR(255) NOT NULL,
  is_test_advertisement BOOLEAN NOT NULL DEFAULT true,
  result VARCHAR(100) NOT NULL DEFAULT 'in_progress',
  cleaned_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- VERKOCHT-sticker feature
-- =============================================================================

CREATE TABLE IF NOT EXISTS sold_image_settings (
  id SERIAL PRIMARY KEY,
  mode VARCHAR(50) NOT NULL DEFAULT 'auto',
  delay_hours INTEGER NOT NULL DEFAULT 0,
  sticker_text VARCHAR(255) NOT NULL DEFAULT 'VERKOCHT',
  position VARCHAR(50) NOT NULL DEFAULT 'center',
  style VARCHAR(20) NOT NULL DEFAULT 'ribbon',
  size_percent INTEGER NOT NULL DEFAULT 60,
  opacity NUMERIC(3,2) NOT NULL DEFAULT 0.85,
  band_color_hex VARCHAR(7) NOT NULL DEFAULT '#dc2626',
  text_color_hex VARCHAR(7) NOT NULL DEFAULT '#ffffff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sold_image_settings (id, mode, delay_hours, sticker_text, position, style, size_percent, opacity, band_color_hex, text_color_hex)
VALUES (1, 'auto', 0, 'VERKOCHT', 'center', 'ribbon', 60, 0.85, '#dc2626', '#ffffff')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sold_image_state (
  shopify_product_id VARCHAR(64) PRIMARY KEY,
  original_image_id VARCHAR(64),
  original_image_src TEXT,
  sold_image_id VARCHAR(64),
  sold_image_src TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'none',
  out_of_stock_detected_at TIMESTAMPTZ,
  apply_after TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  restored_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- Voorraadmeldingen (nieuw)
-- =============================================================================

CREATE TABLE IF NOT EXISTS inventory_notification_subscriptions (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  product_type VARCHAR(100) NOT NULL,
  model VARCHAR(255) NOT NULL,
  storage VARCHAR(50) NOT NULL,
  signup_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  notified_at TIMESTAMPTZ,
  matched_product_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, product_type, model, storage)
);

CREATE INDEX IF NOT EXISTS idx_inventory_subscriptions_match
  ON inventory_notification_subscriptions(product_type, model, storage)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_inventory_subscriptions_email
  ON inventory_notification_subscriptions(email);

CREATE TABLE IF NOT EXISTS inventory_notification_history (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES inventory_notification_subscriptions(id) ON DELETE CASCADE,
  shopify_product_id VARCHAR(64) NOT NULL,
  product_title VARCHAR(500),
  product_handle VARCHAR(500),
  product_image_url TEXT,
  product_price DECIMAL(10,2),
  provider VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_notification_history_subscription
  ON inventory_notification_history(subscription_id);
CREATE INDEX IF NOT EXISTS idx_inventory_notification_history_product
  ON inventory_notification_history(shopify_product_id);

-- Idempotency guard: er kan nooit meer dan één (verzonden) melding bestaan
-- per abonnement per product. Dit is de database-level vangnet achter de
-- 'notifying'-lease op de subscription (webhook + cron tegelijk -> 1 mail).
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_notification_history
  ON inventory_notification_history(subscription_id, shopify_product_id);

-- =============================================================================
-- Product lifecycle: sold_at + 28-dagen cleanup (nieuw)
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_lifecycle (
  shopify_product_id VARCHAR(64) PRIMARY KEY,
  product_type VARCHAR(100),
  model VARCHAR(255),
  storage VARCHAR(50),
  inventory_quantity INTEGER,
  sold_at TIMESTAMPTZ,
  unpublished_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_lifecycle_sold_at
  ON product_lifecycle(sold_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_product_lifecycle_status
  ON product_lifecycle(status);

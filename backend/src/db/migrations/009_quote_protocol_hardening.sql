-- Migration 009: Machine-Readable Quote Protocol Hardening
-- Adds durable quotes table and quote association fields to purchase intents

CREATE TABLE IF NOT EXISTS quotes (
  id VARCHAR(100) PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(12, 2) NOT NULL,
  subtotal NUMERIC(12, 2) NOT NULL,
  delivery_fee NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  delivery_method VARCHAR(50) DEFAULT 'STANDARD',
  policy_version VARCHAR(50) DEFAULT 'v1.0',
  signature VARCHAR(255) NOT NULL,
  canonical_payload TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | CONSUMED | EXPIRED | CANCELLED
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_product ON quotes(product_id);
CREATE INDEX IF NOT EXISTS idx_quotes_merchant ON quotes(merchant_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status_expires ON quotes(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_quotes_user ON quotes(user_id);

ALTER TABLE purchase_intents ADD COLUMN IF NOT EXISTS quote_id VARCHAR(100);
ALTER TABLE purchase_intents ADD COLUMN IF NOT EXISTS quote_signature VARCHAR(255);
ALTER TABLE purchase_intents ADD COLUMN IF NOT EXISTS quote_payload JSONB;

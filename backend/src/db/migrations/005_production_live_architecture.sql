-- 005_production_live_architecture.sql
-- AgentPay: Production-Ready Live Mode Architecture & Test/Live Isolation

-- 1. Environment & Mode Isolation on Financial & Audit Records
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS environment VARCHAR(20) DEFAULT 'TEST';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'TEST';
CREATE INDEX IF NOT EXISTS idx_transactions_env_mode ON transactions(environment, payment_mode);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS environment VARCHAR(20) DEFAULT 'TEST';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'TEST';
CREATE INDEX IF NOT EXISTS idx_orders_env_mode ON orders(environment, payment_mode);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS environment VARCHAR(20) DEFAULT 'TEST';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'TEST';
CREATE INDEX IF NOT EXISTS idx_invoices_env_mode ON invoices(environment, payment_mode);

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS environment VARCHAR(20) DEFAULT 'TEST';
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'TEST';
CREATE INDEX IF NOT EXISTS idx_audit_events_env_mode ON audit_events(environment, payment_mode);

ALTER TABLE event_notifications ADD COLUMN IF NOT EXISTS environment VARCHAR(20) DEFAULT 'TEST';
ALTER TABLE event_notifications ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) DEFAULT 'TEST';

-- 2. Durable Webhook Inbox Table (Deduplication & Idempotent Processing)
CREATE TABLE IF NOT EXISTS webhook_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(120) UNIQUE NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'razorpay',
  environment VARCHAR(20) NOT NULL DEFAULT 'TEST', -- TEST | LIVE
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  processing_status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- PENDING | PROCESSED | FAILED | IGNORED
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_inbox_status ON webhook_inbox(processing_status, environment);

-- 3. Two-Phase Inventory Reservations (Overselling & Concurrency Protection)
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  quote_id VARCHAR(100),
  status VARCHAR(30) NOT NULL DEFAULT 'RESERVED', -- RESERVED | COMMITTED | RELEASED | EXPIRED
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_status ON inventory_reservations(product_id, status, expires_at);

-- 4. Merchant Verification & Settlement Configuration
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS verification_status VARCHAR(30) DEFAULT 'VERIFIED'; -- PENDING | UNDER_REVIEW | VERIFIED | SUSPENDED | REJECTED
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS legal_business_name VARCHAR(255);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS business_tax_id VARCHAR(100);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS settlement_account_ref VARCHAR(255);

-- 5. Merchant Settlements Table (Marketplace / Platform Payout Ledger)
CREATE TABLE IF NOT EXISTS merchant_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  settlement_status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- PENDING | PROCESSING | SETTLED | FAILED
  transfer_reference VARCHAR(255),
  settlement_method VARCHAR(50) DEFAULT 'RAZORPAY_ROUTE',
  environment VARCHAR(20) NOT NULL DEFAULT 'TEST',
  metadata JSONB DEFAULT '{}'::jsonb,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_merchant_settlements_env ON merchant_settlements(merchant_id, settlement_status, environment);

-- 6. Payment Disputes & Chargebacks Tracking
CREATE TABLE IF NOT EXISTS payment_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id VARCHAR(100) UNIQUE NOT NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  payment_id VARCHAR(255) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  reason VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'OPEN', -- OPEN | UNDER_REVIEW | WON | LOST | CLOSED
  environment VARCHAR(20) NOT NULL DEFAULT 'TEST',
  evidence JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

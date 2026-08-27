-- Migration 003: Production Performance Indexes, Constraints & State Enforcement

-- 1. Ensure state column exists on purchase_intents with default 'CREATED'
ALTER TABLE purchase_intents ADD COLUMN IF NOT EXISTS state VARCHAR(50) DEFAULT 'CREATED';

-- 2. Ensure merchant_id and payment details on transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS merchant_order_id VARCHAR(255);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMPTZ;

-- 3. Refunds Table if not exists
CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  purchase_intent_id UUID REFERENCES purchase_intents(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'INR',
  reason TEXT,
  provider_refund_id VARCHAR(255),
  status VARCHAR(30) DEFAULT 'REFUND_SUCCESS',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. User Merchant Connections Table if not exists
CREATE TABLE IF NOT EXISTS user_merchant_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  status VARCHAR(30) DEFAULT 'connected',
  account_identifier VARCHAR(255),
  auth_type VARCHAR(50) DEFAULT 'oauth2',
  credentials_ref VARCHAR(255),
  capabilities JSONB DEFAULT '{"search": true, "cart": true, "checkout": true, "autonomousPurchase": true, "orderTracking": true, "cancellation": true, "refunds": true}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, merchant_id)
);

-- 5. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_merchant_id ON users(merchant_id);

CREATE INDEX IF NOT EXISTS idx_products_merchant_id ON products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_products_in_stock ON products(in_stock);

CREATE INDEX IF NOT EXISTS idx_purchase_intents_user_id ON purchase_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_intents_merchant_id ON purchase_intents(merchant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_intents_status ON purchase_intents(status);
CREATE INDEX IF NOT EXISTS idx_purchase_intents_state ON purchase_intents(state);
CREATE INDEX IF NOT EXISTS idx_purchase_intents_created_at ON purchase_intents(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_purchase_intent_id ON transactions(purchase_intent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_user_id ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_merchants_is_verified ON merchants(is_verified);

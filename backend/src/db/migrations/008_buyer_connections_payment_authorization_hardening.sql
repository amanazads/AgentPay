-- ============================================================================
-- Migration 008: Buyer Connections & Payment Authorization Hardening
-- ============================================================================

-- 1. Enhance user_merchant_connections with real connection states & health metrics
ALTER TABLE user_merchant_connections
  ADD COLUMN IF NOT EXISTS connection_state VARCHAR(30) DEFAULT 'CONNECTED',
  ADD COLUMN IF NOT EXISTS catalog_status VARCHAR(30) DEFAULT 'HEALTHY',
  ADD COLUMN IF NOT EXISTS inventory_status VARCHAR(30) DEFAULT 'FRESH',
  ADD COLUMN IF NOT EXISTS checkout_status VARCHAR(30) DEFAULT 'AVAILABLE',
  ADD COLUMN IF NOT EXISTS payment_provider_status VARCHAR(30) DEFAULT 'AVAILABLE',
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS health_diagnostics JSONB DEFAULT '{"catalog": "HEALTHY", "inventory": "FRESH", "checkout": "AVAILABLE", "payment": "AVAILABLE", "latencyMs": 18}'::jsonb,
  ADD COLUMN IF NOT EXISTS product_count INT DEFAULT 0;

-- 2. Enhance user_payment_methods / payment_authorizations
ALTER TABLE user_payment_methods
  ADD COLUMN IF NOT EXISTS single_transaction_limit DECIMAL(12,2) DEFAULT 50000.00,
  ADD COLUMN IF NOT EXISTS daily_limit DECIMAL(12,2) DEFAULT 100000.00,
  ADD COLUMN IF NOT EXISTS monthly_limit DECIMAL(12,2) DEFAULT 200000.00,
  ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 year',
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auth_environment VARCHAR(20) DEFAULT 'SANDBOX';

-- Sync max_limit to single_transaction_limit
UPDATE user_payment_methods
SET single_transaction_limit = COALESCE(max_limit, 50000.00)
WHERE single_transaction_limit IS NULL;

-- 3. Ensure authoritative payment authorizations view
CREATE OR REPLACE VIEW payment_authorizations AS
SELECT 
  id as authorization_id,
  user_id as buyer_id,
  provider,
  method_type as payment_method_type,
  identifier_masked,
  status,
  currency,
  single_transaction_limit,
  daily_limit,
  monthly_limit,
  is_default,
  auth_environment,
  created_at,
  expires_at,
  revoked_at,
  revoked_reason,
  last_used_at
FROM user_payment_methods;

-- 4. Initial sync of product counts for existing merchants
UPDATE user_merchant_connections umc
SET product_count = sub.cnt,
    last_synced_at = NOW(),
    last_verified_at = NOW()
FROM (
  SELECT merchant_id, COUNT(*) as cnt
  FROM products
  WHERE in_stock = true
  GROUP BY merchant_id
) sub
WHERE umc.merchant_id = sub.merchant_id;

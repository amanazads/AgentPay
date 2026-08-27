-- ============================================================================
-- Migration 012: Merchant Connector Credentials & Security Hardening
-- Adds hashed credential storage, last4 fingerprints, and health check tracking
-- ============================================================================

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS api_key_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS api_key_last4 VARCHAR(8),
  ADD COLUMN IF NOT EXISTS webhook_secret_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS webhook_secret_last4 VARCHAR(8),
  ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_webhook_delivery_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS webhook_endpoint_url TEXT,
  ADD COLUMN IF NOT EXISTS connector_status VARCHAR(20) DEFAULT 'CONNECTED';

-- Initialize default last4 fingerprints for existing merchants if empty
UPDATE merchants
SET api_key_last4 = COALESCE(api_key_last4, SUBSTRING(REPLACE(id::text, '-', ''), 1, 4)),
    webhook_secret_last4 = COALESCE(webhook_secret_last4, SUBSTRING(REPLACE(id::text, '-', ''), 5, 4)),
    last_health_check_at = COALESCE(last_health_check_at, NOW()),
    connector_status = 'CONNECTED'
WHERE api_key_last4 IS NULL OR webhook_secret_last4 IS NULL;

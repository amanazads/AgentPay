-- ============================================================================
-- Migration 011: Order Ledger, Inventory & Idempotency Hardening
-- Adds canonical order references, cancellation semantics, and uniqueness guarantees
-- ============================================================================

-- 1. Add canonical fields to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS quote_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS previous_status VARCHAR(50);

-- 2. Enforce strict 1-to-1 Intent -> Transaction -> Order database uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_purchase_intent_unique 
  ON orders(purchase_intent_id) 
  WHERE purchase_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_transaction_unique 
  ON orders(transaction_id) 
  WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_intents_idempotency_unique 
  ON purchase_intents(idempotency_key) 
  WHERE idempotency_key IS NOT NULL;

-- 3. Add index on orders by merchant and fulfillment status
CREATE INDEX IF NOT EXISTS idx_orders_merchant_fulfillment 
  ON orders(merchant_id, fulfillment_status);

-- 4. Mark any anomalous historical test orders on out-of-stock items as DATA_INTEGRITY_EXCEPTION
UPDATE orders
SET order_status = 'BLOCKED_INTEGRITY_EXCEPTION',
    fulfillment_status = 'CANCELLED',
    settlement_status = 'VOIDED_INSUFFICIENT_STOCK',
    cancellation_reason = 'INVENTORY_INTEGRITY_VIOLATION: Attempted checkout on zero-stock SKU'
WHERE product_name ILIKE '%Out of Stock%' 
   OR product_sku ILIKE '%OUTSTOCK%'
   OR product_id IN (SELECT id FROM products WHERE in_stock = false AND inventory = 0);

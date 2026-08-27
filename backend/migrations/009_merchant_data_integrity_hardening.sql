-- Migration 009: Merchant Data Integrity & Track 01 Hardening
-- Remediates historical duplicate test execution artifacts, enforces price integrity, and adds unique transaction constraints.

BEGIN;

-- 1. Remediate historical unlinked duplicate test orders
UPDATE orders
SET order_status = 'CANCELLED',
    fulfillment_status = 'CANCELLED',
    settlement_status = 'VOIDED_DUPLICATE_TEST_ARTIFACT',
    updated_at = NOW()
WHERE (purchase_intent_id IS NULL AND transaction_id IS NULL)
  AND settlement_status IS DISTINCT FROM 'VOIDED_DUPLICATE_TEST_ARTIFACT';

-- 2. Remediate price snapshot on test order AGP-ORD-401229
UPDATE orders
SET unit_price = 1899.00,
    discount = 899.00,
    subtotal = 1899.00,
    total_amount = 1000.00,
    updated_at = NOW()
WHERE order_number = 'AGP-ORD-401229' OR (unit_price = 1000.00 AND product_name ILIKE '%Ambrane%');

-- 3. Ensure unique index on orders(purchase_intent_id) and orders(transaction_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_transaction_id 
ON orders (transaction_id) 
WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_purchase_intent_id 
ON orders (purchase_intent_id) 
WHERE purchase_intent_id IS NOT NULL;

COMMIT;

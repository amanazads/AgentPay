-- Migration 006: Strict Financial Idempotency & Unique Order/Payment Constraints

-- 1. Ensure unique orders per transaction and purchase intent
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_transaction 
ON orders (transaction_id) 
WHERE transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_purchase_intent 
ON orders (purchase_intent_id) 
WHERE purchase_intent_id IS NOT NULL;

-- 2. Ensure unique transactions per purchase intent
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_purchase_intent 
ON transactions (purchase_intent_id) 
WHERE purchase_intent_id IS NOT NULL;

-- 3. Ensure unique invoices per order
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique_order 
ON invoices (order_id) 
WHERE order_id IS NOT NULL;

-- 4. Ensure unique webhook events per provider event ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_inbox_unique_provider_event 
ON webhook_inbox (provider_event_id) 
WHERE provider_event_id IS NOT NULL;

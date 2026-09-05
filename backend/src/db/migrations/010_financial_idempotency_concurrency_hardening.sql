-- Migration 010: Financial Idempotency & Concurrency Hardening
-- Adds unique constraints for payment references, orders, and webhook events

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_razorpay_order 
ON transactions (razorpay_order_id) 
WHERE razorpay_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_razorpay_payment 
ON transactions (razorpay_payment_id) 
WHERE razorpay_payment_id IS NOT NULL;

-- orders.quote_id is required by the index below but was never added by an
-- earlier migration (orders is created in 004 without it), so a fresh database
-- aborted here. ADD COLUMN IF NOT EXISTS is a no-op on databases that already
-- have the column, so this is safe to apply everywhere.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quote_id VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_quote 
ON orders (quote_id) 
WHERE quote_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique_payment_ref 
ON invoices (payment_reference) 
WHERE payment_reference IS NOT NULL;

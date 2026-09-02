-- Migration 010: Financial Idempotency & Concurrency Hardening
-- Adds unique constraints for payment references, orders, and webhook events

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_razorpay_order 
ON transactions (razorpay_order_id) 
WHERE razorpay_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_razorpay_payment 
ON transactions (razorpay_payment_id) 
WHERE razorpay_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_quote 
ON orders (quote_id) 
WHERE quote_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique_payment_ref 
ON invoices (payment_reference) 
WHERE payment_reference IS NOT NULL;

-- 016_fulfillment_truthfulness.sql
-- AgentPay: Truthful Fulfillment Lifecycle & Decoupled Carrier Assignment

-- 0. Schema repair: createOrder() inserts these columns, but no migration ever
-- created them, so on a fresh database EVERY order insert failed and this
-- migration aborted on the missing fulfillment_status. All guarded with
-- IF NOT EXISTS, so databases that already have them are untouched.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_status VARCHAR(50) DEFAULT 'CONFIRMED';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_status  VARCHAR(50) DEFAULT 'PENDING';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_name       VARCHAR(500);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_sku        VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_brand      VARCHAR(200);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_category   VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_status ON orders (fulfillment_status);

-- 1. Remove deceptive default carrier assignment on order creation
ALTER TABLE orders ALTER COLUMN carrier DROP DEFAULT;

-- 2. Clear carrier on unfulfilled orders where carrier was deceptively pre-assigned
UPDATE orders 
SET carrier = NULL 
WHERE carrier = 'AgentPay Express Logistics' 
  AND fulfillment_status IN ('CONFIRMED', 'PROCESSING', 'PACKED');

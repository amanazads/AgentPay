-- 016_fulfillment_truthfulness.sql
-- AgentPay: Truthful Fulfillment Lifecycle & Decoupled Carrier Assignment

-- 1. Remove deceptive default carrier assignment on order creation
ALTER TABLE orders ALTER COLUMN carrier DROP DEFAULT;

-- 2. Clear carrier on unfulfilled orders where carrier was deceptively pre-assigned
UPDATE orders 
SET carrier = NULL 
WHERE carrier = 'AgentPay Express Logistics' 
  AND fulfillment_status IN ('CONFIRMED', 'PROCESSING', 'PACKED');

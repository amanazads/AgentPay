-- Migration 011: Two-Phase Inventory Reservation Hardening

-- 1. Ensure updated_at column on inventory_reservations
ALTER TABLE inventory_reservations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- 1b. products.inventory is read by the candidate-filter, pricing, quote,
-- policy, purchase-gate and inventory services, but no migration ever created
-- it. On a fresh database every quote failed closed with OUT_OF_STOCK and this
-- migration itself aborted. Create it here, before the CHECK constraint that
-- depends on it. Databases that already have the column are unaffected.
ALTER TABLE products ADD COLUMN IF NOT EXISTS inventory INTEGER NOT NULL DEFAULT 0;

-- Backfill legacy rows: a product already flagged in_stock but carrying no
-- inventory figure is given a nominal catalog quantity so it stays
-- transactable. Rows explicitly out of stock remain at 0.
UPDATE products SET inventory = 25 WHERE in_stock = TRUE AND inventory = 0;

-- 2. Ensure inventory is mathematically non-negative
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_inventory_non_negative'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT chk_products_inventory_non_negative CHECK (inventory >= 0);
  END IF;
END $$;

-- 3. Indexes for high-concurrency reservation queries
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_active 
ON inventory_reservations (product_id, status, expires_at) 
WHERE status = 'RESERVED';

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_quote_id 
ON inventory_reservations (quote_id) 
WHERE quote_id IS NOT NULL;

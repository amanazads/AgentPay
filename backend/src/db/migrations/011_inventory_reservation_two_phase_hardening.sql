-- Migration 011: Two-Phase Inventory Reservation Hardening

-- 1. Ensure updated_at column on inventory_reservations
ALTER TABLE inventory_reservations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

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

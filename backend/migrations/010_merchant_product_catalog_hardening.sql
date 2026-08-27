-- Migration 010: Merchant Product Catalog Hardening
-- Adds product lifecycle status, catalog versioning, SKU standardization, and structured specifications.

BEGIN;

-- 1. Add status and catalog_version columns to products table if not existing
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE',
ADD COLUMN IF NOT EXISTS catalog_version INT DEFAULT 1;

-- 2. Populate standardized SKUs where missing
UPDATE products
SET sku = 'SKU-' || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 8))
WHERE sku IS NULL OR sku = '';

-- 3. Populate default specifications for items with empty specs
UPDATE products
SET specifications = jsonb_build_object(
  'brand', COALESCE(brand, 'Standard Hardware'),
  'category', COALESCE(category, 'Electronics'),
  'warranty', '1 Year Official Manufacturer Warranty',
  'return_policy', '7 Days Replacement Policy',
  'fast_dispatch', true
)
WHERE specifications IS NULL OR specifications = '{}'::jsonb;

-- 4. Index on merchant_id and status for fast catalog queries
CREATE INDEX IF NOT EXISTS idx_products_merchant_status ON products (merchant_id, status);

COMMIT;

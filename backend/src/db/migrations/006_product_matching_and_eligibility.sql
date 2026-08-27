-- ============================================================================
-- Migration 006: Product Matching & Commerce Eligibility Architecture
-- Author: Principal AI/Commerce Engineer
-- Date: 2026-08-26
-- Description:
--   1. Adds commerce_eligible, product_type, sku, and attributes to products table.
--   2. Enforces strict isolation between test lab fixtures and production commerce.
--   3. Seeds verified power bank inventory for authentic procurement.
-- ============================================================================

-- 1. Schema Extensions for Products Table
ALTER TABLE products ADD COLUMN IF NOT EXISTS commerce_eligible BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS attributes JSONB DEFAULT '{}'::jsonb;

-- Indexes for lightning-fast candidate filtering
CREATE INDEX IF NOT EXISTS idx_products_commerce_eligible ON products(commerce_eligible);
CREATE INDEX IF NOT EXISTS idx_products_product_type ON products(product_type);
CREATE INDEX IF NOT EXISTS idx_products_is_test_lab ON products(is_test_lab);

-- 2. Mark all test lab fixtures as strictly INELIGIBLE for production commerce
UPDATE products 
SET is_test_lab = true, commerce_eligible = false 
WHERE name ILIKE 'Test %' 
   OR name ILIKE 'Fake %' 
   OR name ILIKE 'Safety Test %'
   OR category = 'test_lab';

-- 3. Populate product_type on existing catalog items
UPDATE products SET product_type = 'headphones' WHERE name ILIKE '%headphone%' OR name ILIKE '%wh-1000xm5%' OR name ILIKE '%quietcomfort%' OR name ILIKE '%accentum%';
UPDATE products SET product_type = 'laptop' WHERE name ILIKE '%macbook%' OR name ILIKE '%laptop%' OR name ILIKE '%tuf%' OR name ILIKE '%zephyrus%' OR name ILIKE '%xps%';
UPDATE products SET product_type = 'monitor' WHERE name ILIKE '%monitor%' OR name ILIKE '%display%' OR name ILIKE '%ultrasharp%' OR name ILIKE '%ultrafine%';
UPDATE products SET product_type = 'mouse' WHERE name ILIKE '%mouse%' OR name ILIKE '%mx master%';
UPDATE products SET product_type = 'keyboard' WHERE name ILIKE '%keyboard%' OR name ILIKE '%keychron%';
UPDATE products SET product_type = 'power_bank' WHERE name ILIKE '%power bank%' OR name ILIKE '%powercore%';
UPDATE products SET product_type = 'chair' WHERE name ILIKE '%chair%' OR name ILIKE '%aeron%';
UPDATE products SET product_type = 'desk' WHERE name ILIKE '%desk%';
UPDATE products SET product_type = 'smartphone' WHERE name ILIKE '%iphone%' OR name ILIKE '%galaxy%';
UPDATE products SET product_type = 'dock' WHERE name ILIKE '%dock%' OR name ILIKE '%caldigit%';
UPDATE products SET product_type = 'software' WHERE name ILIKE '%license%' OR name ILIKE '%figma%' OR name ILIKE '%jetbrains%';

-- 4. Seed Verified, Authoritative Power Banks for Verified Merchants (e.g. Mi 20000mAh, Anker 20000mAh)
DO $$
DECLARE
  v_merch_id UUID;
BEGIN
  SELECT id INTO v_merch_id FROM merchants WHERE name ILIKE '%AgentPay Demo Store%' OR is_verified = true LIMIT 1;
  
  IF v_merch_id IS NOT NULL THEN
    -- Product A: Mi 20000mAh 18W Fast Charge Power Bank 3i (₹2,199)
    IF NOT EXISTS (SELECT 1 FROM products WHERE name = 'Mi 20000mAh 18W Fast Charge Power Bank 3i') THEN
      INSERT INTO products (
        merchant_id, name, description, category, product_type, brand, price, original_price,
        in_stock, inventory, is_test_lab, commerce_eligible, specifications, attributes, image_url
      ) VALUES (
        v_merch_id,
        'Mi 20000mAh 18W Fast Charge Power Bank 3i',
        'High-density 20,000mAh lithium-polymer power bank with 18W dual-direction fast charging and triple port output for multi-device charging.',
        'Electronics',
        'power_bank',
        'Xiaomi',
        2199.00,
        2499.00,
        true,
        45,
        false,
        true,
        '{"capacity": "20000mAh", "capacity_mah": 20000, "fast_charge": "18W", "ports": "Triple Output (2 USB-A, 1 Type-C)", "weight": "434g"}'::jsonb,
        '{"capacity_mah": 20000, "output_watts": 18, "port_count": 3, "fast_charging": true}'::jsonb,
        'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=500&q=80'
      );
    END IF;

    -- Product B: Anker 325 Power Bank (PowerCore 20K II, 15W High Capacity) (₹3,499)
    IF NOT EXISTS (SELECT 1 FROM products WHERE name = 'Anker 325 Power Bank (PowerCore 20K II, 15W Fast Charge)') THEN
      INSERT INTO products (
        merchant_id, name, description, category, product_type, brand, price, original_price,
        in_stock, inventory, is_test_lab, commerce_eligible, specifications, attributes, image_url
      ) VALUES (
        v_merch_id,
        'Anker 325 Power Bank (PowerCore 20K II, 15W Fast Charge)',
        'Anker ultra-high capacity 20,000mAh portable charger with PowerIQ and VoltageBoost technology for optimized simultaneous charging.',
        'Electronics',
        'power_bank',
        'Anker',
        3499.00,
        3999.00,
        true,
        30,
        false,
        true,
        '{"capacity": "20000mAh", "capacity_mah": 20000, "fast_charge": "15W PowerIQ", "ports": "Dual USB-A Output", "weight": "465g"}'::jsonb,
        '{"capacity_mah": 20000, "output_watts": 15, "port_count": 2, "fast_charging": true}'::jsonb,
        'https://images.unsplash.com/photo-1594818379496-da1e345b0ded?w=500&q=80'
      );
    END IF;

    -- Product C: Ambrane 20000mAh 22.5W Fast Charging Power Bank (Stylo 20k) (₹1,899)
    IF NOT EXISTS (SELECT 1 FROM products WHERE name = 'Ambrane 20000mAh 22.5W Fast Charging Power Bank (Stylo 20k)') THEN
      INSERT INTO products (
        merchant_id, name, description, category, product_type, brand, price, original_price,
        in_stock, inventory, is_test_lab, commerce_eligible, specifications, attributes, image_url
      ) VALUES (
        v_merch_id,
        'Ambrane 20000mAh 22.5W Fast Charging Power Bank (Stylo 20k)',
        'Made-in-India 20,000mAh power bank featuring Quick Charge 3.0, 22.5W Power Delivery output, and multi-layer chipset protection.',
        'Electronics',
        'power_bank',
        'Ambrane',
        1899.00,
        2299.00,
        true,
        60,
        false,
        true,
        '{"capacity": "20000mAh", "capacity_mah": 20000, "fast_charge": "22.5W PD", "ports": "Dual USB + Type C", "weight": "410g"}'::jsonb,
        '{"capacity_mah": 20000, "output_watts": 22.5, "port_count": 3, "fast_charging": true}'::jsonb,
        'https://images.unsplash.com/photo-1622445262464-84b1456045b6?w=500&q=80'
      );
    END IF;
  END IF;
END $$;

-- 017_schema_repair_and_eligibility_backfill.sql
-- =============================================================================
-- AgentPay: Schema Repair + Canonical Catalog Eligibility Backfill
--
-- PART A — SCHEMA REPAIR
-- Several columns and one table are read (and written) by the application but
-- were never created by any migration. On a freshly provisioned database this
-- meant:
--   * products.brand missing  -> every brand-constrained search returned
--                                NO_MATCH, because candidateFilter compares
--                                against an undefined column.
--   * merchants.tier missing  -> the AI catalog query and merchant adapter
--                                failed outright.
--   * in_app_notifications    -> notification writes threw on every purchase.
-- Everything here is guarded with IF NOT EXISTS and is a no-op on databases
-- that already have these objects.
--
-- PART B — ELIGIBILITY BACKFILL (fail-closed)
-- The AI commerce catalog must be decided by one canonical predicate:
--     is_test_lab = false AND status = 'ACTIVE'
--     AND commerce_eligible = true AND in_stock = true
-- NULL in any of these columns previously read as "not excluded", i.e. NULL was
-- implicitly trusted. This migration backfills NULLs to explicit safe values and
-- then makes the columns NOT NULL with defaults, so the ambiguity cannot recur.
-- =============================================================================

-- ─── PART A: SCHEMA REPAIR ───────────────────────────────────────────────────

-- Product brand: a first-class, filterable catalog attribute.
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(200);

-- Backfill brand from the structured specifications blob where the merchant
-- already supplied one. Left NULL when unknown — we do not invent a brand.
UPDATE products
SET brand = NULLIF(TRIM(specifications ->> 'brand'), '')
WHERE brand IS NULL
  AND specifications ? 'brand'
  AND NULLIF(TRIM(specifications ->> 'brand'), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_brand ON products (LOWER(brand));

-- Merchant tier, read by the AI catalog feed and the merchant adapter.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS tier VARCHAR(50) DEFAULT 'tier_1';
UPDATE merchants SET tier = 'tier_1' WHERE tier IS NULL;

-- Legacy in-app notification inbox written by notificationService and
-- notificationDispatcher.
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type  VARCHAR(100) NOT NULL,
  title       VARCHAR(255),
  message     TEXT,
  metadata    JSONB DEFAULT '{}'::jsonb,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user
  ON in_app_notifications (user_id, is_read, created_at DESC);

-- ─── PART B: CANONICAL ELIGIBILITY COLUMNS ───────────────────────────────────

-- Lifecycle status. ACTIVE is the only value eligible for AI commerce;
-- INACTIVE and ARCHIVED are excluded by the canonical predicate.
ALTER TABLE products ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE';

-- Backfill: rows that predate this column are treated as ACTIVE only if they
-- are not test-lab fixtures. Test-lab rows are explicitly parked as INACTIVE
-- so they can never leak into the production catalog.
UPDATE products SET status = 'ACTIVE'   WHERE status IS NULL AND COALESCE(is_test_lab, FALSE) = FALSE;
UPDATE products SET status = 'INACTIVE' WHERE status IS NULL;

-- Fail-closed NULL backfill on the remaining eligibility columns.
-- NULL is NOT trusted: an unknown test-lab flag becomes TRUE (excluded), an
-- unknown commerce eligibility becomes FALSE (excluded), unknown stock becomes
-- FALSE (excluded). A merchant must positively assert eligibility.
UPDATE products SET is_test_lab       = TRUE  WHERE is_test_lab IS NULL;
UPDATE products SET commerce_eligible = FALSE WHERE commerce_eligible IS NULL;
UPDATE products SET in_stock          = FALSE WHERE in_stock IS NULL;
UPDATE products SET inventory         = 0     WHERE inventory IS NULL;

-- Lock the invariants in so NULL cannot return.
ALTER TABLE products ALTER COLUMN status            SET DEFAULT 'ACTIVE';
ALTER TABLE products ALTER COLUMN status            SET NOT NULL;
ALTER TABLE products ALTER COLUMN is_test_lab       SET DEFAULT FALSE;
ALTER TABLE products ALTER COLUMN is_test_lab       SET NOT NULL;
ALTER TABLE products ALTER COLUMN commerce_eligible SET DEFAULT FALSE;
ALTER TABLE products ALTER COLUMN commerce_eligible SET NOT NULL;
ALTER TABLE products ALTER COLUMN in_stock          SET DEFAULT FALSE;
ALTER TABLE products ALTER COLUMN in_stock          SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_status_valid') THEN
    ALTER TABLE products ADD CONSTRAINT chk_products_status_valid
      CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED', 'DRAFT'));
  END IF;
END $$;

-- Index supporting the single canonical eligibility predicate.
CREATE INDEX IF NOT EXISTS idx_products_ai_commerce_eligible
  ON products (category, product_type, price)
  WHERE is_test_lab = FALSE AND status = 'ACTIVE' AND commerce_eligible = TRUE AND in_stock = TRUE;

-- ─── PART C: TRANSACTION STATUS VOCABULARY REPAIR ────────────────────────────
-- paymentService writes status values 'completed' and 'failed', but the CHECK
-- constraint created in 001 only permitted 'payment_completed'/'payment_failed'.
-- The result: verifyPayment() threw on the final UPDATE, so on a schema-correct
-- database NO payment could ever be marked verified and no order was created.
--
-- The code's vocabulary is the one used by 10 call sites and by the read paths
-- in routes/payments.js, so the constraint is widened to the union of both
-- vocabularies rather than rewriting the service layer.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_status_check
  CHECK (status IN (
    'created',
    'payment_pending',
    'payment_completed',
    'payment_failed',
    'completed',
    'failed',
    'verified',
    'refunded',
    'cancelled'
  ));

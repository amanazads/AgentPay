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

-- ─── PART D: MISSING TABLES REFERENCED BY APPLICATION CODE ───────────────────
-- Both of these are read and written by src/, but no migration ever created
-- them. The refresh_tokens omission is the more serious of the two: signup and
-- login both call createRefreshToken(), so on a schema-correct fresh database
-- NO USER COULD REGISTER OR SIGN IN AT ALL.

-- Used by utils/authUtils.js (createRefreshToken, validateAndRotateRefreshToken)
-- and routes/auth.js (logout).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user    ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens (expires_at);

-- Used by services/authorizationService.js (temporary spending-limit holds).
-- That service currently has no callers, so the table is created rather than
-- the service deleted: per the audit rules, unreferenced code is left intact
-- and only confirmed-orphaned files are removed.
CREATE TABLE IF NOT EXISTS authorization_reservations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchase_intent_id UUID REFERENCES purchase_intents(id) ON DELETE SET NULL,
  amount             NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  status             VARCHAR(20) NOT NULL DEFAULT 'RESERVED'
                       CHECK (status IN ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_authorization_reservations_active
  ON authorization_reservations (user_id, status, expires_at);

-- ─── PART E: product_ai_metadata.specifications_normalized ───────────────────
-- Selected by the AI catalog feed (both the list and single-product endpoints)
-- and by candidateFilter, but never created. Every request to
-- GET /api/ai/catalog returned HTTP 500 on a schema-correct database, which
-- also meant the AI service's discovery tool had nothing to fall back to.
--
-- Backfilled from the product's own specifications so existing rows carry the
-- normalized view immediately.
ALTER TABLE product_ai_metadata
  ADD COLUMN IF NOT EXISTS specifications_normalized JSONB DEFAULT '{}'::jsonb;

UPDATE product_ai_metadata pam
SET specifications_normalized = COALESCE(p.specifications, '{}'::jsonb)
FROM products p
WHERE p.id = pam.product_id
  AND (pam.specifications_normalized IS NULL OR pam.specifications_normalized = '{}'::jsonb);

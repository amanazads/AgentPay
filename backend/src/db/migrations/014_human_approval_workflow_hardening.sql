-- Migration 014: Human Approval Workflow Hardening

ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id),
  ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quoted_price DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS current_price DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS risk_score INTEGER,
  ADD COLUMN IF NOT EXISTS policy_version VARCHAR(50),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Backfill user_id, product_id, merchant_id, quantity, quoted_price, current_price, risk_score, policy_version from purchase_intents
UPDATE approvals ap
SET user_id = COALESCE(ap.user_id, pi.user_id),
    product_id = COALESCE(ap.product_id, pi.product_id),
    merchant_id = COALESCE(ap.merchant_id, pi.merchant_id),
    quantity = COALESCE(ap.quantity, pi.quantity, 1),
    quoted_price = COALESCE(ap.quoted_price, pi.amount),
    current_price = COALESCE(ap.current_price, p.price, pi.amount),
    risk_score = COALESCE(ap.risk_score, pi.risk_score),
    policy_version = COALESCE(ap.policy_version, 'v1'),
    expires_at = COALESCE(ap.expires_at, ap.created_at + INTERVAL '24 hours')
FROM purchase_intents pi
LEFT JOIN products p ON pi.product_id = p.id
WHERE ap.purchase_intent_id = pi.id;

CREATE INDEX IF NOT EXISTS idx_approvals_user_id ON approvals(user_id);
CREATE INDEX IF NOT EXISTS idx_approvals_expires_at ON approvals(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_purchase_intent_unconditional ON approvals (purchase_intent_id);

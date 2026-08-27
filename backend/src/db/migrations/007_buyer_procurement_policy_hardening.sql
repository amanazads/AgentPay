-- Migration 007: Buyer Procurement Policy Hardening & Audit History

-- 1. Add structured policy columns to user_preferences
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS natural_language_rules JSONB DEFAULT '[]'::jsonb;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS category_rules JSONB DEFAULT '{}'::jsonb;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS delivery_rules JSONB DEFAULT '{}'::jsonb;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS brand_rules JSONB DEFAULT '{}'::jsonb;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS policy_version INTEGER DEFAULT 1;

-- 2. Create policy_change_history table for auditing financial and policy configuration changes
CREATE TABLE IF NOT EXISTS policy_change_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_version INTEGER NOT NULL,
  changed_fields JSONB NOT NULL,
  old_values JSONB NOT NULL,
  new_values JSONB NOT NULL,
  change_reason VARCHAR(255) DEFAULT 'User preference update',
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user policy audit queries
CREATE INDEX IF NOT EXISTS idx_policy_change_history_user_version 
ON policy_change_history(user_id, policy_version DESC);

-- AgentPay Database Schema
-- Migration 001: Initial schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Users
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Policies
-- ============================================
CREATE TABLE IF NOT EXISTS policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  version VARCHAR(20) NOT NULL,
  daily_budget DECIMAL(12,2) NOT NULL,
  max_transaction DECIMAL(12,2) NOT NULL,
  approval_threshold DECIMAL(12,2) NOT NULL,
  allowed_categories TEXT[] NOT NULL DEFAULT '{}',
  blocked_categories TEXT[] NOT NULL DEFAULT '{}',
  max_retries INTEGER DEFAULT 1,
  price_tolerance_pct DECIMAL(5,2) DEFAULT 2.0,
  verified_merchants_only BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Agents
-- ============================================
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  owner_id UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'suspended')),
  policy_id UUID REFERENCES policies(id),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Merchants
-- ============================================
CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  is_verified BOOLEAN DEFAULT false,
  risk_level VARCHAR(20) DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high')),
  rating DECIMAL(3,2),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Products
-- ============================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES merchants(id),
  name VARCHAR(500) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  original_price DECIMAL(12,2),
  currency VARCHAR(3) DEFAULT 'INR',
  in_stock BOOLEAN DEFAULT true,
  specifications JSONB DEFAULT '{}',
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Purchase Intents
-- ============================================
CREATE TABLE IF NOT EXISTS purchase_intents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id),
  user_id UUID REFERENCES users(id),
  product_id UUID REFERENCES products(id),
  merchant_id UUID REFERENCES merchants(id),
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'INR',
  quantity INTEGER DEFAULT 1,
  ai_reasoning TEXT,
  ai_recommendation TEXT,
  status VARCHAR(30) DEFAULT 'pending' CHECK (status IN (
    'pending', 'evaluating', 'allowed', 'approval_required', 'blocked',
    'approved', 'rejected', 'payment_pending', 'payment_completed',
    'payment_failed', 'completed', 'cancelled'
  )),
  policy_decision VARCHAR(30),
  policy_details JSONB,
  risk_score INTEGER,
  risk_details JSONB,
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Transactions
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_intent_id UUID REFERENCES purchase_intents(id),
  agent_id UUID REFERENCES agents(id),
  user_id UUID REFERENCES users(id),
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'INR',
  status VARCHAR(30) NOT NULL CHECK (status IN (
    'created', 'payment_pending', 'payment_completed',
    'payment_failed', 'verified', 'refunded', 'cancelled'
  )),
  razorpay_order_id VARCHAR(255),
  razorpay_payment_id VARCHAR(255),
  razorpay_signature VARCHAR(255),
  payment_verified BOOLEAN DEFAULT false,
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Approvals
-- ============================================
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_intent_id UUID REFERENCES purchase_intents(id),
  agent_id UUID REFERENCES agents(id),
  reviewer_id UUID,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  decision VARCHAR(20),
  reason TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Risk Assessments
-- ============================================
CREATE TABLE IF NOT EXISTS risk_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_intent_id UUID REFERENCES purchase_intents(id),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  level VARCHAR(20) NOT NULL CHECK (level IN ('LOW', 'MEDIUM', 'HIGH')),
  factors JSONB NOT NULL DEFAULT '[]',
  explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Audit Events (append-only)
-- ============================================
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type VARCHAR(100) NOT NULL,
  actor VARCHAR(50) NOT NULL,
  agent_id UUID,
  user_id UUID,
  transaction_id UUID,
  purchase_intent_id UUID,
  action VARCHAR(100) NOT NULL,
  decision VARCHAR(30),
  policy_version VARCHAR(20),
  reasoning TEXT,
  risk_score INTEGER,
  payment_id VARCHAR(255),
  outcome VARCHAR(50),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Agent Memory
-- ============================================
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id),
  user_id UUID REFERENCES users(id),
  memory_type VARCHAR(50) NOT NULL CHECK (memory_type IN ('preference', 'brand', 'budget', 'rejection')),
  key VARCHAR(255) NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Simulation Runs
-- ============================================
CREATE TABLE IF NOT EXISTS simulation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255),
  total_cases INTEGER NOT NULL,
  completed_cases INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  results JSONB,
  metrics JSONB,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================
-- Simulation Cases
-- ============================================
CREATE TABLE IF NOT EXISTS simulation_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  simulation_run_id UUID REFERENCES simulation_runs(id),
  case_number INTEGER NOT NULL,
  scenario_type VARCHAR(50) NOT NULL,
  input JSONB NOT NULL,
  expected_decision VARCHAR(30) NOT NULL,
  actual_decision VARCHAR(30),
  correct BOOLEAN,
  latency_ms INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- System State (singleton row)
-- ============================================
CREATE TABLE IF NOT EXISTS system_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  kill_switch_active BOOLEAN DEFAULT false,
  kill_switch_activated_by UUID,
  kill_switch_activated_at TIMESTAMPTZ,
  demo_mode BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default system state
INSERT INTO system_state (id, kill_switch_active, demo_mode)
VALUES (1, false, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_purchase_intents_agent ON purchase_intents(agent_id);
CREATE INDEX IF NOT EXISTS idx_purchase_intents_status ON purchase_intents(status);
CREATE INDEX IF NOT EXISTS idx_purchase_intents_user ON purchase_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_agent ON transactions(agent_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_razorpay ON transactions(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_transaction ON audit_events(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_agent ON audit_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_merchant ON products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_user ON agent_memory(agent_id, user_id);
CREATE INDEX IF NOT EXISTS idx_simulation_cases_run ON simulation_cases(simulation_run_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_intent ON approvals(purchase_intent_id);

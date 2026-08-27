-- Migration 002: User Preferences, Extensions & Merchant Metadata

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  monthly_budget DECIMAL(12,2) DEFAULT 100000,
  auto_purchase_limit DECIMAL(12,2) DEFAULT 25000,
  categories TEXT[] DEFAULT ARRAY['Electronics'],
  preferred_brands TEXT[] DEFAULT ARRAY[]::TEXT[],
  delivery_preference VARCHAR(100) DEFAULT 'Fastest available',
  purchase_behavior VARCHAR(50) DEFAULT 'auto_within_limit',
  custom_criteria JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) DEFAULT 'razorpay',
  method_type VARCHAR(50) DEFAULT 'upi_mandate',
  identifier_masked VARCHAR(255) NOT NULL,
  max_limit DECIMAL(12,2) DEFAULT 50000,
  is_default BOOLEAN DEFAULT true,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_ai_metadata (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  ai_summary TEXT,
  target_audience TEXT,
  use_cases TEXT[] DEFAULT ARRAY[]::TEXT[],
  keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  is_promoted BOOLEAN DEFAULT false,
  margin_tier VARCHAR(20) DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS merchant_analytics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  ai_searches INTEGER DEFAULT 0,
  ai_evaluations INTEGER DEFAULT 0,
  ai_carts INTEGER DEFAULT 0,
  ai_orders INTEGER DEFAULT 0,
  ai_revenue DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(merchant_id, date)
);

-- Ensure users table has merchant_id column
ALTER TABLE users ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Ensure agents has owner_id nullable with ON DELETE SET NULL
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_owner_id_fkey;
ALTER TABLE agents ADD CONSTRAINT agents_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;

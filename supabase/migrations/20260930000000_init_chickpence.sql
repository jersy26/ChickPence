-- ChickPence Database Migration v1.2
-- Aligned with ChickPence ERD v1.2 and PRD v1.5
-- Target: Supabase (PostgreSQL)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- 1. BATCH TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS batch (
  batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  batch_name VARCHAR(100) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  initial_chick_count INT NOT NULL CHECK (initial_chick_count > 0),
  chick_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00 CHECK (chick_cost >= 0),
  mortality_threshold_pct DECIMAL(5,2),
  cost_budget DECIMAL(12,2),
  status VARCHAR(20) NOT NULL DEFAULT 'Active'
    CHECK (status IN ('Active', 'Completed')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Link user_id to auth.users if running in Supabase environment
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'batch_user_id_fkey' AND table_name = 'batch'
    ) THEN
      ALTER TABLE batch ADD CONSTRAINT batch_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- Only one Active batch at a time (soft deleted records ignored)
CREATE UNIQUE INDEX IF NOT EXISTS one_active_batch
  ON batch ((status)) WHERE status = 'Active' AND deleted_at IS NULL;

-- ==========================================
-- 2. DAILY_COST TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS daily_cost (
  cost_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batch(batch_id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  feed_cost DECIMAL(10,2) DEFAULT 0.00,
  medicine_cost DECIMAL(10,2) DEFAULT 0.00,
  utilities_cost DECIMAL(10,2) DEFAULT 0.00,
  labor_cost DECIMAL(10,2) DEFAULT 0.00,
  transport_cost DECIMAL(10,2) DEFAULT 0.00,
  other_cost DECIMAL(10,2) DEFAULT 0.00,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_daily_cost_batch_id ON daily_cost(batch_id);
CREATE INDEX IF NOT EXISTS idx_daily_cost_entry_date ON daily_cost(entry_date);

-- ==========================================
-- 3. FEED_LOG TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS feed_log (
  feed_log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batch(batch_id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  feed_type VARCHAR(100) NOT NULL,
  quantity_kg DECIMAL(8,2) NOT NULL CHECK (quantity_kg > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_feed_log_batch_id ON feed_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_feed_log_entry_date ON feed_log(entry_date);

-- ==========================================
-- 4. MORTALITY_LOG TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS mortality_log (
  mortality_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batch(batch_id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  count INT NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mortality_log_batch_id ON mortality_log(batch_id);
CREATE INDEX IF NOT EXISTS idx_mortality_log_entry_date ON mortality_log(entry_date);

-- ==========================================
-- 5. SALE TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS sale (
  sale_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES batch(batch_id) ON DELETE CASCADE,
  sale_date DATE NOT NULL,
  buyer_name VARCHAR(150) NOT NULL,
  quantity_sold INT NOT NULL CHECK (quantity_sold > 0),
  weight_kg DECIMAL(8,2) NOT NULL CHECK (weight_kg > 0),
  price_per_kg DECIMAL(8,2) NOT NULL CHECK (price_per_kg > 0),
  total_amount DECIMAL(10,2) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sale_batch_id ON sale(batch_id);
CREATE INDEX IF NOT EXISTS idx_sale_date ON sale(sale_date);

-- ==========================================
-- 6. ROW LEVEL SECURITY (RLS)
-- ==========================================
ALTER TABLE batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_cost ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE mortality_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full CRUD access (Single shared account model for thesis scope)
DO $$
BEGIN
  -- batch policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated users full access to batch') THEN
    CREATE POLICY "Allow authenticated users full access to batch" ON batch FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  
  -- daily_cost policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated users full access to daily_cost') THEN
    CREATE POLICY "Allow authenticated users full access to daily_cost" ON daily_cost FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- feed_log policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated users full access to feed_log') THEN
    CREATE POLICY "Allow authenticated users full access to feed_log" ON feed_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- mortality_log policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated users full access to mortality_log') THEN
    CREATE POLICY "Allow authenticated users full access to mortality_log" ON mortality_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  -- sale policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated users full access to sale') THEN
    CREATE POLICY "Allow authenticated users full access to sale" ON sale FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

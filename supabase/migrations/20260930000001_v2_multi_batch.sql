-- ChickPence Database Migration v2.0 – Multi-batch + Farm-level Expenses
-- Aligned with ChickPence v2.0 architecture (thesis multi-batch model)
-- Target: Supabase (PostgreSQL)
--
-- !! DO NOT RUN THIS AGAINST THE LIVE DATABASE !!
-- Review each section, then apply manually or via supabase db push.
--
-- What this migration does:
--   1. Renames batch status values Active→Open, Completed→Closed
--   2. Drops the one_active_batch unique index (multiple open batches allowed)
--   3. Removes cost_budget column from batch
--   4. Creates the new farm-level expense table
--   5. Migrates old daily_cost rows into expense rows (100% allocated to original batch)
--   6. Creates RLS policies for the expense table
--   7. Lists the daily_cost table as deprecated (kept for rollback purposes)
--
-- NOTE: Allocation rows are NOT stored in Supabase. They are computed locally on each device.

BEGIN;

-- ============================================================
-- 1. RENAME BATCH STATUS VALUES
-- ============================================================

-- Remove the old CHECK constraint so we can update values
ALTER TABLE batch DROP CONSTRAINT IF EXISTS batch_status_check;

-- Update existing rows
UPDATE batch SET status = 'Open'   WHERE status = 'Active';
UPDATE batch SET status = 'Closed' WHERE status = 'Completed';

-- Add new CHECK constraint
ALTER TABLE batch
  ADD CONSTRAINT batch_status_check
  CHECK (status IN ('Open', 'Closed'));

-- ============================================================
-- 2. DROP ONE_ACTIVE_BATCH UNIQUE INDEX
--    Multiple open batches are now allowed by design.
-- ============================================================
DROP INDEX IF EXISTS one_active_batch;

-- ============================================================
-- 3. REMOVE cost_budget COLUMN (no longer used)
-- ============================================================
ALTER TABLE batch DROP COLUMN IF EXISTS cost_budget;

-- ============================================================
-- 4. CREATE FARM-LEVEL EXPENSE TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS expense (
  expense_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date       DATE NOT NULL,
  feed_centavos    BIGINT NOT NULL DEFAULT 0 CHECK (feed_centavos >= 0),
  other_centavos   BIGINT NOT NULL DEFAULT 0 CHECK (other_centavos >= 0),
  -- At least one must be > 0 (enforced at application layer and here as a soft check)
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  CONSTRAINT expense_nonzero CHECK (feed_centavos > 0 OR other_centavos > 0)
);

CREATE INDEX IF NOT EXISTS idx_expense_entry_date ON expense(entry_date);
CREATE INDEX IF NOT EXISTS idx_expense_updated_at ON expense(updated_at);

-- ============================================================
-- 5. RLS FOR expense TABLE
-- ============================================================
ALTER TABLE expense ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow authenticated users full access to expense') THEN
    CREATE POLICY "Allow authenticated users full access to expense"
      ON expense FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 6. MIGRATE OLD daily_cost ROWS → expense ROWS
--    Each old per-batch row becomes one farm-level expense
--    with 100% allocation to the original batch.
--    (Feed stays Feed; medicine+utilities+labor+transport+other → other_centavos)
--    Peso amounts are converted to integer centavos.
-- ============================================================
INSERT INTO expense (expense_id, entry_date, feed_centavos, other_centavos, updated_at, deleted_at)
SELECT
  cost_id AS expense_id,
  entry_date,
  ROUND(COALESCE(feed_cost, 0) * 100)::BIGINT                    AS feed_centavos,
  ROUND((
    COALESCE(medicine_cost, 0) +
    COALESCE(utilities_cost, 0) +
    COALESCE(labor_cost, 0) +
    COALESCE(transport_cost, 0) +
    COALESCE(other_cost, 0)
  ) * 100)::BIGINT                                                AS other_centavos,
  updated_at,
  deleted_at
FROM daily_cost
WHERE deleted_at IS NULL
  AND (
    COALESCE(feed_cost, 0) > 0 OR
    COALESCE(medicine_cost, 0) + COALESCE(utilities_cost, 0) +
    COALESCE(labor_cost, 0) + COALESCE(transport_cost, 0) + COALESCE(other_cost, 0) > 0
  )
ON CONFLICT (expense_id) DO NOTHING;

-- ============================================================
-- 7. REMOVE feed_type COLUMN FROM feed_log (no longer used)
-- ============================================================
ALTER TABLE feed_log DROP COLUMN IF EXISTS feed_type;

-- ============================================================
-- 8. MARK daily_cost AS DEPRECATED
--    Kept for rollback. Once confirmed stable, run:
--      DROP TABLE IF EXISTS daily_cost;
-- ============================================================
COMMENT ON TABLE daily_cost IS
  'DEPRECATED in v2.0. Superseded by expense table. Do not write new rows. Drop after confirming migration.';

COMMIT;

-- ============================================================
-- ROLLBACK SCRIPT (run these to undo, in reverse order)
-- ============================================================
-- BEGIN;
-- ALTER TABLE feed_log ADD COLUMN IF NOT EXISTS feed_type VARCHAR(100);
-- DROP TABLE IF EXISTS expense;
-- ALTER TABLE batch ADD COLUMN IF NOT EXISTS cost_budget DECIMAL(12,2);
-- CREATE UNIQUE INDEX IF NOT EXISTS one_active_batch ON batch ((status)) WHERE status = 'Open' AND deleted_at IS NULL;
-- UPDATE batch SET status = 'Active'    WHERE status = 'Open';
-- UPDATE batch SET status = 'Completed' WHERE status = 'Closed';
-- ALTER TABLE batch DROP CONSTRAINT IF EXISTS batch_status_check;
-- ALTER TABLE batch ADD CONSTRAINT batch_status_check CHECK (status IN ('Active', 'Completed'));
-- COMMIT;

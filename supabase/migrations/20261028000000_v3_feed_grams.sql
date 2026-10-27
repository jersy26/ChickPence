-- ChickPence Database Migration v3 – feed quantity in integer grams
-- Target: Supabase (PostgreSQL)
--
-- The app has stored feed as integer grams (quantity_g) since its local
-- Dexie v3 schema (integer-only precision, NFR-04 / ERD Table 15), but the
-- database still had quantity_kg DECIMAL. Syncing a feed log failed with
-- "Could not find the 'quantity_g' column of 'feed_log'".
--
-- What this migration does:
--   1. Adds feed_log.quantity_g (BIGINT, grams, > 0)
--   2. Converts existing rows: quantity_g = ROUND(quantity_kg * 1000)
--   3. Drops feed_log.quantity_kg
--
-- Safe to run more than once.

BEGIN;

ALTER TABLE feed_log ADD COLUMN IF NOT EXISTS quantity_g BIGINT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'feed_log' AND column_name = 'quantity_kg'
  ) THEN
    UPDATE feed_log SET quantity_g = ROUND(quantity_kg * 1000) WHERE quantity_g IS NULL;
    ALTER TABLE feed_log DROP COLUMN quantity_kg;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'feed_log' AND constraint_name = 'feed_log_quantity_g_check'
  ) THEN
    ALTER TABLE feed_log ADD CONSTRAINT feed_log_quantity_g_check CHECK (quantity_g > 0);
  END IF;
END $$;

ALTER TABLE feed_log ALTER COLUMN quantity_g SET NOT NULL;

COMMIT;

-- Make the REST API (PostgREST) see the new column right away
NOTIFY pgrst, 'reload schema';

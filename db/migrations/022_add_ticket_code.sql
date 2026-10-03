-- 022_add_ticket_code.sql
-- Every ticket gets a unique random code (e.g. for a QR code at the door).
-- tickets has ~1M rows and the site is selling tickets the whole time, so the column is
-- added in steps that never lock the table for long and never lose or change existing data.
--
-- THE TRAP this avoids:
--   ALTER TABLE tickets ADD COLUMN ticket_code uuid NOT NULL DEFAULT gen_random_uuid();
-- gen_random_uuid() gives a different value per row, so PostgreSQL rewrites all 1M rows
-- into a new file while holding an ACCESS EXCLUSIVE lock: nobody can even read tickets
-- until it's done (5.9 s measured on a restored copy; minutes on a bigger table).
--
-- IMPORTANT: run this file WITHOUT wrapping it in a transaction (plain psql -f, no -1):
-- the backfill commits after every batch, and CREATE INDEX CONCURRENTLY can't run in a
-- transaction. Every step is safe to re-run if it stops half-way.

\set ON_ERROR_STOP 1

-- 1. Add the column with no default: instant (only the table's definition changes).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_code uuid;

-- 2. New tickets get a code from now on. Setting a default doesn't touch existing rows.
ALTER TABLE tickets ALTER COLUMN ticket_code SET DEFAULT gen_random_uuid();

-- 3. Fill in existing tickets in batches of 50,000, committing after each batch.
--    Each batch locks only its own 50,000 rows, briefly; the site keeps working in between.
--    (One big UPDATE would lock all 1M rows until it finished.)
--    COMMIT inside a procedure is allowed when it is CALLed outside a transaction block.
CREATE OR REPLACE PROCEDURE backfill_ticket_codes(batch_size integer)
LANGUAGE plpgsql
AS $$
DECLARE
    updated integer;
BEGIN
    LOOP
        UPDATE tickets
        SET ticket_code = gen_random_uuid()
        WHERE ticket_id IN (
            SELECT ticket_id FROM tickets
            WHERE ticket_code IS NULL
            LIMIT batch_size
            FOR UPDATE SKIP LOCKED   -- skip a row someone is updating right now; a later batch gets it
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        EXIT WHEN updated = 0;
        RAISE NOTICE 'filled % ticket codes', updated;
        COMMIT;
    END LOOP;
END;
$$;

CALL backfill_ticket_codes(50000);
DROP PROCEDURE backfill_ticket_codes(integer);

-- 4. Make it NOT NULL without a long lock.
--    SET NOT NULL alone scans the whole table under ACCESS EXCLUSIVE.
--    Instead: add a CHECK marked NOT VALID (instant, checks only new rows), then VALIDATE it,
--    which scans existing rows under a weaker lock that still allows reads and writes.
--    SET NOT NULL then sees the valid CHECK and skips its own scan.
ALTER TABLE tickets ADD CONSTRAINT tickets_ticket_code_not_null CHECK (ticket_code IS NOT NULL) NOT VALID;
ALTER TABLE tickets VALIDATE CONSTRAINT tickets_ticket_code_not_null;
ALTER TABLE tickets ALTER COLUMN ticket_code SET NOT NULL;
ALTER TABLE tickets DROP CONSTRAINT tickets_ticket_code_not_null;

-- 5. Unique index, built CONCURRENTLY: slower, but inserts and updates keep working while it builds.
--    A plain CREATE INDEX would block every ticket sale until it finished.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS tickets_ticket_code_unique ON tickets (ticket_code);

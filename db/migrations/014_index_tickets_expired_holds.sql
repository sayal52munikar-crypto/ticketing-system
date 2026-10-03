-- 014_index_tickets_expired_holds.sql
-- Serves db/queries/05_expired_holds.sql (the hold cleanup job).
--
-- Partial index: only held tickets are in it (a few hundred out of 1M), so it is
-- tiny and cheap to keep up to date. Sold and refunded tickets never touch it.
-- The query's "WHERE status = 'held'" must match the index's WHERE for it to be used.

CREATE INDEX tickets_held_until_idx
    ON tickets (held_until)
    WHERE status = 'held';

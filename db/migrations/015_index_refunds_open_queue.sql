-- 015_index_refunds_open_queue.sql
-- Serves db/queries/06_open_refunds.sql (admin queue, oldest request first).
--
-- Partial index on open requests only, sorted by requested_at. The query reads the
-- first 50 entries in index order and stops: no scan of every refund, no sort step.

CREATE INDEX refunds_open_requested_at_idx
    ON refunds (requested_at)
    WHERE status = 'requested';

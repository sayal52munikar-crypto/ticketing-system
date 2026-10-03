-- 017_index_payments_recent_revenue.sql
-- Serves db/queries/09_revenue_last_30_days.sql.
--
-- Partial: only successful payments are indexed, since revenue never looks at failed ones.
-- INCLUDE (amount) stores the amount inside the index too ("covering index"), so the
-- query can sum amounts straight from the index without visiting the table at all
-- (an "Index Only Scan").

CREATE INDEX payments_succeeded_created_at_idx
    ON payments (created_at) INCLUDE (amount)
    WHERE status = 'succeeded';

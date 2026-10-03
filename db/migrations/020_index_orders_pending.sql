-- 020_index_orders_pending.sql
-- Serves the hold cleanup job, which every minute looks for pending orders whose
-- seats have all been released. Without this it would scan ~450k orders to find
-- ~150 pending ones.
-- Partial index again: only pending orders are in it, so it stays tiny.

CREATE INDEX orders_pending_idx
    ON orders (order_id)
    WHERE status = 'pending';

-- 06_open_refunds.sql
-- Admin: the 50 oldest refund requests still waiting for a decision.

SELECT refund_id, ticket_id, amount, reason, requested_at
FROM refunds
WHERE status = 'requested'
ORDER BY requested_at
LIMIT 50;

-- BEFORE: 2.3 ms, Seq Scan over 20k refunds, then a sort.
-- AFTER migration 015 (partial index on requested_at WHERE status = 'requested'): 0.044 ms, ~50x faster.
-- The index is already in requested_at order, so there's no sort step:
-- the query reads the first 50 entries and stops.

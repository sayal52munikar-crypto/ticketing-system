-- 09_revenue_last_30_days.sql
-- Admin dashboard: sales per day for the last 30 days.

SELECT created_at::date  AS day,
       count(*)          AS payments,
       sum(amount)       AS gross
FROM payments
WHERE status = 'succeeded'
  AND created_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;

-- BEFORE: 93 ms, Parallel Seq Scan over 463k payments to use ~20k of them.
-- AFTER migration 017 (index on created_at INCLUDE (amount) WHERE status = 'succeeded'): 7 ms, ~13x faster.
-- The plan is an "Index Only Scan ... Heap Fetches: 0": every needed column is in the
-- index, so the table itself is never read. Index-only scans need a recent VACUUM
-- (the visibility map). Otherwise they still check the table for each row.
-- Compare with 08: same table, but a 30-day slice is a small fraction, so an index helps.

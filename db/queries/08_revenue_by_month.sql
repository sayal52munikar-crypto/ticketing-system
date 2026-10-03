-- 08_revenue_by_month.sql
-- Admin dashboard: gross sales, refunds and net revenue per month.
--
-- Payments and refunds are totalled per month SEPARATELY, then joined.
-- Joining them first and summing afterwards would repeat each payment once per
-- matching refund row and inflate the totals ("fan-out").
-- FULL JOIN keeps a month that has payments but no refunds (or the reverse).

WITH sales AS (
    SELECT date_trunc('month', created_at) AS month,
           sum(amount)                     AS gross
    FROM payments
    WHERE status = 'succeeded'
    GROUP BY 1
),
refunded AS (
    SELECT date_trunc('month', decided_at) AS month,
           sum(amount)                     AS refunds
    FROM refunds
    WHERE status = 'approved'
    GROUP BY 1
)
SELECT to_char(month, 'YYYY-MM')                          AS month,
       coalesce(s.gross, 0)                                AS gross,
       coalesce(r.refunds, 0)                              AS refunds,
       coalesce(s.gross, 0) - coalesce(r.refunds, 0)       AS net
FROM sales s
FULL JOIN refunded r USING (month)
ORDER BY month;

-- RESULT: ~210 ms, Seq Scan on payments and refunds, no index added.
-- It totals every successful payment ever (432k rows), so it has to read the whole table.
-- Reading a table front to back is the fastest way to visit most of its rows.
-- Lesson: indexes help you FIND a few rows. They don't speed up totalling all of them.
-- If this got too slow, the fix would be a pre-computed summary (materialized view), not an index.

-- 12_revenue_by_city.sql
-- Admin dashboard: ticket revenue per city (sold tickets only; refunded ones don't count).
--
-- Same aggregate-first shape as 10: total tickets per event first (1M rows -> 1,000),
-- then join the small result to events and venues and total again per city.

WITH event_sales AS (
    SELECT event_id, count(*) AS tickets_sold, sum(price) AS revenue
    FROM tickets
    WHERE status = 'sold'
    GROUP BY event_id
)
SELECT v.city,
       sum(es.tickets_sold) AS tickets_sold,
       sum(es.revenue)      AS revenue
FROM event_sales es
JOIN events e ON e.event_id = es.event_id
JOIN venues v ON v.venue_id = e.venue_id
GROUP BY v.city
ORDER BY revenue DESC;

-- RESULT: ~165 ms, Parallel Seq Scan on tickets. Like 10 and 11, it totals nearly every row,
-- so no index can help. Aggregating per event before joining keeps the join small.

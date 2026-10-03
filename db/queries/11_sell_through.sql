-- 11_sell_through.sql
-- Admin dashboard: what percentage of seats each past event sold.
--
-- Capacity (seats per venue) and sales (tickets per event) are counted in separate
-- CTEs first, then joined. Joining seats to tickets directly and counting would
-- multiply the rows (every seat x every ticket for the venue) and give wrong numbers.
-- LEFT JOIN + coalesce keeps an event that sold nothing, at 0%.

WITH capacity AS (
    SELECT sc.venue_id, count(*) AS seats
    FROM seats s
    JOIN sections sc ON sc.section_id = s.section_id
    GROUP BY sc.venue_id
),
sold AS (
    SELECT event_id, count(*) AS tickets_sold
    FROM tickets
    WHERE status = 'sold'
    GROUP BY event_id
)
SELECT e.event_id,
       e.title,
       v.city,
       e.starts_at,
       c.seats                                                   AS capacity,
       coalesce(s.tickets_sold, 0)                               AS tickets_sold,
       round(100.0 * coalesce(s.tickets_sold, 0) / c.seats, 1)   AS sell_through_pct
FROM events e
JOIN venues v    ON v.venue_id = e.venue_id
JOIN capacity c  ON c.venue_id = e.venue_id
LEFT JOIN sold s ON s.event_id = e.event_id
WHERE e.starts_at < now()
ORDER BY sell_through_pct DESC;

-- RESULT: ~175-195 ms, Parallel Seq Scan on tickets and Seq Scan on seats. No index added,
-- for the same reason as 08 and 10: it counts nearly every row. Already aggregates
-- before joining, so there's no rewrite win here either.

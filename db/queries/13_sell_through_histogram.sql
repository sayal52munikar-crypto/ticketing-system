-- 13_sell_through_histogram.sql
-- Admin dashboard: how many past events sold 0-10% of seats, 10-20%, ... 90-100%.
--
-- width_bucket(value, 0, 100, 10) puts a value into one of 10 equal buckets between 0 and 100:
-- 0-9.99 -> 1, 10-19.99 -> 2, ... A value of exactly 100 would land in bucket 11, so least()
-- folds it into bucket 10.
-- generate_series(1, 10) LEFT JOINed to the counts makes empty buckets show up as 0,
-- instead of disappearing from the result (and from the chart).

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
),
per_event AS (
    SELECT least(width_bucket(100.0 * coalesce(s.tickets_sold, 0) / c.seats, 0, 100, 10), 10) AS bucket
    FROM events e
    JOIN capacity c  ON c.venue_id = e.venue_id
    LEFT JOIN sold s ON s.event_id = e.event_id
    WHERE e.starts_at < now()
)
SELECT (b - 1) * 10 || '–' || b * 10 || '%' AS range,
       count(pe.bucket)                    AS events
FROM generate_series(1, 10) AS b
LEFT JOIN per_event pe ON pe.bucket = b
GROUP BY b
ORDER BY b;

-- RESULT: ~160 ms, same plan shape as 11 (it counts the same rows), plus a tiny GROUP BY
-- over 10 buckets. With the seeded data, past events land between 20% and 70%.

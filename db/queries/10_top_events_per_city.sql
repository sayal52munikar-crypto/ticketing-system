-- 10_top_events_per_city.sql
-- Admin dashboard: the 3 highest-earning events in each city.
--
-- rank() OVER (PARTITION BY city ORDER BY revenue DESC) numbers the events
-- 1, 2, 3... separately inside each city. A plain ORDER BY + LIMIT 3 would
-- only give the top 3 overall. Ties share a rank, so a city can show more than 3.
--
-- Tickets are totalled per event FIRST (1M rows -> 1,000), and only then joined
-- to events and venues. The first version joined all 1M tickets to events and
-- grouped afterwards: same result, twice as slow (348 ms -> 174 ms).

WITH event_sales AS (
    SELECT event_id, count(*) AS tickets_sold, sum(price) AS revenue
    FROM tickets
    WHERE status = 'sold'
    GROUP BY event_id
),
ranked AS (
    SELECT v.city, e.title, e.starts_at, es.tickets_sold, es.revenue,
           rank() OVER (PARTITION BY v.city ORDER BY es.revenue DESC) AS rank_in_city
    FROM event_sales es
    JOIN events e ON e.event_id = es.event_id
    JOIN venues v ON v.venue_id = e.venue_id
)
SELECT city, rank_in_city, title, starts_at, tickets_sold, revenue
FROM ranked
WHERE rank_in_city <= 3
ORDER BY city, rank_in_city;

-- RESULT: ~150-175 ms (was 348 ms before the aggregate-first rewrite), Parallel Seq Scan on tickets.
-- Experiment: a covering index on tickets (event_id) INCLUDE (price) WHERE status = 'sold'
-- (31 MB) was IGNORED by the planner, at the same speed. The query needs ~1M of 1M rows,
-- so scanning the table wins. The index was dropped: it would only slow down every ticket insert.
-- Lesson: rewriting the query beat adding an index.

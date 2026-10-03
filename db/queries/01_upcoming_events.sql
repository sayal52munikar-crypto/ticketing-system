-- 01_upcoming_events.sql
-- Home page: upcoming events in one city over the next 30 days.
-- Parameters in the app: city = $1. 'Chicago' is the example value here.

SELECT e.event_id,
       e.title,
       v.name AS venue,
       v.city,
       e.starts_at
FROM events e
JOIN venues v ON v.venue_id = e.venue_id
WHERE v.city = 'Chicago'
  AND e.starts_at >= now()
  AND e.starts_at <  now() + interval '30 days'
ORDER BY e.starts_at;

-- RESULT (1,000 events, 40 venues): 0.13 ms, Seq Scan on both tables, no index added.
-- Reading 1,000 small rows straight through is faster than any index lookup.
-- Lesson: small tables don't need indexes. The planner would ignore one anyway.

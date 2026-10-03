-- 02_seat_map.sql
-- Event page: every seat in the venue with its status and price for one event.
-- Parameters in the app: event_id = $1. Event 789 is the example value here.
--
-- A seat is "held" only while its hold hasn't expired. An expired hold that the
-- cleanup job hasn't deleted yet shows as available.

SELECT s.seat_id,
       sc.name AS section,
       s.row_label,
       s.seat_number,
       CASE
           WHEN t.status = 'sold'                              THEN 'sold'
           WHEN t.status = 'held' AND t.held_until > now()     THEN 'held'
           ELSE 'available'
       END AS seat_status,
       p.price
FROM events e
JOIN sections sc              ON sc.venue_id = e.venue_id
JOIN seats s                  ON s.section_id = sc.section_id
JOIN event_section_prices p   ON p.event_id = e.event_id AND p.section_id = sc.section_id
LEFT JOIN tickets t           ON t.event_id = e.event_id
                             AND t.seat_id = s.seat_id
                             AND t.status IN ('held', 'sold')
WHERE e.event_id = 789
ORDER BY sc.name, s.row_label, s.seat_number;

-- RESULT: 8.4 ms. Uses tickets_event_seat_active_unique (the partial unique index
-- from migration 010) once per seat: 3,326 quick lookups.
-- Experiment (index dropped inside a rolled-back transaction): 334 ms, Seq Scan on 1M tickets.
-- The partial index can only be used because the join repeats its condition:
-- "t.status IN ('held', 'sold')" must appear in the query for the planner to know
-- the index has every row it needs.

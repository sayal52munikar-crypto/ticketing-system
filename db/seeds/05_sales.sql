-- 05_sales.sql
-- ~1M tickets in ~400k orders, plus payments and 10k cancelled orders.
--
-- How it works:
--   1. Each event gets a "fill rate": past events sold 30-60% of seats, future events 5-35%.
--   2. Every row of seats is cut into small groups of 1-6 neighbouring seats
--      (people buy seats next to each other).
--   3. Each group is sold with probability = fill rate. One sold group = one order.
-- Temp tables (seed_*) hold intermediate results and disappear when the session ends.

CREATE TEMP TABLE seed_event_fill AS
SELECT event_id, venue_id, starts_at,
       CASE WHEN starts_at < now() THEN 0.30 + random() * 0.30
            ELSE 0.05 + random() * 0.30
       END AS fill
FROM events;

-- One row per (event, seat), tagged with the group it belongs to in its row.
-- Seats 1-4 with group_size 4 get group_no 0, seats 5-8 get 1, and so on (integer division).
CREATE TEMP TABLE seed_seat_groups AS
WITH seat_rows AS (
    SELECT ef.event_id, ef.fill, ef.starts_at, r.section_id, r.row_label,
           1 + floor(random() * 6)::int AS group_size
    FROM seed_event_fill ef
    JOIN sections sc ON sc.venue_id = ef.venue_id
    JOIN (SELECT DISTINCT section_id, row_label FROM seats) r ON r.section_id = sc.section_id
)
SELECT sr.event_id, sr.fill, sr.starts_at, s.seat_id, sr.section_id, sr.row_label,
       (s.seat_number - 1) / sr.group_size AS group_no
FROM seat_rows sr
JOIN seats s ON s.section_id = sr.section_id AND s.row_label = sr.row_label;

-- Pick which groups sell. A few groups for future events (0.3%) are checkouts in
-- progress right now: their order is pending and their tickets are held.
-- row_number() gives each sold group the order_id it will get.
CREATE TEMP TABLE seed_orders AS
SELECT row_number() OVER () AS order_id,
       g.*,
       1 + floor(random() * (SELECT max(customer_id) FROM customers))::int AS customer_id,
       CASE WHEN g.is_hold THEN now() - random() * interval '5 minutes'
            ELSE least(now(), g.starts_at) - random() * interval '90 days'
       END AS ordered_at
FROM (
    SELECT event_id, section_id, row_label, group_no, starts_at,
           starts_at > now() AND random() < 0.003 AS is_hold
    FROM (SELECT DISTINCT event_id, section_id, row_label, group_no, fill, starts_at
          FROM seed_seat_groups) AS every_group
    WHERE random() < fill
) AS g;

-- order_id is GENERATED ALWAYS, which normally refuses explicit values.
-- OVERRIDING SYSTEM VALUE allows them for a bulk load like this one.
-- Afterwards the identity sequence must be moved past the highest ID,
-- or the next normal insert would try to reuse ID 1 and fail.
INSERT INTO orders (order_id, customer_id, status, created_at)
OVERRIDING SYSTEM VALUE
SELECT order_id, customer_id,
       CASE WHEN is_hold THEN 'pending' ELSE 'paid' END,
       ordered_at
FROM seed_orders;

SELECT setval(pg_get_serial_sequence('orders', 'order_id'), (SELECT max(order_id) FROM orders));

-- Every seat in a sold group becomes a ticket. The price is copied from
-- event_section_prices, just as the app will do at checkout.
INSERT INTO tickets (order_id, event_id, seat_id, status, price, held_until, created_at)
SELECT o.order_id, g.event_id, g.seat_id,
       CASE WHEN o.is_hold THEN 'held' ELSE 'sold' END,
       p.price,
       CASE WHEN o.is_hold THEN o.ordered_at + interval '10 minutes' END,
       o.ordered_at
FROM seed_orders o
JOIN seed_seat_groups g USING (event_id, section_id, row_label, group_no)
JOIN event_section_prices p ON p.event_id = o.event_id AND p.section_id = o.section_id;

-- Payments for paid orders: the amount is the sum of the order's tickets.
-- 5% of orders had a failed attempt (e.g. a declined card) before succeeding.
CREATE TEMP TABLE seed_order_totals AS
SELECT o.order_id, o.ordered_at, sum(t.price) AS total
FROM seed_orders o
JOIN tickets t ON t.order_id = o.order_id
WHERE NOT o.is_hold
GROUP BY o.order_id, o.ordered_at;

INSERT INTO payments (order_id, amount, status, created_at)
SELECT order_id, total, 'failed', ordered_at + interval '1 minute'
FROM seed_order_totals
WHERE random() < 0.05;

INSERT INTO payments (order_id, amount, status, created_at)
SELECT order_id, total, 'succeeded', ordered_at + interval '2 minutes'
FROM seed_order_totals;

-- 10,000 abandoned checkouts: the payment failed, the order was cancelled
-- and its held seats were released (so it has no tickets).
-- A data-modifying CTE: INSERT ... RETURNING feeds the new order IDs straight into
-- the payments insert, in one statement.
WITH cancelled AS (
    INSERT INTO orders (customer_id, status, created_at)
    SELECT 1 + floor(random() * (SELECT max(customer_id) FROM customers))::int,
           'cancelled',
           now() - random() * interval '540 days'
    FROM generate_series(1, 10000)
    RETURNING order_id, created_at
)
INSERT INTO payments (order_id, amount, status, created_at)
SELECT order_id, round((30 + random() * 270)::numeric, 2), 'failed', created_at + interval '1 minute'
FROM cancelled;

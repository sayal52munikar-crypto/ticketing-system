-- 04_customer_tickets.sql
-- My tickets page: every ticket a customer has bought, newest event first,
-- with any open or approved refund.
-- Parameters in the app: customer_id = $1. Customer 4242 is the example value here.

SELECT o.order_id,
       o.created_at  AS ordered_at,
       o.status      AS order_status,
       e.title,
       e.starts_at,
       v.name        AS venue,
       sc.name       AS section,
       s.row_label,
       s.seat_number,
       t.price,
       t.status      AS ticket_status,
       r.status      AS refund_status
FROM orders o
JOIN tickets t       ON t.order_id = o.order_id
JOIN events e        ON e.event_id = t.event_id
JOIN venues v        ON v.venue_id = e.venue_id
JOIN seats s         ON s.seat_id = t.seat_id
JOIN sections sc     ON sc.section_id = s.section_id
LEFT JOIN refunds r  ON r.ticket_id = t.ticket_id
                    AND r.status IN ('requested', 'approved')
WHERE o.customer_id = 4242
ORDER BY e.starts_at DESC;

-- RESULT: 0.2 ms. Every step is an index lookup: orders_customer_id_idx finds 5 orders,
-- tickets_order_id_idx finds their 13 tickets, then primary keys fetch event, venue, seat, section.
-- Experiment (orders_customer_id_idx dropped in a rolled-back transaction): 110 ms,
-- Parallel Seq Scan over 450k orders.
-- Lesson: PostgreSQL does not index foreign keys for you. Without that index, every
-- "my orders" page would scan the whole orders table.

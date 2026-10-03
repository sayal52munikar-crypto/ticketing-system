-- constraints_test.sql
-- Tries to break every business rule in migrations 005-013 and reports PASS/FAIL.
-- Everything runs in one transaction that is rolled back, so no data is left behind.
-- Needs at least one venue, section, seat and event to exist (from earlier tests/seeds).
--
-- Run:  psql -U postgres -d ticketing -f db/tests/constraints_test.sql

\set ON_ERROR_STOP 1
\set QUIET 1
\pset tuples_only on
\pset footer off
BEGIN;

-- expect_error: runs a statement that SHOULD be rejected by a constraint.
CREATE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE stmt;
    EXCEPTION WHEN integrity_constraint_violation THEN
        RAISE NOTICE 'PASS  %  [%]', label, SQLERRM;
        RETURN;
    END;
    RAISE NOTICE 'FAIL  %  (statement was allowed)', label;
END;
$$;

-- expect_ok: runs a statement that SHOULD be allowed.
CREATE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE stmt;
    RAISE NOTICE 'PASS  %', label;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL  %  [%]', label, SQLERRM;
END;
$$;

-- Test fixtures, looked up later by these unique values.
CREATE TEMP TABLE fx AS
SELECT (SELECT min(event_id) FROM events)                    AS event_id,
       (SELECT min(seat_id) FROM seats)                      AS seat_id,
       (SELECT section_id FROM seats ORDER BY seat_id LIMIT 1) AS section_id;

INSERT INTO customers (email, full_name) VALUES ('test.ana@example.com', 'Ana Test');
INSERT INTO orders (customer_id)
SELECT customer_id FROM customers WHERE email = 'test.ana@example.com';
CREATE TEMP TABLE fx_order AS SELECT max(order_id) AS order_id FROM orders;

\echo '--- performers & event_performers'
SELECT pg_temp.expect_ok   ('two performers can share a name',
    $q$INSERT INTO performers (name) VALUES ('The Test Band'), ('The Test Band')$q$);
SELECT pg_temp.expect_error('blank performer name',
    $q$INSERT INTO performers (name) VALUES ('  ')$q$);
SELECT pg_temp.expect_ok   ('link performer to event',
    $q$INSERT INTO event_performers SELECT (SELECT event_id FROM fx), min(performer_id) FROM performers WHERE name = 'The Test Band'$q$);
SELECT pg_temp.expect_error('same performer linked to same event twice',
    $q$INSERT INTO event_performers SELECT (SELECT event_id FROM fx), min(performer_id) FROM performers WHERE name = 'The Test Band'$q$);

\echo '--- event_section_prices'
SELECT pg_temp.expect_ok   ('set a price for event + section',
    $q$INSERT INTO event_section_prices SELECT event_id, section_id, 50.00 FROM fx$q$);
SELECT pg_temp.expect_error('second price for same event + section',
    $q$INSERT INTO event_section_prices SELECT event_id, section_id, 60.00 FROM fx$q$);
SELECT pg_temp.expect_error('negative price',
    $q$UPDATE event_section_prices SET price = -1 WHERE (event_id, section_id) = (SELECT event_id, section_id FROM fx)$q$);

\echo '--- customers'
SELECT pg_temp.expect_error('same email, different capitalization',
    $q$INSERT INTO customers (email, full_name) VALUES ('TEST.Ana@Example.com', 'Ana Again')$q$);
SELECT pg_temp.expect_error('email without @',
    $q$INSERT INTO customers (email, full_name) VALUES ('not-an-email', 'Bob')$q$);

\echo '--- orders'
SELECT pg_temp.expect_error('invalid order status',
    $q$UPDATE orders SET status = 'shipped' WHERE order_id = (SELECT order_id FROM fx_order)$q$);

\echo '--- tickets'
SELECT pg_temp.expect_ok   ('hold a seat for 10 minutes',
    $q$INSERT INTO tickets (order_id, event_id, seat_id, price, held_until)
       SELECT (SELECT order_id FROM fx_order), event_id, seat_id, 50.00, now() + interval '10 minutes' FROM fx$q$);
SELECT pg_temp.expect_error('hold the same seat for the same event again',
    $q$INSERT INTO tickets (order_id, event_id, seat_id, price, held_until)
       SELECT (SELECT order_id FROM fx_order), event_id, seat_id, 50.00, now() + interval '10 minutes' FROM fx$q$);
SELECT pg_temp.expect_error('held ticket without an expiry time',
    $q$INSERT INTO tickets (order_id, event_id, seat_id, price)
       SELECT (SELECT order_id FROM fx_order), event_id, seat_id + 1, 50.00 FROM fx$q$);
SELECT pg_temp.expect_error('sold ticket that still has an expiry time',
    $q$UPDATE tickets SET status = 'sold' WHERE order_id = (SELECT order_id FROM fx_order)$q$);
SELECT pg_temp.expect_ok   ('mark the held ticket as sold',
    $q$UPDATE tickets SET status = 'sold', held_until = NULL WHERE order_id = (SELECT order_id FROM fx_order)$q$);
SELECT pg_temp.expect_error('invalid ticket status',
    $q$UPDATE tickets SET status = 'lost' WHERE order_id = (SELECT order_id FROM fx_order)$q$);

\echo '--- payments'
SELECT pg_temp.expect_ok   ('a failed payment attempt',
    $q$INSERT INTO payments (order_id, amount, status) SELECT order_id, 50.00, 'failed' FROM fx_order$q$);
SELECT pg_temp.expect_ok   ('a successful payment',
    $q$INSERT INTO payments (order_id, amount, status) SELECT order_id, 50.00, 'succeeded' FROM fx_order$q$);
SELECT pg_temp.expect_error('a second successful payment for the same order',
    $q$INSERT INTO payments (order_id, amount, status) SELECT order_id, 50.00, 'succeeded' FROM fx_order$q$);
SELECT pg_temp.expect_error('payment of 0',
    $q$INSERT INTO payments (order_id, amount, status) SELECT order_id, 0, 'failed' FROM fx_order$q$);

\echo '--- refunds & audit log'
CREATE TEMP TABLE fx_ticket AS
SELECT ticket_id FROM tickets WHERE order_id = (SELECT order_id FROM fx_order);
SELECT pg_temp.expect_ok   ('request a refund',
    $q$INSERT INTO refunds (ticket_id, amount, reason) SELECT ticket_id, 50.00, 'Cannot attend' FROM fx_ticket$q$);
SELECT pg_temp.expect_error('second open refund for the same ticket',
    $q$INSERT INTO refunds (ticket_id, amount) SELECT ticket_id, 50.00 FROM fx_ticket$q$);
SELECT pg_temp.expect_error('approve without a decision time',
    $q$UPDATE refunds SET status = 'approved' WHERE ticket_id = (SELECT ticket_id FROM fx_ticket)$q$);
SELECT pg_temp.expect_ok   ('approve the refund',
    $q$UPDATE refunds SET status = 'approved', decided_at = now() WHERE ticket_id = (SELECT ticket_id FROM fx_ticket)$q$);
SELECT pg_temp.expect_error('delete a refund that has audit history',
    $q$DELETE FROM refunds WHERE ticket_id = (SELECT ticket_id FROM fx_ticket)$q$);

\echo '--- a refunded seat can be sold again'
SELECT pg_temp.expect_ok   ('mark the ticket refunded',
    $q$UPDATE tickets SET status = 'refunded' WHERE ticket_id = (SELECT ticket_id FROM fx_ticket)$q$);
SELECT pg_temp.expect_ok   ('hold the same seat again',
    $q$INSERT INTO tickets (order_id, event_id, seat_id, price, held_until)
       SELECT (SELECT order_id FROM fx_order), event_id, seat_id, 50.00, now() + interval '10 minutes' FROM fx$q$);

\echo '--- audit log rows written by the trigger (expect NULL->requested, requested->approved)'
\pset tuples_only off
SELECT old_status, new_status, changed_by
FROM refund_audit_log
WHERE refund_id IN (SELECT refund_id FROM refunds WHERE ticket_id = (SELECT ticket_id FROM fx_ticket))
ORDER BY log_id;

ROLLBACK;
\echo '--- done (all test data rolled back)'

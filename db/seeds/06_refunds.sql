-- 06_refunds.sql
-- 20,000 refund requests on random sold tickets: ~20% still open, ~60% approved, ~20% rejected.
--
-- The audit trigger is switched off while loading history. Left on, it would stamp every
-- log row with the time the seed ran instead of when each request was made and decided.
-- The log is filled in by hand below with the real times, and the trigger is switched back on.
-- (This all runs inside the seed transaction, so a failure can't leave the trigger off.)

ALTER TABLE refunds DISABLE TRIGGER refunds_audit;

-- The sample is picked in a subquery on purpose. With ORDER BY random() in the same
-- query, PostgreSQL treats every random() in the select list as the sort key and
-- reuses its value, so the 20,000 lowest values would all pick the first array
-- element ('requested'). The outer query gets fresh random() calls.
CREATE TEMP TABLE seed_refunds AS
SELECT t.ticket_id,
       t.price,
       least(now(), t.created_at + random() * interval '30 days') AS requested_at,
       (ARRAY['requested', 'approved', 'approved', 'approved', 'rejected'])[1 + floor(random() * 5)::int] AS status,
       (ARRAY['Cannot attend', 'Event date clash', 'Bought the wrong seats', 'Illness',
              'Travel plans changed', NULL])[1 + floor(random() * 6)::int] AS reason
FROM (
    SELECT ticket_id, price, created_at
    FROM tickets
    WHERE status = 'sold'
    ORDER BY random()
    LIMIT 20000
) AS t;

INSERT INTO refunds (ticket_id, status, amount, reason, requested_at, decided_at)
SELECT ticket_id, status, price, reason, requested_at,
       CASE WHEN status <> 'requested'
            THEN least(now(), requested_at + random() * interval '3 days')
       END
FROM seed_refunds;

-- The same history the trigger would have written: one row when the refund was
-- requested, and a second when it was approved or rejected.
INSERT INTO refund_audit_log (refund_id, old_status, new_status, changed_at, changed_by)
SELECT refund_id, NULL, 'requested', requested_at, 'seed'
FROM refunds
UNION ALL
SELECT refund_id, 'requested', status, decided_at, 'seed'
FROM refunds
WHERE status <> 'requested';

ALTER TABLE refunds ENABLE TRIGGER refunds_audit;

-- An approved refund frees the seat: the partial unique index on tickets ignores
-- refunded tickets, so the seat can be sold again.
UPDATE tickets t
SET status = 'refunded'
FROM refunds r
WHERE r.ticket_id = t.ticket_id
  AND r.status = 'approved';

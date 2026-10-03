-- 021_create_release_expired_holds_procedure.sql
-- A stored procedure that releases unpaid holds, so the rule lives in the database
-- and any client (the Node job, psql, a scheduler like pg_cron) can run it:
--
--     CALL release_expired_holds(NULL, NULL);
--
-- It returns two numbers: how many seats were released and how many empty orders were cancelled.
--
-- PROCEDURE vs FUNCTION: a function is called inside a query (SELECT f()) and returns a value;
-- a procedure is run on its own with CALL. A procedure called outside an explicit transaction
-- may also COMMIT part-way through, which a function never can. This one doesn't need to:
-- both steps should succeed or fail together.

CREATE PROCEDURE release_expired_holds(OUT released integer, OUT cancelled integer)
LANGUAGE plpgsql
AS $$
BEGIN
    -- 1. Delete holds whose 10 minutes are up. Uses the partial index tickets_held_until_idx
    --    (migration 014). A hold being paid for right now is locked (FOR UPDATE in checkout):
    --    this DELETE waits for it, re-checks the row, and skips it because it's now 'sold'.
    DELETE FROM tickets
    WHERE status = 'held'
      AND held_until < now();
    GET DIAGNOSTICS released = ROW_COUNT;   -- rows affected by the previous statement

    -- 2. Cancel pending orders that have no seats left.
    --    This is a separate statement on purpose: each statement sees the effects of the
    --    statements before it, so NOT EXISTS sees that the tickets above are gone.
    --    (Inside ONE statement, e.g. WITH d AS (DELETE ...) UPDATE ..., it would not.)
    --    FOR UPDATE SKIP LOCKED: an order that a customer is adding a seat to right now is
    --    locked by their transaction; skip it instead of waiting or cancelling it.
    UPDATE orders
    SET status = 'cancelled'
    WHERE order_id IN (
        SELECT o.order_id
        FROM orders o
        WHERE o.status = 'pending'
          AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.order_id)
        FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS cancelled = ROW_COUNT;
END;
$$;

-- 05_expired_holds.sql
-- Cleanup job: held tickets whose 10-minute hold has run out, so their seats can be released.
-- This runs every minute, so it must be fast even though tickets has 1M rows.

SELECT ticket_id, order_id, event_id, seat_id, held_until
FROM tickets
WHERE status = 'held'
  AND held_until < now()
ORDER BY held_until;

-- BEFORE: 100 ms, Parallel Seq Scan over 1M tickets to find 346 held ones.
-- AFTER migration 014 (partial index on held_until WHERE status = 'held'): 0.11 ms, ~900x faster.
-- The index is only 16 kB because it contains held tickets only.

-- ticket_fingerprint.sql
-- A checksum of every ticket's ORIGINAL columns. Run it before and after a migration on
-- tickets: if the output is identical, no row was lost, added or changed.
-- (md5 of all rows, in ticket_id order, joined into one long string.)

SELECT count(*)                                   AS tickets,
       md5(string_agg(concat_ws('|', ticket_id, order_id, event_id, seat_id, status,
                                price, held_until, created_at), ',' ORDER BY ticket_id)) AS checksum
FROM tickets;

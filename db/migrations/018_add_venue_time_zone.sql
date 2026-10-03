-- 018_add_venue_time_zone.sql
-- Each venue's time zone, so event times can be shown in the venue's local time
-- (a 7:30 PM show in New York should read "7:30 PM", whatever the viewer's time zone).
--
-- Adding a NOT NULL column to a table that already has rows takes three steps:
--   1. add it as nullable,  2. fill it in for existing rows,  3. then make it NOT NULL.
-- Doing it in one step would fail: the existing rows would have NULL.
-- All three run in one transaction, so nobody ever sees the half-done state.

BEGIN;

ALTER TABLE venues ADD COLUMN time_zone text;

UPDATE venues v
SET time_zone = z.zone
FROM (VALUES ('New York', 'America/New_York'), ('Boston', 'America/New_York'),
             ('Atlanta', 'America/New_York'), ('Chicago', 'America/Chicago'),
             ('Austin', 'America/Chicago'), ('Nashville', 'America/Chicago'),
             ('Denver', 'America/Denver'), ('Los Angeles', 'America/Los_Angeles'),
             ('Seattle', 'America/Los_Angeles'), ('San Francisco', 'America/Los_Angeles')
     ) AS z (city, zone)
WHERE z.city = v.city;

ALTER TABLE venues ALTER COLUMN time_zone SET NOT NULL;

COMMIT;

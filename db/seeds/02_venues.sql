-- 02_venues.sql
-- 40 venues in 10 cities, 4-8 sections each, ~100k seats.

-- generate_series(1, 40) produces the numbers 1..40; each becomes one venue.
-- Name parts are picked by position so all 40 names are distinct.
INSERT INTO venues (name, address, city)
SELECT
    (ARRAY['Grand', 'Royal', 'Majestic', 'Union', 'Liberty', 'Riverside', 'Harbor', 'Summit'])[(i - 1) % 8 + 1]
        || ' ' ||
    (ARRAY['Theater', 'Music Hall', 'Arena', 'Amphitheater', 'Opera House'])[(i - 1) / 8 + 1],
    (100 + i * 37) || ' ' ||
    (ARRAY['Main', 'Broadway', 'Market', 'Park', 'Oak', 'Elm', 'Lake', 'Hill'])[(i - 1) % 8 + 1] || ' St',
    (ARRAY['New York', 'Chicago', 'Los Angeles', 'Austin', 'Seattle',
           'Boston', 'Nashville', 'Denver', 'Atlanta', 'San Francisco'])[(i - 1) % 10 + 1]
FROM generate_series(1, 40) AS i;

-- Each venue gets 4 to 8 sections. The generate_series can use v.venue_id because
-- a function in FROM may refer to tables listed before it (an implicit LATERAL join).
INSERT INTO sections (venue_id, name)
SELECT v.venue_id,
       (ARRAY['Floor', 'Box', 'Orchestra', 'Lower Tier', 'Mezzanine', 'Upper Tier', 'Balcony', 'Gallery'])[s]
FROM venues v, generate_series(1, 4 + v.venue_id % 5) AS s;

-- Each section gets a random number of rows (10-25, labelled A-Y) and seats per row (15-35).
-- The CTE contains random(), so PostgreSQL computes it once per section instead of
-- inlining it, which keeps each section's size consistent across its rows.
WITH section_size AS (
    SELECT section_id,
           10 + floor(random() * 16)::int AS row_count,
           15 + floor(random() * 21)::int AS seats_per_row
    FROM sections
)
INSERT INTO seats (section_id, row_label, seat_number)
SELECT ss.section_id, chr(64 + r), n
FROM section_size ss,
     generate_series(1, ss.row_count) AS r,
     generate_series(1, ss.seats_per_row) AS n;

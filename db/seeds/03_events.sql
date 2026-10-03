-- 03_events.sql
-- 2,000 performers and 1,000 events (25 per venue) from ~18 months ago to ~5 months ahead,
-- each with 1-3 performers and a price for every section of its venue.

-- Performer names: half are bands ("The Velvet Owls"), half are people ("Maya Chen").
-- Duplicate names can happen, on purpose: performer names are not unique.
WITH w AS (
    SELECT ARRAY['Velvet', 'Electric', 'Midnight', 'Golden', 'Silver', 'Crimson', 'Wild', 'Lonely',
                 'Neon', 'Northern', 'Broken', 'Sonic', 'Paper', 'Crystal', 'Atomic', 'Hollow',
                 'Burning', 'Quiet', 'Lucky', 'Cosmic', 'Rusty', 'Little', 'Iron', 'Blue', 'Savage'] AS adj,
           ARRAY['Owls', 'Wolves', 'Hearts', 'Rivers', 'Kings', 'Ghosts', 'Lights', 'Machines',
                 'Tigers', 'Saints', 'Roses', 'Echoes', 'Comets', 'Sparrows', 'Giants', 'Shadows',
                 'Pilots', 'Dreamers', 'Foxes', 'Strangers', 'Waves', 'Bandits', 'Mirrors', 'Crows', 'Rebels'] AS noun,
           ARRAY['Maya', 'Leo', 'Ava', 'Noah', 'Zoe', 'Eli', 'Mia', 'Jack', 'Lily', 'Owen',
                 'Ruby', 'Sam', 'Nora', 'Ivan', 'Aria', 'Kai', 'Elena', 'Omar', 'Chloe', 'Luca',
                 'Hana', 'Diego', 'Grace', 'Ravi', 'Isla', 'Theo', 'Amara', 'Felix', 'Yuki', 'Jonah'] AS first,
           ARRAY['Chen', 'Rivera', 'Okafor', 'Novak', 'Patel', 'Silva', 'Kim', 'Murphy', 'Haddad', 'Larsen',
                 'Rossi', 'Tanaka', 'Moreau', 'Kowalski', 'Mensah', 'Nguyen', 'Fischer', 'Costa', 'Ali', 'Brooks',
                 'Ward', 'Ortiz', 'Sato', 'Becker', 'Dubois', 'Shah', 'Price', 'Lund', 'Reyes', 'Stone'] AS last
)
INSERT INTO performers (name)
SELECT CASE WHEN i % 2 = 0
            THEN 'The ' || w.adj[1 + floor(random() * cardinality(w.adj))::int]
                 || ' '  || w.noun[1 + floor(random() * cardinality(w.noun))::int]
            ELSE w.first[1 + floor(random() * cardinality(w.first))::int]
                 || ' '  || w.last[1 + floor(random() * cardinality(w.last))::int]
       END
FROM w, generate_series(1, 2000) AS i;

-- Events: 25 per venue, one every 28 days plus 0-20 days of random jitter.
-- Because 28 > 20, two events at one venue can never land on the same day,
-- so the UNIQUE (venue_id, starts_at) rule is never broken.
-- Shows start at 7:30 PM *local time*: "date + time AT TIME ZONE zone" converts a
-- wall-clock time in that city into an exact timestamptz moment.
WITH slots AS (
    SELECT v.venue_id, v.time_zone AS zone,
           current_date - 540 + (k - 1) * 28 + floor(random() * 21)::int AS show_date,
           (ARRAY['Midnight', 'Summer', 'Electric', 'Homecoming', 'Farewell', 'Golden Hour',
                  'Unplugged', 'Neon Nights', 'Wildfire', 'After Dark'])[1 + floor(random() * 10)::int]
           || ' ' ||
           (ARRAY['Tour', 'Live', 'Sessions', 'Revue', 'Festival', 'Show'])[1 + floor(random() * 6)::int] AS title
    FROM venues v,
    generate_series(1, 25) AS k
)
INSERT INTO events (venue_id, title, starts_at, ends_at)
SELECT venue_id,
       title,
       (show_date + time '19:30') AT TIME ZONE zone,
       (show_date + time '19:30') AT TIME ZONE zone + interval '3 hours'
FROM slots;

-- Each event gets 1-3 performers. Stepping by 211 (mod 2000) from a random start
-- always gives distinct performers, so the primary key is never violated.
WITH pick AS (
    SELECT event_id,
           floor(random() * 2000)::int     AS start_at,
           1 + floor(random() * 3)::int    AS performer_count
    FROM events
)
INSERT INTO event_performers (event_id, performer_id)
SELECT event_id, (start_at + k * 211) % 2000 + 1
FROM pick, generate_series(1, pick.performer_count) AS k;

-- Prices: each event has a base price ($30-100), multiplied per section type.
-- Rounded to whole dollars minus one cent, e.g. 59.99.
WITH event_base AS (
    SELECT event_id, venue_id, 30 + random() * 70 AS base
    FROM events
)
INSERT INTO event_section_prices (event_id, section_id, price)
SELECT eb.event_id, s.section_id, round(eb.base * m.multiplier) - 0.01
FROM event_base eb
JOIN sections s ON s.venue_id = eb.venue_id
JOIN (VALUES ('Box', 2.5), ('Floor', 2.0), ('Orchestra', 1.8), ('Lower Tier', 1.4),
             ('Mezzanine', 1.2), ('Upper Tier', 0.9), ('Balcony', 0.8), ('Gallery', 0.6)
     ) AS m (section_name, multiplier) ON m.section_name = s.name;

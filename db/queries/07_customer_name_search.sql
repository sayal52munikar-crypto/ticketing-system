-- 07_customer_name_search.sql
-- Admin: search customers by the start of their name, ignoring capitalization.
-- Parameters in the app: the typed text + '%'. 'mary sm%' is the example value here.

SELECT customer_id, full_name, email
FROM customers
WHERE lower(full_name) LIKE 'mary sm%'
ORDER BY lower(full_name)
LIMIT 50;

-- BEFORE: 33 ms, Seq Scan over 100k customers.
-- AFTER migration 016 (index on lower(full_name) text_pattern_ops): 0.07 ms, ~490x faster.
-- The database collation is English_Australia.1252 (not "C"), so a plain index
-- could NOT serve LIKE. text_pattern_ops is what makes the prefix search work.
-- A pattern starting with % ('%smith') still needs a full scan (a pg_trgm index can fix that).

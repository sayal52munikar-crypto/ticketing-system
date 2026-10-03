-- 03_customer_by_email.sql
-- Login / My tickets: find a customer by email, ignoring capitalization.
-- Parameters in the app: email = $1.

SELECT customer_id, email, full_name
FROM customers
WHERE lower(email) = lower('Luis.Green4242@Example.com');

-- RESULT: 0.02 ms, Index Scan on customers_email_lower_unique (migration 008).
-- Experiment: "WHERE email = '...'" without lower() takes 41 ms (Seq Scan over 100k rows),
-- ~2,000x slower, because an index on lower(email) only matches queries that also say lower(email).
-- Lesson: an expression index is used only when the query uses the exact same expression.

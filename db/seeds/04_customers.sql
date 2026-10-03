-- 04_customers.sql
-- 100,000 customers. The number i is part of each email, so every email is unique.
-- Customers signed up 2-3 years ago, before the earliest seeded order.

WITH w AS (
    SELECT ARRAY['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
                 'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
                 'Thomas', 'Sarah', 'Carlos', 'Karen', 'Daniel', 'Lisa', 'Matthew', 'Nancy',
                 'Anthony', 'Betty', 'Mark', 'Sandra', 'Wei', 'Ashley', 'Ahmed', 'Emily',
                 'Hiroshi', 'Priya', 'Luis', 'Fatima', 'Kevin', 'Sofia', 'Brian', 'Aisha',
                 'George', 'Olivia', 'Raj', 'Emma', 'Dmitri', 'Grace', 'Juan', 'Chloe', 'Kofi', 'Hannah'] AS first,
           ARRAY['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
                 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
                 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
                 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
                 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
                 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts'] AS last,
           ARRAY['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'example.com'] AS domain
),
person AS (
    -- random() is in the select list, so it runs once per generated row.
    SELECT i,
           w.first[1 + floor(random() * cardinality(w.first))::int]   AS first_name,
           w.last[1 + floor(random() * cardinality(w.last))::int]     AS last_name,
           w.domain[1 + floor(random() * cardinality(w.domain))::int] AS domain
    FROM w, generate_series(1, 100000) AS i
)
INSERT INTO customers (email, full_name, created_at)
SELECT lower(first_name || '.' || last_name || i || '@' || domain),
       first_name || ' ' || last_name,
       now() - interval '2 years' - random() * interval '1 year'
FROM person;

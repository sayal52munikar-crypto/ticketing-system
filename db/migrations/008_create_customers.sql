-- 008_create_customers.sql
-- A customer is a person who buys tickets.

BEGIN;

CREATE TABLE customers (
    customer_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email        text        NOT NULL,
    full_name    text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT customers_email_format     CHECK (email ~ '^[^@\s]+@[^@\s]+$'),
    CONSTRAINT customers_full_name_not_blank CHECK (btrim(full_name) <> '')
);

-- A plain UNIQUE (email) would allow both 'Ana@x.com' and 'ana@x.com'.
-- Indexing lower(email) makes uniqueness case-insensitive.
CREATE UNIQUE INDEX customers_email_lower_unique ON customers (lower(email));

COMMIT;

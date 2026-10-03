-- 009_create_orders.sql
-- An order is one checkout by one customer. It groups one or more tickets.
-- There is no total column: the total is the sum of its tickets' prices.

BEGIN;

CREATE TABLE orders (
    order_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id  integer     NOT NULL,
    status       text        NOT NULL DEFAULT 'pending',
    created_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT orders_customer_fk
        FOREIGN KEY (customer_id) REFERENCES customers (customer_id) ON DELETE RESTRICT,
    CONSTRAINT orders_status_valid CHECK (status IN ('pending', 'paid', 'cancelled'))
);

-- Foreign keys are not indexed automatically. Serves "orders for customer X" (My tickets page).
CREATE INDEX orders_customer_id_idx ON orders (customer_id);

COMMIT;

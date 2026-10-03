-- 011_create_payments.sql
-- A payment is one (simulated) payment attempt for an order.
-- An order can have several failed attempts but at most one successful payment.

BEGIN;

CREATE TABLE payments (
    payment_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id    bigint        NOT NULL,
    amount      numeric(10,2) NOT NULL,
    status      text          NOT NULL,
    created_at  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT payments_order_fk
        FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE RESTRICT,
    CONSTRAINT payments_amount_positive CHECK (amount > 0),
    CONSTRAINT payments_status_valid CHECK (status IN ('succeeded', 'failed'))
);

CREATE UNIQUE INDEX payments_one_success_per_order
    ON payments (order_id)
    WHERE status = 'succeeded';

-- Serves "all payment attempts for order X".
CREATE INDEX payments_order_id_idx ON payments (order_id);

COMMIT;

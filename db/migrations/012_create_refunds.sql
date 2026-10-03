-- 012_create_refunds.sql
-- A refund is a customer's request to get money back for one ticket.
--   requested = waiting for a decision (decided_at is empty)
--   approved / rejected = decided (decided_at is set)

BEGIN;

CREATE TABLE refunds (
    refund_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ticket_id     bigint        NOT NULL,
    status        text          NOT NULL DEFAULT 'requested',
    amount        numeric(10,2) NOT NULL,
    reason        text,
    requested_at  timestamptz   NOT NULL DEFAULT now(),
    decided_at    timestamptz,

    CONSTRAINT refunds_ticket_fk
        FOREIGN KEY (ticket_id) REFERENCES tickets (ticket_id) ON DELETE RESTRICT,
    CONSTRAINT refunds_status_valid CHECK (status IN ('requested', 'approved', 'rejected')),
    CONSTRAINT refunds_amount_positive CHECK (amount > 0),
    CONSTRAINT refunds_decided_at_matches_status CHECK ((status = 'requested') = (decided_at IS NULL)),
    CONSTRAINT refunds_decided_after_requested CHECK (decided_at >= requested_at)
);

-- At most one open or approved refund per ticket. A rejected request doesn't block a new one.
CREATE UNIQUE INDEX refunds_one_active_per_ticket
    ON refunds (ticket_id)
    WHERE status IN ('requested', 'approved');

-- Serves "all refund requests for ticket X", including rejected ones.
CREATE INDEX refunds_ticket_id_idx ON refunds (ticket_id);

COMMIT;

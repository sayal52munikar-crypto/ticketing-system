-- 010_create_tickets.sql
-- A ticket is one seat at one event, inside an order.
--   held     = reserved for 10 minutes during checkout (held_until says when it expires)
--   sold     = paid for
--   refunded = refund approved; the seat can be sold again
-- Expired holds are deleted by the app, which frees the seat.

BEGIN;

CREATE TABLE tickets (
    ticket_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id    bigint        NOT NULL,
    event_id    integer       NOT NULL,
    seat_id     integer       NOT NULL,
    status      text          NOT NULL DEFAULT 'held',
    price       numeric(10,2) NOT NULL,  -- copied from event_section_prices when held; never changes after
    held_until  timestamptz,
    created_at  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT tickets_order_fk
        FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE RESTRICT,
    CONSTRAINT tickets_event_fk
        FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE RESTRICT,
    CONSTRAINT tickets_seat_fk
        FOREIGN KEY (seat_id) REFERENCES seats (seat_id) ON DELETE RESTRICT,
    CONSTRAINT tickets_status_valid CHECK (status IN ('held', 'sold', 'refunded')),
    CONSTRAINT tickets_price_not_negative CHECK (price >= 0),
    -- Held tickets must have an expiry time; sold and refunded tickets must not.
    CONSTRAINT tickets_held_until_matches_status CHECK ((status = 'held') = (held_until IS NOT NULL))
);

-- A seat can be held or sold only once per event.
-- Partial index: refunded tickets are ignored, so a refunded seat can be sold again.
-- Also serves the seat map query ("active tickets for event X").
CREATE UNIQUE INDEX tickets_event_seat_active_unique
    ON tickets (event_id, seat_id)
    WHERE status IN ('held', 'sold');

-- Serves "tickets in order X".
CREATE INDEX tickets_order_id_idx ON tickets (order_id);

COMMIT;

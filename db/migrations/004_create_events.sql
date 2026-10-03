-- 004_create_events.sql
-- An event is one show at a venue at a specific time (e.g. Hamlet, Apollo Theater, Fri 8 PM).

CREATE TABLE events (
    event_id    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venue_id    integer     NOT NULL,
    title       text        NOT NULL,
    starts_at   timestamptz NOT NULL,
    ends_at     timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT events_venue_fk
        FOREIGN KEY (venue_id) REFERENCES venues (venue_id) ON DELETE RESTRICT,
    CONSTRAINT events_title_not_blank   CHECK (btrim(title) <> ''),
    CONSTRAINT events_ends_after_starts CHECK (ends_at > starts_at),
    CONSTRAINT events_venue_starts_unique UNIQUE (venue_id, starts_at)
);

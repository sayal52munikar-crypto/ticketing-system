-- 006_create_event_performers.sql
-- Junction table: which performers appear at which event (many-to-many).
-- Rows are pure links with no history of their own, so they are deleted
-- together with their event or performer (ON DELETE CASCADE).

BEGIN;

CREATE TABLE event_performers (
    event_id      integer NOT NULL,
    performer_id  integer NOT NULL,

    CONSTRAINT event_performers_pk PRIMARY KEY (event_id, performer_id),
    CONSTRAINT event_performers_event_fk
        FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE CASCADE,
    CONSTRAINT event_performers_performer_fk
        FOREIGN KEY (performer_id) REFERENCES performers (performer_id) ON DELETE CASCADE
);

-- The primary key index starts with event_id, so it serves "performers for event X".
-- This one serves the reverse: "events for performer X".
CREATE INDEX event_performers_performer_id_idx ON event_performers (performer_id);

COMMIT;

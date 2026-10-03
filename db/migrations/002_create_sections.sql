-- 002_create_sections.sql
-- A section is a named area inside a venue (Orchestra, Mezzanine, Balcony).

CREATE TABLE sections (
    section_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    venue_id    integer     NOT NULL,
    name        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT sections_venue_fk
        FOREIGN KEY (venue_id) REFERENCES venues (venue_id) ON DELETE RESTRICT,
    CONSTRAINT sections_name_not_blank   CHECK (btrim(name) <> ''),
    CONSTRAINT sections_venue_name_unique UNIQUE (venue_id, name)
);
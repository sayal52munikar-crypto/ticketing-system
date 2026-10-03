-- 005_create_performers.sql
-- A performer is an artist, band or actor who appears at events.
-- Names are NOT unique: different real bands can share a name.

CREATE TABLE performers (
    performer_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT performers_name_not_blank CHECK (btrim(name) <> '')
);

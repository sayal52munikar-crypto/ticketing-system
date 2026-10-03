-- 001_create_venues.sql
-- A venue is a place where events happen (a concert hall, a theater, a stadium).

CREATE TABLE venues (
    venue_id    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text        NOT NULL,
    address     text        NOT NULL,
    city        text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT venues_name_not_blank    CHECK (btrim(name) <> ''),
    CONSTRAINT venues_address_not_blank CHECK (btrim(address) <> ''),
    CONSTRAINT venues_city_not_blank    CHECK (btrim(city) <> ''),
    CONSTRAINT venues_name_city_unique  UNIQUE (name, city)
);
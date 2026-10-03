-- 003_create_seats.sql
-- A seat is one physical seat inside a section (e.g. Orchestra, Row C, Seat 12).

CREATE TABLE seats (
    seat_id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    section_id   integer     NOT NULL,
    row_label    text        NOT NULL,
    seat_number  integer     NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT seats_section_fk
        FOREIGN KEY (section_id) REFERENCES sections (section_id) ON DELETE RESTRICT,
    CONSTRAINT seats_row_label_not_blank CHECK (btrim(row_label) <> ''),
    CONSTRAINT seats_seat_number_positive CHECK (seat_number > 0),
    CONSTRAINT seats_section_row_number_unique UNIQUE (section_id, row_label, seat_number)
);
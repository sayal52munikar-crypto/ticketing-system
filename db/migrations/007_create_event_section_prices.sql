-- 007_create_event_section_prices.sql
-- The price of a section depends on BOTH the event and the section
-- (the Balcony costs more for a big concert than for a local play),
-- so it lives in its own table instead of on events or sections (3NF).

CREATE TABLE event_section_prices (
    event_id    integer       NOT NULL,
    section_id  integer       NOT NULL,
    price       numeric(10,2) NOT NULL,

    CONSTRAINT event_section_prices_pk PRIMARY KEY (event_id, section_id),
    CONSTRAINT event_section_prices_event_fk
        FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE RESTRICT,
    CONSTRAINT event_section_prices_section_fk
        FOREIGN KEY (section_id) REFERENCES sections (section_id) ON DELETE RESTRICT,
    CONSTRAINT event_section_prices_price_not_negative CHECK (price >= 0)
);

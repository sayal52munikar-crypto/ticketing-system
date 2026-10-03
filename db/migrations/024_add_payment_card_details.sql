-- 024_add_payment_card_details.sql
-- Which card paid: the brand and the last 4 digits, as shown on a receipt ("Mastercard •••• 4444").
--
-- The full card number and the security code (CVC) are NEVER stored. Card security rules (PCI DSS)
-- forbid keeping the CVC at all, and a table without card numbers is a table that can't leak them.
--
-- Both columns are nullable: the ~470k seeded payments have no card details. Adding a nullable
-- column without a default is instant. The CHECKs scan the existing rows once, which is quick
-- here because all those rows hold NULL.

BEGIN;

ALTER TABLE payments
    ADD COLUMN card_brand text,
    ADD COLUMN card_last4 text;

ALTER TABLE payments
    ADD CONSTRAINT payments_card_brand_valid
        CHECK (card_brand IN ('visa', 'mastercard', 'amex', 'discover')),
    ADD CONSTRAINT payments_card_last4_format
        CHECK (card_last4 ~ '^[0-9]{4}$'),
    -- Both or neither: a brand without digits (or the reverse) is a half-recorded card.
    ADD CONSTRAINT payments_card_details_together
        CHECK ((card_brand IS NULL) = (card_last4 IS NULL));

COMMIT;

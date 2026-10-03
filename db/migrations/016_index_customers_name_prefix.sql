-- 016_index_customers_name_prefix.sql
-- Serves db/queries/07_customer_name_search.sql (LIKE 'mary sm%').
--
-- Expression index on lower(full_name), because the query searches lower(full_name).
-- text_pattern_ops makes the index compare characters byte by byte instead of using
-- the database's language rules (collation). Only that kind of index can answer a
-- prefix LIKE. A normal index on a non-"C" collation database can't be used for LIKE.
-- It only helps patterns that START with fixed text: 'mary%' yes, '%smith' no.

CREATE INDEX customers_full_name_prefix_idx
    ON customers (lower(full_name) text_pattern_ops);

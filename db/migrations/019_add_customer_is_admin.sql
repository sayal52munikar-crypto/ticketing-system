-- 019_add_customer_is_admin.sql
-- Marks which accounts may open the admin dashboard.
--
-- A column with a constant DEFAULT can be added as NOT NULL in one step: PostgreSQL
-- records the default once instead of rewriting every row, so this is instant
-- even on a big table.

ALTER TABLE customers ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

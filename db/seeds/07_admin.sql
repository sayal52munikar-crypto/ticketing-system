-- 07_admin.sql
-- One admin account for the dashboard. Log in with this email (no password; logins are simulated).

INSERT INTO customers (email, full_name, is_admin)
VALUES ('admin@example.com', 'Site Admin', true);

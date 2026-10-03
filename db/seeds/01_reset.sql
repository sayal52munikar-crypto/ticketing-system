-- 01_reset.sql
-- Empties every table and restarts all ID counters at 1, so seeding can be re-run.
-- TRUNCATE is much faster than DELETE: it drops the data files instead of removing rows one by one.
-- All 13 tables are listed together, so foreign keys between them are not a problem.

TRUNCATE venues, sections, seats, events, performers, event_performers,
         event_section_prices, customers, orders, tickets, payments,
         refunds, refund_audit_log
RESTART IDENTITY;

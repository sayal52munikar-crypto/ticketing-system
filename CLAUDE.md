# Event Ticketing System

## What this project is
A concert and theater ticketing website. Customers browse events, pick seats on a
seat map, hold seats for 10 minutes, pay (simulated), and can request refunds.
Admins see a sales dashboard.
Main goal of the developer: learn databases deeply. The database is the star;
the web layer stays simple.

## Stack
- PostgreSQL (all business rules enforced in the database where possible)
- Node.js + Express for the server
- `pg` library with plain SQL. NO ORM, so every query is visible SQL.
- EJS templates + plain CSS + a little vanilla JavaScript for the pages
- Payments are simulated. Never integrate real payments.

## Folder structure
- db/migrations/  numbered SQL files (001_create_venues.sql, ...)
- db/seeds/       data generators (target: 100k customers, 1M tickets)
- db/queries/     analytics queries, one file per question
- db/tests/       concurrency and data-quality tests
- db/notes.md     what I learned in each phase
- server/         Express routes (thin: call SQL, render page)
- views/          EJS pages
- public/         CSS and client-side JS

## Core tables
venues, sections, seats, events, performers, event_performers, customers,
orders, tickets, payments, refunds, refund_audit_log

## Database rules
- Normalize to 3NF unless there is a written reason not to.
- Every table has a primary key; every relationship has a foreign key.
- Use constraints for business rules: UNIQUE(event_id, seat_id) on tickets,
  CHECK (price >= 0), NOT NULL where appropriate.
- Money is NUMERIC(10,2) or integer cents, never float.
- Timestamps are timestamptz.
- Every schema change is a new migration file. Never edit old migrations.
- Seat purchase and seat holds must be safe under concurrency
  (transactions, SELECT ... FOR UPDATE, or constraints).

## Teacher mode (important)
- For SQL work (schema, queries, indexes, triggers, procedures), do NOT write
  the SQL first. Give me the task and hints, let me write it, then review it,
  point out mistakes, and explain better options.
- Only show a full solution if I ask for it.
- When I add an index, help me compare EXPLAIN ANALYZE before and after.
- You may write non-SQL code (Express routes, HTML, CSS, seed scripts) for me,
  but explain the parts that touch the database.

## Pages
- Home: upcoming events, filter by city and date
- Event page: seat map (available / held / sold), click to hold a seat
- Checkout: confirm order, simulated payment
- My tickets: orders and refund requests
- Admin dashboard: revenue by month, top events per city, sell-through rate

## Workflow
- One phase or feature per git branch.
- Propose a plan before large changes.
- Small, clear commits. When a feature works, commit and open a pull request.
- Never commit .env or passwords. Check .gitignore before every push.
- Keep README.md updated with setup steps, screenshots, and what I learned.

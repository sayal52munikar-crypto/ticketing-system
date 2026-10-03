# Event Ticketing System

A concert and theater ticketing website built to learn databases deeply.
PostgreSQL enforces the business rules; the web layer (Node.js + Express + EJS) stays simple.

## Setup

1. Install Node.js and PostgreSQL 17.
2. Create the database:
   ```
   createdb -U postgres ticketing
   ```
3. Copy `.env.example` to `.env` and put in your `postgres` password.
4. Create the tables by running each migration in order:
   ```
   psql -U postgres -d ticketing -f db/migrations/001_create_venues.sql
   ...
   psql -U postgres -d ticketing -f db/migrations/017_index_payments_recent_revenue.sql
   ```
5. Install dependencies and load the sample data (~1M tickets, 100k customers; takes about 2 minutes).
   **This wipes all existing data first.**
   ```
   npm install
   npm run seed
   ```
6. Optionally, check that every database rule works:
   ```
   psql -U postgres -d ticketing -f db/tests/constraints_test.sql
   ```
7. Start the server and open http://localhost:3000
   ```
   npm start
   ```

## Analytics queries

`db/queries/` has one file per question (seat map, my tickets, revenue by month, top events per city, ...).
Each file ends with its measured timings. To see a query's plan and timing yourself:
```
npm run explain -- db/queries/05_expired_holds.sql
```

## What I learned

See [db/notes.md](db/notes.md).

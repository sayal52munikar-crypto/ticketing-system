# Event Ticketing System

A concert and theater ticketing website built to learn databases deeply.
PostgreSQL enforces the business rules; the web layer (Node.js + Express + EJS) stays simple.

## Setup

1. Install Node.js and PostgreSQL 17.
2. Create the database:
   ```
   createdb -U postgres ticketing
   ```
3. Copy `.env.example` to `.env`, put in your `postgres` password, and set `SESSION_SECRET`
   to any long random string.
4. Create the tables by running each migration in order:
   ```
   psql -U postgres -d ticketing -f db/migrations/001_create_venues.sql
   ...
   psql -U postgres -d ticketing -f db/migrations/021_create_release_expired_holds_procedure.sql
   ```
5. Install dependencies and load the sample data (~1M tickets, 100k customers; about 75 seconds, loaded with `COPY`).
   **This wipes all existing data first.**
   ```
   npm install
   npm run seed
   ```
   For a smaller database (e.g. ~100k tickets in 7 seconds), set `SEED_SCALE` between 0 and 1:
   ```
   SEED_SCALE=0.1 npm run seed             # Git Bash / macOS / Linux
   $env:SEED_SCALE="0.1"; npm run seed     # PowerShell
   ```
6. Optionally, check that every database rule works:
   ```
   psql -U postgres -d ticketing -f db/tests/constraints_test.sql
   ```
7. Start the server and open http://localhost:3000
   ```
   npm start
   ```

## Using the site

| Page | URL | What you can do |
|---|---|---|
| Home | `/` | Browse upcoming events; filter by city and date |
| Event | `/events/:id` | Seat map (green = available). Click a seat to hold it for 10 minutes |
| Checkout | `/checkout` | See held seats with a countdown, release seats, pay (or simulate a declined card) |
| My tickets | `/my-tickets` | Your tickets; request a refund for future events |
| Admin | `/admin` | Revenue by month, top events per city, sell-through, refund queue (approve/reject) |

Logging in only needs an email (payments and accounts are simulated). A new email creates an account.
For the admin dashboard, log in as **admin@example.com**.

A background job runs every minute and calls the database procedure `release_expired_holds()` to release seats whose 10-minute hold has expired.

## Analytics queries

`db/queries/` has one file per question (seat map, my tickets, revenue by month, top events per city, ...).
Each file ends with its measured timings. To see a query's plan and timing yourself:
```
npm run explain -- db/queries/05_expired_holds.sql
```

## What I learned

See [db/notes.md](db/notes.md).

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
4. Install dependencies and create the tables. `npm run migrate` applies every file in
   `db/migrations/` that hasn't run yet, and records it in the `schema_migrations` table:
   ```
   npm install
   npm run migrate
   ```
5. Load the sample data (~1M tickets, 100k customers, loaded with `COPY`).
   **This wipes all existing data first.**
   ```
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

## Deploying to Render (free)

`render.yaml` is a Render Blueprint: it creates the web app **and** a PostgreSQL database.

1. Sign in at [render.com](https://render.com) with your GitHub account.
2. **New → Blueprint**, pick the `ticketing-system` repository, and click **Apply**.
3. Wait for the first deploy (a few minutes). On every start the app runs
   `npm run migrate` → seeds a small dataset **only if the database is empty**
   (`SEED_SCALE=0.1`: ~100k tickets, ~48 MB) → starts the server.
4. Open the `https://ticketing-system-….onrender.com` URL Render shows.
   Log in as `admin@example.com` for the dashboard.

Good to know about the free plan:
- The app **sleeps after 15 minutes without visitors**; the next visit takes ~1 minute to wake it.
- The free database **expires after 30 days** (Render emails you first). Take a backup if you want to keep it.
- Logins are stored in the database (`sessions` table), so they survive restarts.
- To seed or inspect the hosted database from your laptop, copy its **External Database URL** from Render and run, e.g.
  `DATABASE_URL="<external url>" DATABASE_SSL=true npm run migrate`.

## Backups

```
npm run db:backup                 # pg_dump -> backups/ticketing-<time>.dump (~28 MB, ~7 s)
npm run db:restore                # restore the newest backup into "ticketing_restore" and compare it
npm run db:restore -- --drop-after   # same, then delete the copy
```
The restore never touches the live database: it restores into a separate one, then checks row counts,
indexes, constraints, triggers, procedures, the total of all ticket prices and the next order ID all match.
`backups/` is git-ignored because dumps contain customer data.

## Analytics queries

`db/queries/` has one file per question (seat map, my tickets, revenue by month, top events per city, ...).
Each file ends with its measured timings. To see a query's plan and timing yourself:
```
npm run explain -- db/queries/05_expired_holds.sql
```

## What I learned

See [db/notes.md](db/notes.md).

# What I learned

## Phase 0: Setup
- Installed PostgreSQL 17 and created the `ticketing` database.
- On Windows, connect with `-U postgres` (otherwise it uses the Windows username).

## Phase 1: Schema

### Keys
- `GENERATED ALWAYS AS IDENTITY` is the modern replacement for `SERIAL`. `ALWAYS` blocks
  inserting your own IDs, so they can never collide with the sequence.
- `integer` (up to ~2.1 billion) is fine for small tables; high-volume tables
  (`orders`, `tickets`, `payments`, `refunds`) use `bigint`.
- A foreign key column has the same type as the column it points to, and needs
  `NOT NULL` separately; a foreign key alone still allows NULL.

### Constraints
- `NOT NULL` doesn't stop `''`. `CHECK (btrim(name) <> '')` blocks blank and all-space text.
- Naming constraints (`CONSTRAINT venues_name_not_blank ...`) makes error messages readable.
- A `CHECK` can compare two columns: `CHECK (ends_at > starts_at)`.
- "A if and only if B" as a check: `CHECK ((status = 'held') = (held_until IS NOT NULL))`.
- `CHECK (status IN (...))` limits a column to a fixed list of values.

### ON DELETE
- `RESTRICT`: refuse to delete a parent that still has children. The safe default for business data.
- `CASCADE`: delete the children too. Only for pure link rows with no history (`event_performers`).

### Indexes
- Primary keys and `UNIQUE` constraints get an index automatically. **Foreign keys do not.**
- A multi-column index helps queries on its *first* column: `UNIQUE (venue_id, name)` also
  speeds up `WHERE venue_id = 5`, so no separate index on `venue_id` is needed.
- **Expression index:** `UNIQUE INDEX ON customers (lower(email))` makes uniqueness case-insensitive.
- **Partial index:** `UNIQUE INDEX ON tickets (event_id, seat_id) WHERE status IN ('held', 'sold')`
  stops a seat from being sold twice, but ignores refunded tickets so the seat can be sold again.
  Same idea for "one successful payment per order" and "one open refund per ticket".

### Normalization (3NF)
- Don't store what you can calculate: no `venues.capacity` (count the seats),
  no `orders.total` (sum the tickets).
- A fact belongs in the table of everything it depends on:
  - Seat status depends on event + seat → it lives on `tickets`, not `seats`.
  - Price depends on event + section → its own table, `event_section_prices`.
- `tickets.price` is *not* a duplicate of `event_section_prices.price`: it records what was
  actually charged at that moment, which must not change if prices change later.
- Many-to-many (events ↔ performers) needs a junction table with a two-column primary key.

### Time
- `timestamptz` stores an exact moment and displays it in the viewer's time zone.
  8 PM in New York shows as noon the next day in Australia (UTC+11): same moment, different display.

### Triggers
- A trigger runs a function automatically on INSERT/UPDATE/DELETE, so the app can't forget it.
- `refund_audit_log` is filled by an `AFTER INSERT OR UPDATE OF status` trigger.
  Inside the function, `OLD` and `NEW` are the row before and after the change.

### Testing constraints
- Try to break every rule on purpose. `db/tests/constraints_test.sql` does this inside a
  transaction and ends with `ROLLBACK`, so it leaves no data behind.
- A plpgsql `BEGIN ... EXCEPTION ... END` block catches an error without aborting the
  outer transaction.

### Open questions for later
- Nothing stops a ticket from pointing to a seat in a different venue from its event.
  (Composite foreign key or trigger?)
- Two events at one venue can overlap in time (8–11 PM and 9–10 PM). Exclusion constraints?
- Expired holds must be cleared safely under concurrency (`SELECT ... FOR UPDATE`).

## Phase 2: Seed data

Result: 40 venues, 106k seats, 1,000 events, 100k customers, 442k orders,
1.03M tickets, 463k payments, 20k refunds. `npm run seed` takes about 100 seconds.

### Set-based SQL instead of loops
- `generate_series(1, 100000)` produces 100k rows in one statement. One `INSERT ... SELECT`
  is far faster than 100k separate `INSERT`s sent from Node.
- A function in `FROM` can use columns of tables listed before it (an implicit LATERAL join):
  `FROM venues v, generate_series(1, 4 + v.venue_id % 5)` gives each venue its own number of sections.
- Temp tables (`CREATE TEMP TABLE ... AS SELECT`) hold intermediate steps and vanish when the session ends.

### random() gotchas
- **`ORDER BY random()` reuses its value.** In a query with `ORDER BY random() LIMIT n`, any other
  `random()` in the select list is treated as the same expression, so it gets the sort value.
  The lowest values sort first, so every row picked the first array element ('requested').
  Fix: pick the sample in a subquery, then call `random()` in the outer query.
- `setseed(0.42)` before using `random()` gives the same sequence each run.

### Bulk loading tricks
- `GENERATED ALWAYS` identity refuses explicit IDs, but `INSERT ... OVERRIDING SYSTEM VALUE`
  allows them for bulk loads. Afterwards, `setval(pg_get_serial_sequence('orders', 'order_id'), max)`
  moves the counter past the highest ID, or the next normal insert would collide.
- **Data-modifying CTE:** `WITH c AS (INSERT ... RETURNING order_id) INSERT INTO payments SELECT ... FROM c`
  feeds new IDs straight into a second insert, in one statement.
- `TRUNCATE ... RESTART IDENTITY` empties tables and resets IDs to 1, far faster than `DELETE`.
- The whole seed runs in **one transaction**: if any step fails, `ROLLBACK` leaves the
  database exactly as it was.
- `ANALYZE` after loading updates the planner's statistics so it plans for 1M rows, not 0.

### Time zones in practice
- `(date + time '19:30') AT TIME ZONE 'America/Chicago'` turns a local wall-clock time
  into an exact `timestamptz` moment. Each venue's shows start at 7:30 PM *in its own city*.

### Triggers and historical data
- The audit trigger stamps rows with `now()`, which is wrong for backfilled history. The seed uses
  `ALTER TABLE refunds DISABLE TRIGGER refunds_audit`, writes the log rows with the real times,
  then enables it again. Inside a transaction this is safe: a failure rolls the disable back too.

### Tests must not depend on existing data (Phase 2)
- The constraint test first borrowed "the first event and seat". After seeding, that event already
  had prices, so a test failed. Tests should create their own fixtures (inside a rolled-back transaction).

## Phase 3: Queries and indexes

Measured with `npm run explain -- <file>` (EXPLAIN ANALYZE, best of 3) on the seeded data.

| Query | Before | After | What changed |
|---|---|---|---|
| 01 upcoming events | 0.13 ms | — | Nothing: 1,000-row table, Seq Scan is fine |
| 02 seat map | 8.4 ms | — | Already uses the partial unique index (334 ms without it) |
| 03 customer by email | 0.02 ms | — | Already uses `lower(email)` index (41 ms without `lower()`) |
| 04 my tickets | 0.2 ms | — | Already uses FK indexes (110 ms without `orders_customer_id_idx`) |
| 05 expired holds | 100 ms | **0.11 ms** | Partial index (014), ~900x |
| 06 open refunds | 2.3 ms | **0.044 ms** | Partial index in sort order (015), ~50x |
| 07 name prefix search | 33 ms | **0.07 ms** | `text_pattern_ops` expression index (016), ~490x |
| 08 revenue by month | 210 ms | — | No index can help a whole-table total |
| 09 revenue last 30 days | 93 ms | **7 ms** | Covering partial index → Index Only Scan (017), ~13x |
| 10 top events per city | 348 ms | **150-175 ms** | Query rewrite (aggregate before join), not an index |
| 11 sell-through | 175-195 ms | — | Whole-table count, no index helps |

### Reading EXPLAIN ANALYZE
- Read the plan from the most indented line outwards: the innermost nodes run first.
- `Seq Scan` = read every row. `Index Scan` = look up rows in the index, then fetch them from the table.
  `Index Only Scan` = everything needed is in the index; the table isn't touched.
- `Rows Removed by Filter: 999,654` is the warning sign: the database read a million rows to keep a few.
- `loops=3` on a Parallel Seq Scan means 3 workers each did a share. `rows=` is per loop.
- Measure more than once: the first run reads from disk, later ones from memory.

### When an index helps
- When the query keeps a **small fraction** of a big table (05, 07, 09).
- When the index order **is** the `ORDER BY` order, a `LIMIT` can stop early, with no sort (06).
- **Partial index** (`WHERE status = 'held'`): indexes only the rows queries ask for. 16 kB instead of
  tens of MB, and inserts of other rows don't touch it. The query must repeat the same condition.
- **Expression index** (`lower(email)`): only used when the query uses the identical expression.
- **Covering index** (`INCLUDE (amount)`): adds extra columns so the table can be skipped entirely.
  Needs a recent VACUUM; check for `Heap Fetches: 0`.
- **LIKE 'abc%'** on a non-C collation needs `text_pattern_ops`. `'%abc'` can't use a B-tree at all.

### When an index doesn't help
- **Small tables** (01): reading 1,000 rows is faster than an index lookup.
- **Queries that need most rows** (08, 10, 11): a 31 MB covering index on tickets was simply ignored.
  Every index also costs disk space and slows down every INSERT/UPDATE on that table.
- For slow whole-table reports, the next tools are query rewrites and pre-computed summaries
  (materialized views), not more indexes.

### Query-writing lessons
- **Aggregate before joining** (10): totalling 1M tickets down to 1,000 events first, then joining,
  halved the time. Same result.
- **Fan-out:** joining two "many" tables (payments + refunds, seats + tickets) before summing
  multiplies rows and inflates totals. Total each side in its own CTE, then join (08, 11).
- **Window functions:** `rank() OVER (PARTITION BY city ORDER BY revenue DESC)` gives a
  "top N per group" ranking that `LIMIT` alone can't.

### Testing "what if this index didn't exist?"
- `BEGIN; DROP INDEX ...; EXPLAIN ANALYZE ...; ROLLBACK;` measures a query without an index,
  then puts it back as if nothing happened. (Only do this locally: DROP INDEX locks the table.)

## Phase 4: The website

### Transactions in the app
- `pool.query()` may use a different connection for every call, so `BEGIN` and `COMMIT` could land on
  different connections and do nothing. `withTransaction()` in `server/db.js` checks out ONE client,
  runs everything between `BEGIN` and `COMMIT` on it, and rolls back if anything throws.
- After an error inside a transaction, PostgreSQL refuses further statements until `ROLLBACK`.
  So a unique violation is caught *outside* `withTransaction()`, after the rollback.

### Holding a seat safely (`server/routes/events.js`)
1. `SELECT ... FROM customers WHERE customer_id = $1 FOR UPDATE` locks the customer's row,
   so two tabs of the same customer queue up instead of both creating a pending order.
2. Check the seat is in the event's venue (the schema can't enforce this, so the app does).
3. Find or create the pending order (the "cart").
4. Delete an expired hold on that seat, if the cleanup job hasn't yet.
5. `INSERT` the hold. **The partial unique index is the referee**: if someone else holds the seat,
   even in a transaction that hasn't committed yet, the INSERT waits for it, then fails.
   No "check if free, then insert" race is possible.

Tested: 10 customers clicking the same seat at the same instant → exactly 1 got it.
One customer holding 5 seats at once from 5 tabs → all 5 in one order.

### Paying (`server/routes/checkout.js`)
- `SELECT ... FROM orders ... FOR UPDATE` → two "Pay" clicks at once: the second waits, then finds the
  order is no longer pending. Tested: 1 payment, no double charge.
- `SELECT ... FROM tickets ... FOR UPDATE` on the live holds: until the payment commits, the cleanup job
  can't delete them, even if they expire mid-payment.
- `FOR UPDATE` can't be combined with aggregates like `sum()`; lock first, total in a second query.
- held → sold must also clear `held_until`, or the CHECK constraint from migration 010 rejects it.

### The cleanup job (`server/jobs/releaseExpiredHolds.js`)
- **All parts of one statement see the same snapshot.** In `WITH d AS (DELETE ...) UPDATE ... WHERE NOT EXISTS (tickets)`,
  the NOT EXISTS still sees the tickets being deleted. So the DELETE and the UPDATE are separate statements.
- `FOR UPDATE SKIP LOCKED`: skip a pending order another transaction has locked (someone adding a
  seat right now) instead of waiting for it or cancelling it.

### Security in the SQL
- **Always `$1` parameters**, never values pasted into the SQL string, so typed text can't change the query.
- **Ownership checks in the WHERE clause**: `INSERT INTO refunds ... SELECT ... WHERE t.ticket_id = $1 AND o.customer_id = $2`.
  Without `o.customer_id = $2`, changing the number in the URL would refund someone else's ticket. Tested.
- **Let constraints validate**: a bad email is rejected by the `customers_email_format` CHECK; the app
  just turns error code 23514 into a friendly message.
- `UPDATE refunds ... WHERE refund_id = $1 AND status = 'requested'`: the condition makes a decision
  one-time, so two admins clicking at once can't both approve.

### Schema changes found while building pages
- **Time zones:** to show "7:30 PM" for a New York show, the venue's time zone must be stored (migration 018).
  `to_char(e.starts_at AT TIME ZONE v.time_zone, ...)` formats it in local time.
- **Adding a NOT NULL column to a table with data:** add it nullable → fill it → `SET NOT NULL`, in one transaction.
- **A NOT NULL column with a constant DEFAULT** (migration 019, `is_admin`) is instant even on big tables:
  PostgreSQL stores the default once instead of rewriting rows.

### SQL tricks used in the pages
- `sum(t.price) OVER ()`: the order total on every row, without collapsing rows like GROUP BY.
- `$1::text IS NULL OR v.city = $1`: an optional filter in one query.
- `DELETE ... USING orders o WHERE ...`: a DELETE that joins to another table (to check ownership).
- The admin page loads its SQL straight from `db/queries/` files, so the measured queries are the ones that run.

### Still open
- `refund_audit_log.changed_by` always says `postgres` (the database user), not which admin clicked.
  Fix idea: `SET LOCAL app.user = '...'` in the transaction and read it in the trigger with `current_setting()`.
- The admin dashboard takes ~0.9 s because it totals 1M tickets on every load. A materialized view,
  refreshed every few minutes, would make it instant.

## Phase 2b: Loading with COPY

The big tables (customers, orders, tickets, payments) are now generated in JavaScript
(`db/seeds/04_customers.js`, `05_sales.js`) and streamed in with `COPY ... FROM STDIN`.

| | INSERT ... SELECT (before) | COPY (now) |
|---|---|---|
| Full seed | 98–135 s | **76 s** |
| Sales step | 85–109 s | 66 s (orders 10 s, tickets 45 s, payments 11 s) |
| `SEED_SCALE=0.1` | — | **7 s**, 107k tickets, 41 MB database |

### What I learned
- **COPY** sends plain CSV lines over one stream; PostgreSQL doesn't parse and plan a statement per row.
  Constraints, foreign keys, indexes and triggers all still apply.
- **Where the time goes now:** checking 3 foreign keys and updating 4 indexes for each of 1M tickets.
  The classic trick for huge loads is: drop indexes (and FKs) → COPY → recreate them, since building an
  index once is faster than updating it a million times. Not worth it at this size.
- **COPY can write into `GENERATED ALWAYS` identity columns** (INSERT needs `OVERRIDING SYSTEM VALUE`),
  but it doesn't move the identity counter, so `setval()` is still needed afterwards.
- **One connection = one COPY at a time.** Tickets need their orders first (foreign key), so the sales
  simulation runs three times with the **same random seed**, once per table. A seeded generator
  (`db/seeds/lib/random.js`) makes the same choices every pass, so the three tables match exactly.
  Every random draw must happen on every pass, or the passes drift apart.
- **Money in cents:** totals are added as integers, then formatted as `12.34`. Adding prices as
  JavaScript floats would produce totals like 183.97999999.
- **`set_config('seed.scale', '0.1', true)`** creates a custom setting for this transaction that SQL
  steps read with `current_setting('seed.scale')`. A way to pass a parameter into a plain .sql file.
- Checked after loading: every paid order's payment equals its ticket total, no ticket's seat is in
  another venue, no ticket price differs from its section's price (all 0 problems).

## Phase 4b: Dashboard charts

- The admin page now draws three Chart.js charts: revenue by month (gross/refunds bars + net line),
  revenue by city, and a sell-through histogram. Exact numbers stay available in tables.
- Two new query files: `12_revenue_by_city.sql` and `13_sell_through_histogram.sql` (~160 ms each).
- **`width_bucket(value, 0, 100, 10)`** sorts values into 10 equal buckets in SQL. Joining
  `generate_series(1, 10)` to the counts keeps empty buckets as 0 instead of dropping them.
- **Passing data to JavaScript safely:** the numbers go into `<script type="application/json">`,
  with `<` escaped as `\u003c`, so a title containing `</script>` can't break out and inject HTML.
- The Chart.js script tag has an `integrity` hash (Subresource Integrity): if the CDN file were
  ever changed, the browser would refuse to run it.

## Phase 5: Proving two people can never buy the same seat

`npm run test:race` (`db/tests/race_test.js`) calls the same `holdSeat()` / `payForOrder()` functions
the website uses (`server/booking.js`), with each buyer on their own connection, all started at once.

| Round | Scenario | Result |
|---|---|---|
| 1 | 50 buyers race for the last of 10 seats | exactly 1 wins (~250 ms), 49 told "taken", event has exactly 10 sold tickets |
| 2 | the last seat's hold expired, 49 buyers race | exactly 1 wins; the original holder can't pay any more |
| 3 | the winner clicks "Pay" twice at once | exactly 1 payment |

Passed 3 runs out of 3.

### The test has to be able to fail
Dropping `tickets_event_seat_active_unique` and rerunning: **all 50 buyers "got" the last seat and the
10-seat event had 59 sold tickets**. 7 checks failed. With the index back, everything passes.
So that one partial unique index is what makes double-booking impossible. Everything else in
`holdSeat()` is there to give friendly messages and keep the cart consistent.

### What I learned
- **Let the database be the referee.** "SELECT to check the seat is free, then INSERT" has a gap
  between the two statements where another buyer can slip in. A unique index has no gap: a second
  INSERT of the same (event, seat) waits for the first transaction, then fails.
- **Test the real code path.** Moving the hold/pay logic into `server/booking.js` lets the routes and
  the test share it, so the test can't pass while the website is broken.
- **Real concurrency needs real connections.** The pool's default of 10 connections would quietly
  turn 50 buyers into 5 waves of 10. The test raises `PG_POOL_MAX` and opens all connections first.
- **The database catches bugs in test code too:** my first version computed an event's start and end
  with two separate `random()` calls, and `CHECK (ends_at > starts_at)` rejected it.

### By hand: two browser windows
1. `npm start`, then open the same event in a normal window and a private/incognito window.
2. Log in as two different emails (e.g. `one@example.com` and `two@example.com`).
3. Click the same green seat in both windows, as close together as you can.
4. One window says "Seat held for 10 minutes"; the other says "Sorry, someone else just took that seat."
   After a refresh, the first window shows the seat blue ("held by you"), the second shows it yellow.

## Phase 7b: The hold-release procedure

`release_expired_holds()` (migration 021) moves the cleanup rule into the database.
The Node job is now one line: `CALL release_expired_holds(NULL, NULL)`.

- **PROCEDURE vs FUNCTION:** a function is used inside a query (`SELECT f()`) and returns a value.
  A procedure runs on its own with `CALL`, and (when called outside a transaction) may `COMMIT`
  part-way through. This one doesn't, because both steps must succeed or fail together.
- **OUT parameters** return values from a procedure: `CALL release_expired_holds(NULL, NULL)`
  returns one row, `released | cancelled`. The NULLs are placeholders for the OUT parameters.
- **`GET DIAGNOSTICS n = ROW_COUNT`** gets how many rows the previous statement changed.
- **Statement visibility inside PL/pgSQL:** each statement sees what earlier statements in the same
  transaction did, so step 2's `NOT EXISTS` sees that step 1 deleted the tickets. Inside a single
  statement (`WITH d AS (DELETE ...) UPDATE ...`) it would not: one statement = one snapshot.
- **Why in the database:** any client can run it (psql, the app, a scheduler like `pg_cron`), and
  the rule can't drift between copies of app code.
- Tested in `constraints_test.sql`: expired hold released, empty order cancelled, live hold kept,
  order with seats left alone (31/31 checks pass).

The refund audit trigger (migration 013) and the My tickets refund button were done in Phases 1 and 4.

## Phase 8: Operations

### Backup and restore
- `npm run db:backup` runs `pg_dump --format=custom`: 309 MB database → **27.8 MB file in 6.7 s**.
  Custom format is compressed and lets `pg_restore` restore in parallel or restore just one table.
- pg_dump reads one consistent snapshot, so the site can keep selling during a backup.
- `npm run db:restore` restores into a separate `ticketing_restore` database (10.3 s with `--jobs=4`)
  and compares 19 things with the original: row counts of all 13 tables, 32 indexes, 53 constraints,
  1 trigger, 2 procedures, the sum of all ticket prices, the next order ID. All matched.
  **A backup you've never restored is only a hope.**
- The password goes to pg_dump through `PGPASSWORD`, not the command line, where other programs
  could read it. `backups/` is git-ignored: dumps contain customer data.

### Adding a column to a 1M-row table without losing data (migration 022, `tickets.ticket_code`)
Rehearsed first on the restored copy, then run on the live database.

| Step | Lock | Time |
|---|---|---|
| ❌ trap: `ADD COLUMN ... NOT NULL DEFAULT gen_random_uuid()` in one go | ACCESS EXCLUSIVE (no reads!), rewrites the table | **5.9 s** frozen |
| 1. `ADD COLUMN ticket_code uuid` (no default) | brief | 24 ms |
| 2. `SET DEFAULT gen_random_uuid()` (new rows only) | brief | 21 ms |
| 3. backfill in batches of 50,000, `COMMIT` after each | only each batch's rows | 37–47 s total |
| 4. `CHECK (...) NOT VALID` → `VALIDATE` → `SET NOT NULL` | VALIDATE allows reads + writes | 266 ms + 3 ms |
| 5. `CREATE UNIQUE INDEX CONCURRENTLY` | inserts keep working | 1.5 s |

- **Proof no data was lost:** an md5 checksum of every ticket's original columns
  (`db/ops/ticket_fingerprint.sql`) was identical before and after, on both the copy and the live DB.
- **Proof the site kept working:** the 50-buyer race test ran *during* the live backfill and passed;
  a seat-map query took 13 ms (8 ms normally).
- **Why it works:**
  - A volatile default (different value per row) forces a full rewrite. No default, or a constant one, doesn't.
  - Small committed batches mean short row locks, and a failure only loses the current batch.
    The migration is safe to re-run.
  - `NOT VALID` + `VALIDATE` splits "new rows must comply" (instant) from "check old rows"
    (slow, but under a weak lock), and `SET NOT NULL` then trusts the validated CHECK.
  - `CONCURRENTLY` builds an index without blocking writes. It can't run inside a transaction,
    so this migration must be run as plain `psql -f` (no `-1`).
- **Improvement for a much bigger table:** each batch's `WHERE ticket_code IS NULL LIMIT 50000` re-scans
  rows already filled, so later batches get slower. Walking `ticket_id` ranges (1–50,000, 50,001–100,000, …)
  keeps every batch the same speed.

## Phase 9: Ready to deploy

### A migration runner (`npm run migrate`, `db/migrate.js`)
- A `schema_migrations` table records which files have run, so each migration runs exactly once on
  every database (laptop, Render, a teammate's), and the app can migrate itself when it starts.
- **Baseline:** my local database had been migrated by hand with psql, so
  `npm run migrate -- --baseline 022` recorded 001–022 as done without re-running them.
- Hosts don't have `psql`, so the runner splits each file into statements itself and runs them one by
  one on ONE connection, the way `psql -f` does. That keeps each file's own `BEGIN/COMMIT`,
  `CREATE INDEX CONCURRENTLY` and the committing backfill procedure (022) working. Splitting SQL
  correctly means ignoring `;` inside quotes, comments and `$$ ... $$` function bodies.

### Sessions in PostgreSQL (migration 023)
- In-memory sessions vanish on every restart, and Render's free plan restarts the app whenever it
  sleeps. `connect-pg-simple` stores them in a `sessions` table (with an index on `expire`, which it uses
  to delete old sessions).

### Production settings
- `SESSION_SECRET` is required in production (the app refuses to start without it).
- Cookies are `HttpOnly` (page scripts can't read them), `SameSite=Lax` (not sent with form posts from
  other sites, a basic CSRF defence), and `Secure` (HTTPS only) in production. `trust proxy` lets
  Express see that Render's proxy received HTTPS.
- `DATABASE_SSL=true` encrypts the connection when reaching a hosted database over the internet.

### Rehearsed locally
Fresh empty database + `npm run start:production` (exactly what Render runs):
first start applied 23 migrations, seeded at scale 0.1 (48 MB) and started; a restart said
"up to date" and "not seeding". Login cookie came back `HttpOnly; Secure; SameSite=Lax`.

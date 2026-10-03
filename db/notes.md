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

### Tests must not depend on existing data
- The constraint test first borrowed "the first event and seat". After seeding, that event already
  had prices, so a test failed. Tests should create their own fixtures (inside a rolled-back transaction).

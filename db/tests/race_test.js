// Race test: 50 people try to buy the LAST seat of an event at the same moment.
// Usage: npm run test:race
//
// It calls the same holdSeat() / payForOrder() functions the website uses (server/booking.js),
// each buyer on their own database connection, all released at once.
//
// Round 1  50 buyers race for the last seat         -> exactly 1 gets it, 49 are told it's taken
// Round 2  the last seat's hold has EXPIRED, 50 race -> exactly 1 gets it; the expired holder can't pay
// Round 3  the winner clicks "Pay" twice at once     -> exactly 1 payment
//
// It creates its own venue, event and customers, and deletes them afterwards.
process.env.PG_POOL_MAX = '60';
require('dotenv').config({ quiet: true });

const { pool } = require('../../server/db');
const { holdSeat, payForOrder } = require('../../server/booking');

const BUYERS = 50;
const SEATS = 10; // 9 are sold before the race starts, so 1 is left
const TAG = 'race-test';

const failures = [];
function check(description, condition, detail = '') {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${description}${detail ? `  (${detail})` : ''}`);
  if (!condition) failures.push(description);
}

async function cleanUp() {
  // Children before parents, because every foreign key is ON DELETE RESTRICT.
  await pool.query(`DELETE FROM payments WHERE order_id IN (
    SELECT o.order_id FROM orders o JOIN customers c USING (customer_id) WHERE c.email LIKE '${TAG}-%')`);
  await pool.query(`DELETE FROM tickets WHERE event_id IN (SELECT e.event_id FROM events e JOIN venues v USING (venue_id) WHERE v.city = '${TAG}')`);
  await pool.query(`DELETE FROM orders WHERE customer_id IN (SELECT customer_id FROM customers WHERE email LIKE '${TAG}-%')`);
  await pool.query(`DELETE FROM customers WHERE email LIKE '${TAG}-%'`);
  await pool.query(`DELETE FROM event_section_prices WHERE event_id IN (SELECT e.event_id FROM events e JOIN venues v USING (venue_id) WHERE v.city = '${TAG}')`);
  await pool.query(`DELETE FROM events WHERE venue_id IN (SELECT venue_id FROM venues WHERE city = '${TAG}')`);
  await pool.query(`DELETE FROM seats WHERE section_id IN (SELECT section_id FROM sections sc JOIN venues v USING (venue_id) WHERE v.city = '${TAG}')`);
  await pool.query(`DELETE FROM sections WHERE venue_id IN (SELECT venue_id FROM venues WHERE city = '${TAG}')`);
  await pool.query(`DELETE FROM venues WHERE city = '${TAG}'`);
}

// A small venue with SEATS seats, one future event, 9 seats already sold, and BUYERS customers.
async function setUp(eventTitle, round) {
  const venue = await pool.query(
    `INSERT INTO venues (name, address, city, time_zone) VALUES ($1, '1 Race St', '${TAG}', 'UTC')
     ON CONFLICT (name, city) DO UPDATE SET address = EXCLUDED.address RETURNING venue_id`,
    ['Race Test Hall'],
  );
  const venueId = venue.rows[0].venue_id;
  let section = await pool.query('SELECT section_id FROM sections WHERE venue_id = $1', [venueId]);
  if (section.rowCount === 0) {
    section = await pool.query("INSERT INTO sections (venue_id, name) VALUES ($1, 'Floor') RETURNING section_id", [venueId]);
    await pool.query(
      "INSERT INTO seats (section_id, row_label, seat_number) SELECT $1, 'A', n FROM generate_series(1, $2) AS n",
      [section.rows[0].section_id, SEATS],
    );
  }
  const sectionId = section.rows[0].section_id;

  // Each round's event starts on a different day (UNIQUE (venue_id, starts_at)), and the start
  // is computed once so the end is always 3 hours after it (CHECK ends_at > starts_at).
  const event = await pool.query(
    `INSERT INTO events (venue_id, title, starts_at, ends_at)
     SELECT $1, $2, s, s + interval '3 hours'
     FROM (SELECT date_trunc('hour', now()) + interval '30 days' + $3 * interval '1 day' AS s) AS start
     RETURNING event_id`,
    [venueId, eventTitle, round],
  );
  const eventId = event.rows[0].event_id;
  await pool.query('INSERT INTO event_section_prices (event_id, section_id, price) VALUES ($1, $2, 49.99)', [eventId, sectionId]);

  // Sell every seat except the last one to a "fan" customer, through the real code path.
  const fan = await pool.query(
    `INSERT INTO customers (email, full_name) VALUES ('${TAG}-fan-' || $1 || '@example.com', 'Early Fan')
     RETURNING customer_id`,
    [eventId],
  );
  const fanId = fan.rows[0].customer_id;
  const seats = (await pool.query('SELECT seat_id FROM seats WHERE section_id = $1 ORDER BY seat_number', [sectionId])).rows;
  const toSell = seats.slice(0, SEATS - 1);
  for (let i = 0; i < toSell.length; i++) {
    const held = await holdSeat(fanId, eventId, toSell[i].seat_id);
    if (held.error) throw new Error(`setup hold failed: ${held.error}`);
    // Pay after every 8 seats (the per-order limit) and after the last one.
    if ((i + 1) % 8 === 0 || i === toSell.length - 1) await payForOrder(fanId);
  }

  return { eventId, lastSeatId: seats[SEATS - 1].seat_id };
}

async function makeBuyers(round) {
  const r = await pool.query(
    `INSERT INTO customers (email, full_name)
     SELECT '${TAG}-r${round}-' || n || '@example.com', 'Racer ' || n FROM generate_series(1, $1) AS n
     RETURNING customer_id`,
    [BUYERS],
  );
  return r.rows.map((row) => row.customer_id);
}

// Starts every task at the same instant: they all wait on one promise, then it resolves.
async function allAtOnce(tasks) {
  let go;
  const startSignal = new Promise((resolve) => { go = resolve; });
  const running = tasks.map((task) => startSignal.then(task));
  const started = Date.now();
  go();
  const results = await Promise.all(running);
  return { results, ms: Date.now() - started };
}

async function seatState(eventId, seatId) {
  const r = await pool.query(
    `SELECT t.status, o.customer_id FROM tickets t JOIN orders o USING (order_id)
     WHERE t.event_id = $1 AND t.seat_id = $2 AND t.status IN ('held', 'sold')`,
    [eventId, seatId],
  );
  return r.rows;
}

async function main() {
  await cleanUp(); // leftovers from an interrupted earlier run

  // Open all connections up front, so the race measures the database, not connection setup.
  const warm = await Promise.all(Array.from({ length: BUYERS }, () => pool.connect()));
  warm.forEach((client) => client.release());

  // ---------------------------------------------------------------- Round 1
  console.log(`\nRound 1: ${BUYERS} buyers race for the last of ${SEATS} seats`);
  const r1 = await setUp('Race Round 1', 1);
  const buyers1 = await makeBuyers(1);
  const race1 = await allAtOnce(buyers1.map((id) => async () => {
    const hold = await holdSeat(id, r1.eventId, r1.lastSeatId);
    const pay = hold.ok ? await payForOrder(id) : null;
    return { id, hold, pay };
  }));
  const winners1 = race1.results.filter((r) => r.hold.ok);
  const taken1 = race1.results.filter((r) => r.hold.error === 'Sorry, someone else just took that seat.');
  check('exactly 1 buyer got the seat', winners1.length === 1, `${winners1.length} did, in ${race1.ms} ms`);
  check(`the other ${BUYERS - 1} were told it was taken`, taken1.length === BUYERS - 1, `${taken1.length}`);
  check('the winner paid', winners1.length === 1 && winners1[0].pay && winners1[0].pay.paid === 1);
  const state1 = await seatState(r1.eventId, r1.lastSeatId);
  check('the seat is sold to the winner, once', state1.length === 1 && state1[0].status === 'sold'
    && winners1.length === 1 && state1[0].customer_id === winners1[0].id);
  const sold1 = await pool.query("SELECT count(*)::int AS n FROM tickets WHERE event_id = $1 AND status = 'sold'", [r1.eventId]);
  check(`event has exactly ${SEATS} sold tickets (never more seats than exist)`, sold1.rows[0].n === SEATS, `${sold1.rows[0].n}`);

  // ---------------------------------------------------------------- Round 2
  console.log(`\nRound 2: the last seat's hold has expired; ${BUYERS} buyers race for it`);
  const r2 = await setUp('Race Round 2', 2);
  const buyers2 = await makeBuyers(2);
  const slowpoke = buyers2.pop(); // one customer holds first; the other 49 race later
  const slowHold = await holdSeat(slowpoke, r2.eventId, r2.lastSeatId);
  check('a slow customer holds the last seat', slowHold.ok === true);
  // Pretend 10 minutes passed without paying, and the cleanup job hasn't run yet.
  await pool.query(
    "UPDATE tickets SET held_until = now() - interval '1 second' WHERE event_id = $1 AND seat_id = $2 AND status = 'held'",
    [r2.eventId, r2.lastSeatId],
  );
  const race2 = await allAtOnce(buyers2.map((id) => async () => ({ id, hold: await holdSeat(id, r2.eventId, r2.lastSeatId) })));
  const winners2 = race2.results.filter((r) => r.hold.ok);
  check(`exactly 1 of ${buyers2.length} buyers got the expired seat`, winners2.length === 1, `${winners2.length} did, in ${race2.ms} ms`);
  const slowPay = await payForOrder(slowpoke);
  check('the slow customer can no longer pay for it', slowPay.error === 'Your holds expired. Please pick your seats again.', slowPay.error || 'paid!');
  const state2 = await seatState(r2.eventId, r2.lastSeatId);
  check('only the new holder has the seat', state2.length === 1 && winners2.length === 1 && state2[0].customer_id === winners2[0].id);

  // ---------------------------------------------------------------- Round 3
  console.log('\nRound 3: the round-2 winner clicks "Pay" twice at the same moment');
  const winnerId = winners2[0] && winners2[0].id;
  const race3 = await allAtOnce([() => payForOrder(winnerId), () => payForOrder(winnerId)]);
  const paid3 = race3.results.filter((r) => r.paid);
  check('exactly 1 of the 2 clicks paid', paid3.length === 1, `${paid3.length}`);
  const payments3 = await pool.query(
    "SELECT count(*)::int AS n FROM payments p JOIN orders o USING (order_id) WHERE o.customer_id = $1 AND p.status = 'succeeded'",
    [winnerId],
  );
  check('exactly 1 payment row was recorded', payments3.rows[0].n === 1, `${payments3.rows[0].n}`);

  await cleanUp();
}

main()
  .catch((err) => {
    console.error(err);
    failures.push(`crashed: ${err.message}`);
  })
  .finally(async () => {
    await cleanUp().catch(() => {});
    await pool.end();
    console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll checks passed.');
    process.exit(failures.length ? 1 : 0);
  });

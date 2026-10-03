// 05_sales.js
// ~1M tickets in ~440k orders, plus payments and 10k cancelled orders (all times SEED_SCALE),
// generated in JavaScript and loaded with COPY.
//
// How the data is shaped (same rules as the earlier SQL version):
//   1. Each event gets a "fill rate": past events sold 30-60% of seats, future events 5-35%.
//   2. Every row of seats is cut into groups of 1-6 neighbouring seats.
//   3. Each group is sold with probability = fill rate. One sold group = one order.
//   4. 0.3% of groups for future events are checkouts in progress (pending order, held seats).
//
// One connection can only run one COPY at a time, and tickets need their orders to exist
// first (foreign key). So the simulation runs three times with the same random seed:
// the first pass sends only orders, the second only tickets, the third only payments.
// Same seed = same choices every pass, so the three tables match up exactly.
const { createRandom } = require('./lib/random');
const { copyInto } = require('./lib/copy');

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

async function loadVenueLayout(client) {
  // Every seat, grouped venue -> row -> seats, in seat order.
  const { rows } = await client.query(
    `SELECT sc.venue_id, s.section_id, s.row_label, s.seat_id, s.seat_number
     FROM seats s
     JOIN sections sc ON sc.section_id = s.section_id
     ORDER BY sc.venue_id, s.section_id, s.row_label, s.seat_number`,
  );
  const venues = new Map();
  for (const seat of rows) {
    if (!venues.has(seat.venue_id)) venues.set(seat.venue_id, new Map());
    const seatRows = venues.get(seat.venue_id);
    const rowKey = `${seat.section_id}:${seat.row_label}`;
    if (!seatRows.has(rowKey)) seatRows.set(rowKey, { sectionId: seat.section_id, seats: [] });
    seatRows.get(rowKey).seats.push(seat);
  }
  return venues;
}

async function loadPrices(client) {
  // Prices in whole cents, so totals are exact integers (never add money as floats).
  const { rows } = await client.query('SELECT event_id, section_id, price FROM event_section_prices');
  return new Map(rows.map((r) => [`${r.event_id}:${r.section_id}`, Math.round(Number(r.price) * 100)]));
}

const cents = (n) => (n / 100).toFixed(2);

// Runs the whole simulation and yields rows for ONE table: 'orders', 'tickets' or 'payments'.
function* simulate(table, { events, venues, prices, customerCount, scale, now }) {
  const random = createRandom(5);
  const randomCustomer = () => random.int(1, customerCount);
  let orderId = 0;

  for (const event of events) {
    const startsAt = event.starts_at.getTime();
    const isFuture = startsAt > now;
    const fill = isFuture ? 0.05 + random.next() * 0.30 : 0.30 + random.next() * 0.30;

    for (const row of venues.get(event.venue_id).values()) {
      const groupSize = random.int(1, 6);
      const price = prices.get(`${event.event_id}:${row.sectionId}`);

      for (let start = 0; start < row.seats.length; start += groupSize) {
        if (!random.chance(fill)) continue;

        orderId += 1;
        const isHold = isFuture && random.chance(0.003);
        const customerId = randomCustomer();
        const orderedAt = isHold
          ? now - random.next() * 5 * MINUTE_MS
          : Math.min(now, startsAt) - random.next() * 90 * DAY_MS;
        const seats = row.seats.slice(start, start + groupSize);

        if (table === 'orders') {
          yield [orderId, customerId, isHold ? 'pending' : 'paid', new Date(orderedAt)];
        } else if (table === 'tickets') {
          for (const seat of seats) {
            yield [orderId, event.event_id, seat.seat_id, isHold ? 'held' : 'sold', cents(price),
              isHold ? new Date(orderedAt + 10 * MINUTE_MS) : null, new Date(orderedAt)];
          }
        }

        // Paid orders: 5% had a failed attempt (e.g. a declined card) before succeeding.
        // The random draw happens on every pass, even when not writing payments,
        // so all three passes stay in step.
        const hadFailure = random.chance(0.05);
        if (table === 'payments' && !isHold) {
          const total = cents(price * seats.length);
          if (hadFailure) yield [orderId, total, 'failed', new Date(orderedAt + MINUTE_MS)];
          yield [orderId, total, 'succeeded', new Date(orderedAt + 2 * MINUTE_MS)];
        }
      }
    }
  }

  // Abandoned checkouts: the payment failed, the order was cancelled and its held seats were
  // released (so no tickets).
  const cancelledCount = Math.round(10000 * scale);
  for (let i = 0; i < cancelledCount; i++) {
    orderId += 1;
    const customerId = randomCustomer();
    const createdAt = now - random.next() * 540 * DAY_MS;
    const amount = (30 + random.next() * 270).toFixed(2);
    if (table === 'orders') yield [orderId, customerId, 'cancelled', new Date(createdAt)];
    if (table === 'payments') yield [orderId, amount, 'failed', new Date(createdAt + MINUTE_MS)];
  }
}

module.exports = async function seedSales(client, { scale, now }) {
  const { rows: events } = await client.query('SELECT event_id, venue_id, starts_at FROM events ORDER BY event_id');
  const venues = await loadVenueLayout(client);
  const prices = await loadPrices(client);
  const { rows: [{ n: customerCount }] } = await client.query('SELECT count(*)::int AS n FROM customers');
  const world = { events, venues, prices, customerCount, scale, now };

  const timed = async (fn) => {
    const started = Date.now();
    const rows = await fn();
    return `${rows} (${((Date.now() - started) / 1000).toFixed(1)}s)`;
  };

  // COPY may write order_id even though it is GENERATED ALWAYS (unlike INSERT, which needs
  // OVERRIDING SYSTEM VALUE). The identity counter isn't moved, so setval() does that after.
  const orders = await timed(() => copyInto(client, 'orders',
    ['order_id', 'customer_id', 'status', 'created_at'], simulate('orders', world)));
  await client.query("SELECT setval(pg_get_serial_sequence('orders', 'order_id'), (SELECT max(order_id) FROM orders))");

  const tickets = await timed(() => copyInto(client, 'tickets',
    ['order_id', 'event_id', 'seat_id', 'status', 'price', 'held_until', 'created_at'], simulate('tickets', world)));

  const payments = await timed(() => copyInto(client, 'payments',
    ['order_id', 'amount', 'status', 'created_at'], simulate('payments', world)));

  return `orders ${orders}, tickets ${tickets}, payments ${payments}`;
};

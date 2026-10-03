// Holding seats and paying for them: the two operations where concurrency matters.
// Used by the routes (events.js, checkout.js) and by the race test (db/tests/race_test.js),
// so the test exercises exactly the code the website runs.
const { withTransaction, PG } = require('./db');

const MAX_SEATS_PER_ORDER = 8;

// Hold one seat for 10 minutes. Returns { ok: true } or { error: 'message' }.
// All steps run in ONE transaction, so they all happen or none do.
async function holdSeat(customerId, eventId, seatId) {
  try {
    return await withTransaction(async (client) => {
      // 1. Lock this customer's row. If the same customer clicks two seats at once (two tabs),
      //    the second transaction waits here, so they can't both create a pending order.
      await client.query('SELECT 1 FROM customers WHERE customer_id = $1 FOR UPDATE', [customerId]);

      // 2. The seat must be in THIS event's venue and the event must not have started.
      //    (The schema can't enforce "seat belongs to the event's venue", so the app checks it.)
      const seat = await client.query(
        `SELECT p.price
         FROM events e
         JOIN sections sc            ON sc.venue_id = e.venue_id
         JOIN seats s                ON s.section_id = sc.section_id
         JOIN event_section_prices p ON p.event_id = e.event_id AND p.section_id = sc.section_id
         WHERE e.event_id = $1 AND s.seat_id = $2 AND e.starts_at > now()`,
        [eventId, seatId],
      );
      if (seat.rowCount === 0) return { error: 'That seat isn\'t available for this event.' };

      // 3. Find this customer's pending order (their "cart"), or start one.
      let order = await client.query(
        "SELECT order_id FROM orders WHERE customer_id = $1 AND status = 'pending' FOR UPDATE",
        [customerId],
      );
      if (order.rowCount === 0) {
        order = await client.query(
          'INSERT INTO orders (customer_id) VALUES ($1) RETURNING order_id',
          [customerId],
        );
      }
      const orderId = order.rows[0].order_id;

      const held = await client.query(
        "SELECT count(*)::int AS n FROM tickets WHERE order_id = $1 AND status = 'held' AND held_until > now()",
        [orderId],
      );
      if (held.rows[0].n >= MAX_SEATS_PER_ORDER) {
        return { error: `You can hold at most ${MAX_SEATS_PER_ORDER} seats at a time.` };
      }

      // 4. An expired hold on this seat that the cleanup job hasn't removed yet still counts
      //    for the unique index, so remove it first.
      await client.query(
        "DELETE FROM tickets WHERE event_id = $1 AND seat_id = $2 AND status = 'held' AND held_until <= now()",
        [eventId, seatId],
      );

      // 5. Insert the hold. If another customer holds or bought this seat, even one whose
      //    transaction is still running, the partial unique index tickets_event_seat_active_unique
      //    makes this INSERT fail (or wait for the other transaction, then fail).
      //    The database is the referee: no "check first, then insert" race is possible.
      await client.query(
        `INSERT INTO tickets (order_id, event_id, seat_id, price, held_until)
         VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`,
        [orderId, eventId, seatId, seat.rows[0].price],
      );
      return { ok: true };
    });
  } catch (err) {
    // The unique violation aborted the transaction; withTransaction already rolled it back.
    if (err.code !== PG.UNIQUE_VIOLATION) throw err;
    return { error: 'Sorry, someone else just took that seat.' };
  }
}

// Pay for the customer's pending order (simulated). declined = true records a failed attempt.
// Returns { paid, total } | { declined: true } | { error: 'message' }.
async function payForOrder(customerId, { declined = false } = {}) {
  return withTransaction(async (client) => {
    // Lock the order so a double-click (two "Pay" requests) can't pay twice:
    // the second request waits here, then finds the order is no longer pending.
    const order = await client.query(
      "SELECT order_id FROM orders WHERE customer_id = $1 AND status = 'pending' FOR UPDATE",
      [customerId],
    );
    if (order.rowCount === 0) return { error: 'There\'s nothing to pay for.' };
    const orderId = order.rows[0].order_id;

    // Lock the live holds. Until this transaction ends, the cleanup job can't delete them,
    // even if they expire during payment, and nobody else can take the seats.
    const live = await client.query(
      "SELECT ticket_id FROM tickets WHERE order_id = $1 AND status = 'held' AND held_until > now() FOR UPDATE",
      [orderId],
    );
    if (live.rowCount === 0) return { error: 'Your holds expired. Please pick your seats again.' };
    const ticketIds = live.rows.map((r) => r.ticket_id);

    // Seats whose hold already ran out are lost; drop them from the order.
    await client.query(
      "DELETE FROM tickets WHERE order_id = $1 AND status = 'held' AND held_until <= now()",
      [orderId],
    );

    // FOR UPDATE can't be combined with sum(), so the total is a separate query on the locked rows.
    const totalResult = await client.query(
      'SELECT sum(price) AS total FROM tickets WHERE ticket_id = ANY($1::bigint[])',
      [ticketIds],
    );
    const total = totalResult.rows[0].total;

    if (declined) {
      // A failed attempt is recorded too. The holds stay, so the customer can try again.
      await client.query(
        "INSERT INTO payments (order_id, amount, status) VALUES ($1, $2, 'failed')",
        [orderId, total],
      );
      return { declined: true };
    }

    await client.query(
      "INSERT INTO payments (order_id, amount, status) VALUES ($1, $2, 'succeeded')",
      [orderId, total],
    );
    // held -> sold: held_until must be cleared together with the status, or the CHECK
    // constraint tickets_held_until_matches_status (migration 010) rejects the update.
    await client.query(
      "UPDATE tickets SET status = 'sold', held_until = NULL WHERE ticket_id = ANY($1::bigint[])",
      [ticketIds],
    );
    await client.query("UPDATE orders SET status = 'paid' WHERE order_id = $1", [orderId]);
    return { paid: ticketIds.length, total };
  });
}

module.exports = { holdSeat, payForOrder, MAX_SEATS_PER_ORDER };

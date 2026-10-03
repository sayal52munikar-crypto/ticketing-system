// Event page with seat map, and holding a seat for 10 minutes.
const express = require('express');
const { pool, withTransaction, PG } = require('../db');
const { flash, requireLogin } = require('../middleware');

const router = express.Router();
const MAX_SEATS_PER_ORDER = 8;

// Groups the flat list of seats into sections -> rows -> seats for drawing the map.
function buildSeatMap(seats) {
  const sections = new Map();
  for (const seat of seats) {
    if (!sections.has(seat.section_id)) {
      sections.set(seat.section_id, { name: seat.section, price: seat.price, rows: new Map(), available: 0 });
    }
    const section = sections.get(seat.section_id);
    if (!section.rows.has(seat.row_label)) section.rows.set(seat.row_label, []);
    section.rows.get(seat.row_label).push(seat);
    if (seat.seat_status === 'available') section.available += 1;
  }
  return [...sections.values()].map((s) => ({ ...s, rows: [...s.rows.entries()] }));
}

router.get('/events/:eventId', async (req, res, next) => {
  if (!/^\d+$/.test(req.params.eventId)) return next(); // not a number: 404
  const eventId = req.params.eventId;
  const customerId = res.locals.customer ? res.locals.customer.customer_id : null;

  const eventResult = await pool.query(
    `SELECT e.event_id, e.title, v.name AS venue, v.address, v.city,
            to_char(e.starts_at AT TIME ZONE v.time_zone, 'Dy DD Mon YYYY, FMHH12:MI AM') AS starts_local,
            e.starts_at <= now() AS has_started,
            (SELECT string_agg(pf.name, ', ' ORDER BY pf.name)
             FROM event_performers ep
             JOIN performers pf ON pf.performer_id = ep.performer_id
             WHERE ep.event_id = e.event_id) AS performers
     FROM events e
     JOIN venues v ON v.venue_id = e.venue_id
     WHERE e.event_id = $1`,
    [eventId],
  );
  if (eventResult.rowCount === 0) return next();

  // The seat map (db/queries/02_seat_map.sql), plus "mine" for seats this customer holds.
  // "t.status IN ('held', 'sold')" in the join lets PostgreSQL use the partial unique index
  // on tickets (8 ms instead of 334 ms; see the notes in 02_seat_map.sql).
  const seats = await pool.query(
    `SELECT s.seat_id, sc.section_id, sc.name AS section, s.row_label, s.seat_number, p.price,
            CASE
                WHEN t.status = 'sold' THEN 'sold'
                WHEN t.status = 'held' AND t.held_until > now() AND o.customer_id = $2 THEN 'mine'
                WHEN t.status = 'held' AND t.held_until > now() THEN 'held'
                ELSE 'available'
            END AS seat_status
     FROM events e
     JOIN sections sc            ON sc.venue_id = e.venue_id
     JOIN seats s                ON s.section_id = sc.section_id
     JOIN event_section_prices p ON p.event_id = e.event_id AND p.section_id = sc.section_id
     LEFT JOIN tickets t         ON t.event_id = e.event_id
                                AND t.seat_id = s.seat_id
                                AND t.status IN ('held', 'sold')
     LEFT JOIN orders o          ON o.order_id = t.order_id
     WHERE e.event_id = $1
     ORDER BY p.price DESC, sc.name, s.row_label, s.seat_number`,
    [eventId, customerId],
  );

  const event = eventResult.rows[0];
  res.render('event', {
    title: event.title,
    event,
    sections: buildSeatMap(seats.rows),
    myHolds: seats.rows.filter((s) => s.seat_status === 'mine').length,
  });
});

// Hold a seat. This is where concurrency matters: two people can click the same seat
// at the same moment. All steps run in ONE transaction, so they all happen or none do.
router.post('/events/:eventId/hold', requireLogin, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.eventId) || !/^\d+$/.test(req.body.seat_id || '')) return next();
  const eventId = req.params.eventId;
  const seatId = req.body.seat_id;
  const customerId = res.locals.customer.customer_id;
  const back = `/events/${eventId}#seat-map`;

  let outcome;
  try {
    outcome = await withTransaction(async (client) => {
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
    if (err.code !== PG.UNIQUE_VIOLATION) throw err;
    outcome = { error: 'Sorry, someone else just took that seat.' };
  }

  if (outcome.error) flash(req, 'error', outcome.error);
  else flash(req, 'success', 'Seat held for 10 minutes. Go to checkout when you\'re ready.');
  res.redirect(back);
});

module.exports = router;

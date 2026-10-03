// Event page with seat map, and holding a seat for 10 minutes.
const express = require('express');
const { pool } = require('../db');
const { holdSeat } = require('../booking');
const { flash, requireLogin } = require('../middleware');

const router = express.Router();
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

// Hold a seat. The concurrency-safe logic lives in server/booking.js.
router.post('/events/:eventId/hold', requireLogin, async (req, res, next) => {
  if (!/^\d+$/.test(req.params.eventId) || !/^\d+$/.test(req.body.seat_id || '')) return next();
  const eventId = req.params.eventId;
  const seatId = req.body.seat_id;
  const customerId = res.locals.customer.customer_id;
  const back = `/events/${eventId}#seat-map`;

  const outcome = await holdSeat(customerId, eventId, seatId);
  if (outcome.error) flash(req, 'error', outcome.error);
  else flash(req, 'success', 'Seat held for 10 minutes. Go to checkout when you\'re ready.');
  res.redirect(back);
});

module.exports = router;

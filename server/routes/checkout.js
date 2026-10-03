// Checkout: review held seats, release one, or pay (simulated).
const express = require('express');
const { pool, withTransaction } = require('../db');
const { flash, requireLogin } = require('../middleware');

const router = express.Router();

router.get('/checkout', requireLogin, async (req, res) => {
  // sum(t.price) OVER () adds the order total to every row without a second query:
  // a window function sees all rows of the result, unlike GROUP BY it doesn't collapse them.
  const { rows } = await pool.query(
    `SELECT t.ticket_id,
            e.title,
            v.name AS venue,
            to_char(e.starts_at AT TIME ZONE v.time_zone, 'Dy DD Mon YYYY, FMHH12:MI AM') AS starts_local,
            sc.name AS section,
            s.row_label,
            s.seat_number,
            t.price,
            sum(t.price) OVER () AS order_total,
            (extract(epoch FROM t.held_until) * 1000)::bigint AS expires_ms
     FROM orders o
     JOIN tickets t   ON t.order_id = o.order_id
     JOIN events e    ON e.event_id = t.event_id
     JOIN venues v    ON v.venue_id = e.venue_id
     JOIN seats s     ON s.seat_id = t.seat_id
     JOIN sections sc ON sc.section_id = s.section_id
     WHERE o.customer_id = $1
       AND o.status = 'pending'
       AND t.status = 'held'
       AND t.held_until > now()
     ORDER BY e.starts_at, sc.name, s.row_label, s.seat_number`,
    [res.locals.customer.customer_id],
  );

  res.render('checkout', {
    title: 'Checkout',
    tickets: rows,
    total: rows.length ? rows[0].order_total : 0,
    // The first hold to expire sets the deadline for paying.
    deadlineMs: rows.length ? Math.min(...rows.map((r) => Number(r.expires_ms))) : null,
  });
});

router.post('/checkout/release/:ticketId', requireLogin, async (req, res) => {
  if (/^\d+$/.test(req.params.ticketId)) {
    // DELETE ... USING joins to orders so a customer can only release their own holds.
    await pool.query(
      `DELETE FROM tickets t
       USING orders o
       WHERE t.ticket_id = $1
         AND t.order_id = o.order_id
         AND o.customer_id = $2
         AND t.status = 'held'`,
      [req.params.ticketId, res.locals.customer.customer_id],
    );
    flash(req, 'info', 'Seat released.');
  }
  res.redirect('/checkout');
});

router.post('/checkout/pay', requireLogin, async (req, res) => {
  const declined = req.body.outcome === 'decline';
  const customerId = res.locals.customer.customer_id;

  const outcome = await withTransaction(async (client) => {
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

  if (outcome.error) {
    flash(req, 'error', outcome.error);
    return res.redirect('/checkout');
  }
  if (outcome.declined) {
    flash(req, 'error', 'Payment declined (simulated). Your seats are still held. Try again.');
    return res.redirect('/checkout');
  }
  flash(req, 'success', `Paid ${res.locals.money(outcome.total)} for ${outcome.paid} ticket(s). Enjoy the show!`);
  res.redirect('/my-tickets');
});

module.exports = router;

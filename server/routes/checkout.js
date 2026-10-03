// Checkout: review held seats, release one, or pay (simulated).
const express = require('express');
const { pool } = require('../db');
const { payForOrder } = require('../booking');
const { checkCard, TEST_CARD_LIST, BRAND_NAMES } = require('../cards');
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
    testCards: TEST_CARD_LIST,
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
  const customerId = res.locals.customer.customer_id;

  // Check the card first. A typo (bad expiry, wrong CVC length) isn't a payment attempt,
  // so nothing is written to the database. The card fields are never put back into the page.
  const card = checkCard({
    number: req.body.card_number,
    expiry: req.body.card_expiry,
    cvc: req.body.card_cvc,
    name: req.body.card_name,
  });
  if (card.error) {
    flash(req, 'error', card.error);
    return res.redirect('/checkout#payment');
  }

  const cardLabel = `${BRAND_NAMES[card.brand]} ending ${card.last4}`;
  const outcome = await payForOrder(customerId, {
    declined: !card.approved,
    card: { brand: card.brand, last4: card.last4 },
  });

  if (outcome.error) {
    flash(req, 'error', outcome.error);
    return res.redirect('/checkout');
  }
  if (outcome.declined) {
    flash(req, 'error', `${cardLabel}: ${card.reason} Your seats are still held. Try another card.`);
    return res.redirect('/checkout#payment');
  }
  flash(req, 'success', `Paid ${res.locals.money(outcome.total)} with ${cardLabel} for ${outcome.paid} ticket(s). Enjoy the show!`);
  res.redirect('/my-tickets');
});

module.exports = router;

// Login (email only, simulated), logout, My tickets, and refund requests.
const express = require('express');
const { pool, PG } = require('../db');
const { flash, requireLogin } = require('../middleware');

const router = express.Router();

// Only allow redirects to pages on this site ("/events/5"), never "//evil.com".
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

router.get('/login', (req, res) => {
  res.render('login', { title: 'Log in', next: safeNext(req.query.next), email: '', error: null });
});

router.post('/login', async (req, res, next) => {
  const email = (req.body.email || '').trim();
  const fullName = (req.body.full_name || '').trim();
  const goTo = safeNext(req.body.next);
  const retry = (error) => res.status(400).render('login', { title: 'Log in', next: goTo, email, error });

  // lower(email) = lower($1) matches the expression index from migration 008.
  const findCustomer = () => pool.query(
    'SELECT customer_id FROM customers WHERE lower(email) = lower($1)',
    [email],
  );

  let found = await findCustomer();
  if (found.rowCount === 0) {
    if (!fullName) return retry('New here? Enter your name too, and we\'ll create your account.');
    try {
      found = await pool.query(
        'INSERT INTO customers (email, full_name) VALUES ($1, $2) RETURNING customer_id',
        [email, fullName],
      );
    } catch (err) {
      // The database's CHECK constraints do the validation; the app just explains the error.
      if (err.code === PG.CHECK_VIOLATION) return retry('That email address doesn\'t look right.');
      // Someone registered the same email a moment ago: just log in as that customer.
      if (err.code === PG.UNIQUE_VIOLATION) found = await findCustomer();
      else throw err;
    }
  }

  // A new session ID on login stops an attacker from planting a known session ID beforehand.
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.customerId = found.rows[0].customer_id;
    res.redirect(goTo);
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// My tickets (based on db/queries/04_customer_tickets.sql).
router.get('/my-tickets', requireLogin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.ticket_id,
            e.event_id,
            e.title,
            v.name AS venue,
            v.city,
            to_char(e.starts_at AT TIME ZONE v.time_zone, 'Dy DD Mon YYYY, FMHH12:MI AM') AS starts_local,
            e.starts_at < now() AS is_past,
            sc.name AS section,
            s.row_label,
            s.seat_number,
            t.price,
            t.status AS ticket_status,
            r.status AS refund_status,
            -- A refund can be requested for a sold ticket to a future event with no open/approved refund.
            (t.status = 'sold' AND e.starts_at > now() AND r.refund_id IS NULL) AS can_refund
     FROM orders o
     JOIN tickets t       ON t.order_id = o.order_id
     JOIN events e        ON e.event_id = t.event_id
     JOIN venues v        ON v.venue_id = e.venue_id
     JOIN seats s         ON s.seat_id = t.seat_id
     JOIN sections sc     ON sc.section_id = s.section_id
     LEFT JOIN refunds r  ON r.ticket_id = t.ticket_id
                         AND r.status IN ('requested', 'approved')
     WHERE o.customer_id = $1
       AND o.status = 'paid'
     ORDER BY e.starts_at DESC, sc.name, s.row_label, s.seat_number`,
    [res.locals.customer.customer_id],
  );
  res.render('my-tickets', { title: 'My tickets', tickets: rows });
});

router.post('/my-tickets/:ticketId/refund', requireLogin, async (req, res) => {
  if (!/^\d+$/.test(req.params.ticketId)) return res.redirect('/my-tickets');

  // INSERT ... SELECT with every rule in the WHERE: the ticket must belong to THIS customer,
  // be sold, and be for a future event. If any check fails, nothing is inserted (rowCount 0).
  // Without "o.customer_id = $2", anyone could request refunds for other people's tickets
  // just by changing the number in the URL.
  try {
    const result = await pool.query(
      `INSERT INTO refunds (ticket_id, amount, reason)
       SELECT t.ticket_id, t.price, nullif(btrim($3), '')
       FROM tickets t
       JOIN orders o ON o.order_id = t.order_id
       JOIN events e ON e.event_id = t.event_id
       WHERE t.ticket_id = $1
         AND o.customer_id = $2
         AND t.status = 'sold'
         AND e.starts_at > now()`,
      [req.params.ticketId, res.locals.customer.customer_id, req.body.reason || ''],
    );
    if (result.rowCount === 1) flash(req, 'success', 'Refund requested. An admin will review it.');
    else flash(req, 'error', 'That ticket can\'t be refunded.');
  } catch (err) {
    // The partial unique index refunds_one_active_per_ticket (migration 012) blocks duplicates.
    if (err.code !== PG.UNIQUE_VIOLATION) throw err;
    flash(req, 'error', 'A refund for that ticket is already open or approved.');
  }
  res.redirect('/my-tickets');
});

module.exports = router;

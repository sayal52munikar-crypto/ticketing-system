// Admin dashboard and the refund queue.
const express = require('express');
const { pool, withTransaction } = require('../db');
const { flash, requireAdmin } = require('../middleware');
const { loadQuery } = require('../sqlFile');

const router = express.Router();

// The dashboard reuses the measured query files from db/queries/ directly,
// so the SQL tuned in Phase 3 is exactly the SQL the site runs.
const REVENUE_BY_MONTH = loadQuery('08_revenue_by_month.sql');
const TOP_EVENTS_PER_CITY = loadQuery('10_top_events_per_city.sql');
const SELL_THROUGH = loadQuery('11_sell_through.sql');

router.get('/admin', requireAdmin, async (req, res) => {
  // The queries don't depend on each other, so they run at the same time on separate
  // pool connections. Total wait = the slowest query, not the sum of all of them.
  const [revenue, topEvents, sellThrough, refunds] = await Promise.all([
    pool.query(REVENUE_BY_MONTH),
    pool.query(TOP_EVENTS_PER_CITY),
    pool.query(SELL_THROUGH),
    // Open refund queue (db/queries/06_open_refunds.sql, uses the partial index from migration 015),
    // joined to show who asked and for which event.
    pool.query(
      `SELECT r.refund_id, r.amount, r.reason,
              to_char(r.requested_at, 'DD Mon YYYY HH24:MI') AS requested,
              c.full_name, c.email, e.title,
              sc.name AS section, s.row_label, s.seat_number
       FROM refunds r
       JOIN tickets t   ON t.ticket_id = r.ticket_id
       JOIN orders o    ON o.order_id = t.order_id
       JOIN customers c ON c.customer_id = o.customer_id
       JOIN events e    ON e.event_id = t.event_id
       JOIN seats s     ON s.seat_id = t.seat_id
       JOIN sections sc ON sc.section_id = s.section_id
       WHERE r.status = 'requested'
       ORDER BY r.requested_at
       LIMIT 50`,
    ),
  ]);

  const openCount = await pool.query("SELECT count(*)::int AS n FROM refunds WHERE status = 'requested'");

  res.render('admin', {
    title: 'Admin dashboard',
    revenue: revenue.rows,
    maxNet: Math.max(...revenue.rows.map((r) => Number(r.net)), 1),
    topEvents: topEvents.rows,
    bestSellers: sellThrough.rows.slice(0, 10),
    worstSellers: sellThrough.rows.slice(-10).reverse(),
    refunds: refunds.rows,
    openRefunds: openCount.rows[0].n,
  });
});

router.post('/admin/refunds/:refundId', requireAdmin, async (req, res) => {
  const decision = req.body.decision;
  if (!/^\d+$/.test(req.params.refundId) || !['approved', 'rejected'].includes(decision)) {
    return res.redirect('/admin#refunds');
  }

  const outcome = await withTransaction(async (client) => {
    // "AND status = 'requested'" makes the decision a one-time thing. If two admins click
    // at once, the second UPDATE waits for the first, then matches 0 rows.
    // The refunds_audit trigger (migration 013) logs the status change automatically.
    const refund = await client.query(
      `UPDATE refunds SET status = $2, decided_at = now()
       WHERE refund_id = $1 AND status = 'requested'
       RETURNING ticket_id`,
      [req.params.refundId, decision],
    );
    if (refund.rowCount === 0) return { error: 'That refund was already decided.' };

    // Approving frees the seat: refunded tickets are ignored by the partial unique index,
    // so the seat can be sold again. Both updates commit together or not at all.
    if (decision === 'approved') {
      await client.query(
        "UPDATE tickets SET status = 'refunded' WHERE ticket_id = $1 AND status = 'sold'",
        [refund.rows[0].ticket_id],
      );
    }
    return { ok: true };
  });

  if (outcome.error) flash(req, 'error', outcome.error);
  else flash(req, 'success', `Refund #${req.params.refundId} ${decision}.`);
  res.redirect('/admin#refunds');
});

module.exports = router;

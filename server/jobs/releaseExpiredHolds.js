// Background job: every minute, release seats whose 10-minute hold has run out,
// and cancel pending orders that have no seats left.
const { withTransaction } = require('../db');

const EVERY_MS = 60 * 1000;

async function releaseExpiredHolds() {
  return withTransaction(async (client) => {
    // Uses the partial index tickets_held_until_idx (migration 014): ~0.1 ms instead of
    // scanning 1M tickets. A hold being paid for right now is locked (FOR UPDATE in
    // checkout); this DELETE waits for it, then skips it, because it's now 'sold'.
    const released = await client.query(
      "DELETE FROM tickets WHERE status = 'held' AND held_until < now()",
    );

    // This must be a SEPARATE statement. Inside one WITH ... DELETE ... UPDATE statement,
    // every part sees the data as it was BEFORE the statement started, so NOT EXISTS
    // would still see the tickets just deleted and cancel nothing.
    //
    // FOR UPDATE SKIP LOCKED: if a customer is adding a seat to their pending order right
    // now (their transaction has the order locked), skip that order instead of cancelling it.
    // orders_pending_idx (migration 020) finds the pending orders without scanning all orders.
    const cancelled = await client.query(
      `UPDATE orders SET status = 'cancelled'
       WHERE order_id IN (
           SELECT o.order_id
           FROM orders o
           WHERE o.status = 'pending'
             AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.order_id)
           FOR UPDATE SKIP LOCKED
       )`,
    );

    return { released: released.rowCount, cancelled: cancelled.rowCount };
  });
}

function startHoldCleanup() {
  const run = async () => {
    try {
      const { released, cancelled } = await releaseExpiredHolds();
      if (released || cancelled) {
        console.log(`Hold cleanup: released ${released} seat(s), cancelled ${cancelled} empty order(s)`);
      }
    } catch (err) {
      console.error('Hold cleanup failed:', err.message);
    }
  };
  run();
  setInterval(run, EVERY_MS);
}

module.exports = { releaseExpiredHolds, startHoldCleanup };

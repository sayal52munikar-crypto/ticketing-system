// Background job: every minute, release seats whose 10-minute hold has run out,
// and cancel pending orders that have no seats left.
// The work itself is the database procedure release_expired_holds() (migration 021);
// this file only calls it on a timer.
const { pool } = require('../db');

const EVERY_MS = 60 * 1000;

async function releaseExpiredHolds() {
  // CALL runs as one statement in its own transaction, so both steps inside the procedure
  // succeed or fail together. The OUT parameters come back as one row of results.
  const { rows } = await pool.query('CALL release_expired_holds(NULL, NULL)');
  return rows[0];
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

// Seeds the database: runs every numbered step in this folder in name order.
//   NN_name.sql -> run as SQL
//   NN_name.js  -> a function(client, { scale, now }) that loads data with COPY
//
// Usage:  npm run seed                     full size (~1M tickets, 100k customers)
//         SEED_SCALE=0.1 npm run seed      10% size (~100k tickets), e.g. for a free hosting plan
//
// Everything runs in ONE transaction. If any step fails, ROLLBACK undoes all of it,
// so the database is never left half-seeded.
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const TABLES = [
  'venues', 'sections', 'seats', 'events', 'performers', 'event_performers',
  'event_section_prices', 'customers', 'orders', 'tickets', 'payments',
  'refunds', 'refund_audit_log',
];

async function main() {
  const scale = Number(process.env.SEED_SCALE || 1);
  if (!(scale > 0 && scale <= 1)) throw new Error('SEED_SCALE must be a number between 0 and 1');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const steps = fs.readdirSync(__dirname).filter((f) => /^\d\d_.+\.(sql|js)$/.test(f)).sort();
  const startedAll = Date.now();
  console.log(`Seeding at scale ${scale}`);

  try {
    await client.query('BEGIN');
    // Fixes the starting point of SQL random(), so each run generates similar data.
    await client.query('SELECT setseed(0.42)');
    // A custom setting the SQL steps can read with current_setting('seed.scale').
    // "true" = local to this transaction.
    await client.query("SELECT set_config('seed.scale', $1, true)", [String(scale)]);
    const context = { scale, now: Date.now() };

    for (const step of steps) {
      const started = Date.now();
      let detail = '';
      if (step.endsWith('.sql')) {
        await client.query(fs.readFileSync(path.join(__dirname, step), 'utf8'));
      } else {
        detail = await require(path.join(__dirname, step))(client, context);
      }
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`${step.padEnd(20)} ${seconds.padStart(6)}s  ${detail || ''}`);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  // Refresh the planner's statistics so queries are planned for the new data volume.
  await client.query('ANALYZE');

  const countQuery = TABLES
    .map((t) => `SELECT '${t}' AS "table", count(*)::int AS "rows" FROM ${t}`)
    .join(' UNION ALL ');
  const { rows } = await client.query(countQuery);

  console.log(`\nDone in ${((Date.now() - startedAll) / 1000).toFixed(1)}s`);
  console.table(rows);

  await client.end();
}

main().catch((err) => {
  console.error('\nSeeding failed; nothing was changed.');
  console.error(err.message);
  process.exit(1);
});

// Seeds the database: runs every .sql file in this folder in name order.
// Usage: npm run seed
//
// Everything runs in ONE transaction. If any file fails, ROLLBACK undoes all of it,
// so the database is never left half-seeded.
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const TABLES = [
  'venues', 'sections', 'seats', 'events', 'performers', 'event_performers',
  'event_section_prices', 'customers', 'orders', 'tickets', 'payments',
  'refunds', 'refund_audit_log',
];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.sql')).sort();
  const startedAll = Date.now();

  try {
    await client.query('BEGIN');
    // Fixes the starting point of random(), so each run generates similar data.
    await client.query('SELECT setseed(0.42)');

    for (const file of files) {
      const started = Date.now();
      await client.query(fs.readFileSync(path.join(__dirname, file), 'utf8'));
      console.log(`${file.padEnd(20)} ${((Date.now() - started) / 1000).toFixed(1)}s`);
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

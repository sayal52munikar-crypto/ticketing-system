// Runs EXPLAIN (ANALYZE, BUFFERS) on one query file and prints the plan.
// Usage: npm run explain -- db/queries/05_expired_holds.sql
//
// The query runs 3 times and the fastest is shown. The first run often reads from disk
// ("cold cache"); later runs read from memory. Taking the best of 3 compares the
// query plans fairly instead of measuring the disk.
//
// EXPLAIN ANALYZE really executes the query. Our query files are all SELECTs, so that's
// safe, but never point this at an INSERT/UPDATE/DELETE outside a transaction.
require('dotenv').config();

const fs = require('fs');
const { Client } = require('pg');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run explain -- db/queries/<file>.sql');
    process.exit(1);
  }

  // Drop whole-line "--" comments (the files end with RESULT notes), then the final semicolon.
  const sql = fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
    .replace(/;\s*$/, '');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let best = null;
  for (let run = 0; run < 3; run++) {
    const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`);
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    const ms = parseFloat(plan.match(/Execution Time: ([\d.]+) ms/)[1]);
    if (!best || ms < best.ms) best = { ms, plan };
  }

  console.log(best.plan);
  console.log(`\nBest of 3: ${best.ms.toFixed(3)} ms`);
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

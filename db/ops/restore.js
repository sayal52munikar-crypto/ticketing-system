// Restores a backup into a SEPARATE database and checks it matches the original.
// Usage: npm run db:restore                         newest backup -> database "ticketing_restore"
//        npm run db:restore -- backups/x.dump       a specific backup
//        npm run db:restore -- --drop-after         delete the restored copy after checking
//
// A backup you have never restored is only a hope. This proves the file works, without
// touching the real database: it refuses to restore over the database in DATABASE_URL.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { run, urlForDatabase, sourceDatabaseName, BACKUP_DIR } = require('./pgTools');

const TARGET = 'ticketing_restore';
const TABLES = [
  'venues', 'sections', 'seats', 'events', 'performers', 'event_performers',
  'event_section_prices', 'customers', 'orders', 'tickets', 'payments', 'refunds', 'refund_audit_log',
];

// What the restored copy must have in common with the original.
const FINGERPRINT_SQL = `
  ${TABLES.map((t) => `SELECT 'rows in ${t}' AS item, count(*)::bigint AS n FROM ${t}`).join('\n  UNION ALL ')}
  UNION ALL SELECT 'indexes', count(*) FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'constraints', count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'
  UNION ALL SELECT 'triggers', count(*) FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'functions + procedures', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
  UNION ALL SELECT 'sum of ticket prices (cents)', (sum(price) * 100)::bigint FROM tickets
  UNION ALL SELECT 'next order id', nextval(pg_get_serial_sequence('orders', 'order_id'))`;

async function fingerprint(url) {
  const client = new Client({ connectionString: url });
  await client.connect();
  // nextval() would move the counter, so read it inside a transaction that is rolled back.
  await client.query('BEGIN');
  const { rows } = await client.query(FINGERPRINT_SQL);
  await client.query('ROLLBACK');
  await client.end();
  return new Map(rows.map((r) => [r.item, r.n]));
}

function newestBackup() {
  const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.dump')).sort() : [];
  if (!files.length) throw new Error('No backups found. Run: npm run db:backup');
  return path.join(BACKUP_DIR, files[files.length - 1]);
}

async function main() {
  const args = process.argv.slice(2);
  const dropAfter = args.includes('--drop-after');
  const file = args.find((a) => !a.startsWith('--')) || newestBackup();
  if (TARGET === sourceDatabaseName()) throw new Error('Refusing to restore over the live database.');

  // CREATE/DROP DATABASE can't run inside the database being dropped, so use "postgres".
  const admin = new Client({ connectionString: urlForDatabase('postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TARGET} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TARGET}`);

  console.log(`Restoring ${path.relative(process.cwd(), file)} into "${TARGET}"...`);
  const started = Date.now();
  // --jobs=4: restore data and build indexes with 4 parallel workers (custom format only).
  // --no-owner: don't try to give objects to the original owner (matters on hosted databases).
  await run('pg_restore', ['--no-owner', '--jobs=4', file], urlForDatabase(TARGET));
  console.log(`Restored in ${((Date.now() - started) / 1000).toFixed(1)}s. Comparing with "${sourceDatabaseName()}"...\n`);

  const [original, restored] = await Promise.all([
    fingerprint(process.env.DATABASE_URL),
    fingerprint(urlForDatabase(TARGET)),
  ]);
  const rows = [...original.keys()].map((item) => ({
    item, original: original.get(item), restored: restored.get(item),
    match: original.get(item) === restored.get(item) ? 'yes' : 'NO',
  }));
  console.table(rows);

  if (dropAfter) await admin.query(`DROP DATABASE ${TARGET} WITH (FORCE)`);
  await admin.end();

  const mismatches = rows.filter((r) => r.match !== 'yes');
  if (mismatches.length) {
    console.error(`${mismatches.length} item(s) differ. If the site was busy during the backup, row counts`);
    console.error('can legitimately differ (the backup is a snapshot); structure counts should never.');
    process.exit(1);
  }
  console.log(`Backup verified: the restored copy matches.${dropAfter ? ' (Copy deleted.)' : ` Explore it with: psql -U postgres -d ${TARGET}`}`);
}

main().catch((err) => {
  console.error('Restore failed:', err.message);
  process.exit(1);
});

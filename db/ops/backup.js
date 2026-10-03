// Backs up the whole database with pg_dump.
// Usage: npm run db:backup                -> backups/ticketing-2026-10-03T19-30-00.dump
//
// --format=custom: a compressed archive that pg_restore can restore all at once, in parallel,
// or only parts of (one table, schema only, data only). A plain .sql dump can only be replayed.
// pg_dump takes a consistent snapshot: the backup shows the database at one moment, even while
// the site keeps selling tickets during the dump. It doesn't lock out readers or writers.
const fs = require('fs');
const path = require('path');
const { run, sourceDatabaseName, BACKUP_DIR } = require('./pgTools');

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(BACKUP_DIR, `${sourceDatabaseName()}-${stamp}.dump`);

  const started = Date.now();
  await run('pg_dump', ['--format=custom', '--file', file], process.env.DATABASE_URL);

  const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
  console.log(`Backup written: ${path.relative(process.cwd(), file)} (${mb} MB in ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  console.log('Check it restores with: npm run db:restore');
}

main().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});

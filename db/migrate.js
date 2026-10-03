// Applies database migrations that haven't run yet, in file-name order.
// Usage: npm run migrate                       apply new files from db/migrations/
//        npm run migrate -- --baseline 022     mark 001..022 as already applied (for a database
//                                              that was migrated by hand with psql before this tool)
//
// The table schema_migrations records which files have run, so each runs exactly once,
// on every machine (your laptop, Render, a teammate's database).
//
// Works without psql: each file is split into statements and run one by one on ONE connection.
// That's how psql -f runs a file too, so the files' own BEGIN/COMMIT, CREATE INDEX CONCURRENTLY
// and procedures that COMMIT all behave the same as before. psql-only lines (\set ...) are skipped.
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DIR = path.join(__dirname, 'migrations');

// Splits SQL into statements at semicolons that are not inside quotes, comments or $$ bodies.
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    const dollarTag = rest.match(/^\$[A-Za-z_]*\$/);
    if (rest.startsWith('--')) {                       // line comment
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
    } else if (rest.startsWith('/*')) {                // block comment
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
    } else if (sql[i] === "'") {                       // 'string' ('' is an escaped quote)
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      current += sql.slice(i, j + 1);
      i = j + 1;
    } else if (dollarTag) {                            // $$ function body $$ or $tag$ ... $tag$
      const end = sql.indexOf(dollarTag[0], i + dollarTag[0].length);
      const stop = end === -1 ? sql.length : end + dollarTag[0].length;
      current += sql.slice(i, stop);
      i = stop;
    } else if (sql[i] === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      i += 1;
    } else if (sql[i] === '\\' && /(^|\n)\s*$/.test(current)) { // psql meta-command line: skip it
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
    } else {
      current += sql[i];
      i += 1;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  client.on('notice', (msg) => console.log(`    ${msg.message}`));

  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    file_name  text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = fs.readdirSync(DIR).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const applied = new Set((await client.query('SELECT file_name FROM schema_migrations')).rows.map((r) => r.file_name));

  const baselineAt = process.argv.indexOf('--baseline');
  if (baselineAt !== -1) {
    const upTo = process.argv[baselineAt + 1];
    if (!/^\d{3}$/.test(upTo || '')) throw new Error('Usage: npm run migrate -- --baseline 022');
    const marked = files.filter((f) => f.slice(0, 3) <= upTo && !applied.has(f));
    for (const f of marked) await client.query('INSERT INTO schema_migrations (file_name) VALUES ($1)', [f]);
    console.log(`Marked ${marked.length} migration(s) up to ${upTo} as already applied.`);
  }

  const pending = files.filter((f) => !applied.has(f) && !(baselineAt !== -1 && f.slice(0, 3) <= process.argv[baselineAt + 1]));
  if (!pending.length) console.log('Database is up to date.');

  for (const file of pending) {
    const started = Date.now();
    console.log(`Applying ${file}`);
    const statements = splitStatements(fs.readFileSync(path.join(DIR, file), 'utf8'));
    try {
      for (const statement of statements) await client.query(statement);
    } catch (err) {
      // If the file had opened a transaction, end it so the error is reported cleanly.
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`${file} failed: ${err.message}`);
    }
    await client.query('INSERT INTO schema_migrations (file_name) VALUES ($1)', [file]);
    console.log(`  done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  await client.end();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Migration failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { splitStatements };

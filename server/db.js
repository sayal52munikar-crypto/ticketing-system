// One shared connection pool for the whole app.
// pg reads the connection details from DATABASE_URL in .env.
const { Pool } = require('pg');

// max = how many connections the app may open at once (default 10). The race test raises it
// so 50 simulated buyers really run at the same time instead of queueing for a connection.
// DATABASE_SSL=true encrypts the connection, needed when connecting to a hosted database
// over the internet (e.g. seeding Render's database from your laptop).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 10,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// Runs fn(client) inside a transaction on ONE connection.
// pool.query() may use a different connection for every call, so BEGIN and COMMIT
// would land on different connections and the transaction would do nothing.
// Here every query inside fn uses the same client, between BEGIN and COMMIT.
// If fn throws, everything it did is rolled back.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release(); // give the connection back to the pool
  }
}

// PostgreSQL error codes (SQLSTATE) the app reacts to.
const PG = {
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
};

module.exports = { pool, withTransaction, PG };

// One shared connection pool for the whole app.
// pg reads the connection details from DATABASE_URL in .env.
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = pool;

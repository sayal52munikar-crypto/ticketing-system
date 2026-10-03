require('dotenv').config({ quiet: true });

const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSessionStore = require('connect-pg-simple')(session);
const { pool } = require('./db');
const { startHoldCleanup } = require('./jobs/releaseExpiredHolds');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production (it signs the login cookie).');
}

// On Render the app sits behind a proxy that handles HTTPS. Trusting it lets Express see that
// the visitor used HTTPS, which "secure" cookies require.
if (isProduction) app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: false }));

// Sessions remember who is logged in: a cookie holds a session ID, and the session data is
// stored in the "sessions" table (migration 023), so logins survive restarts and deploys.
app.use(session({
  store: new PgSessionStore({ pool, tableName: 'sessions' }),
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,                 // JavaScript in the page can't read the cookie
    sameSite: 'lax',                // not sent with form posts from other sites (CSRF protection)
    secure: isProduction,           // HTTPS only in production
    maxAge: 7 * 24 * 60 * 60 * 1000, // stay logged in for 7 days
  },
}));

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// Before every request: load the logged-in customer (if any) and any one-time message.
app.use(async (req, res, next) => {
  res.locals.customer = null;
  if (req.session.customerId) {
    const { rows } = await pool.query(
      'SELECT customer_id, email, full_name, is_admin FROM customers WHERE customer_id = $1',
      [req.session.customerId],
    );
    res.locals.customer = rows[0] || null;
  }
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  // pg returns numeric columns as strings (to avoid float rounding); format them for display.
  res.locals.money = (value) => money.format(value);
  next();
});

app.use(require('./routes/home'));
app.use(require('./routes/account'));
app.use(require('./routes/events'));
app.use(require('./routes/checkout'));
app.use(require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
});

// Express 5 sends errors thrown in async routes here automatically.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Something went wrong', message: 'Please try again.' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  startHoldCleanup();
});

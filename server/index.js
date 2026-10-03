require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const { pool } = require('./db');
const { startHoldCleanup } = require('./jobs/releaseExpiredHolds');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: false }));

// Sessions remember who is logged in (a cookie holds a session ID; the data stays on the server).
// The default memory store is fine for local development; it forgets everyone on restart.
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
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

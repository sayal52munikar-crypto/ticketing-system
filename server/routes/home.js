// Home page: upcoming events, filtered by city and date (db/queries/01_upcoming_events.sql).
const express = require('express');
const { pool } = require('../db');

const router = express.Router();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', async (req, res) => {
  const city = req.query.city || null;
  const from = ISO_DATE.test(req.query.from || '') ? req.query.from : null;
  const to = ISO_DATE.test(req.query.to || '') ? req.query.to : null;

  const cities = await pool.query('SELECT DISTINCT city FROM venues ORDER BY city');

  // Optional filters: "$1::text IS NULL OR v.city = $1" means "if no city was chosen,
  // don't filter by city". Values always go in as $1, $2..., never pasted into the SQL
  // string, so text a user types can't change the query (no SQL injection).
  // Dates are compared in the venue's local time zone, the same way the times are shown.
  const events = await pool.query(
    `SELECT e.event_id,
            e.title,
            v.name AS venue,
            v.city,
            to_char(e.starts_at AT TIME ZONE v.time_zone, 'Dy DD Mon YYYY, FMHH12:MI AM') AS starts_local,
            (SELECT min(p.price) FROM event_section_prices p WHERE p.event_id = e.event_id) AS from_price,
            (SELECT string_agg(pf.name, ', ' ORDER BY pf.name)
             FROM event_performers ep
             JOIN performers pf ON pf.performer_id = ep.performer_id
             WHERE ep.event_id = e.event_id) AS performers
     FROM events e
     JOIN venues v ON v.venue_id = e.venue_id
     WHERE e.starts_at >= now()
       AND ($1::text IS NULL OR v.city = $1)
       AND ($2::date IS NULL OR (e.starts_at AT TIME ZONE v.time_zone)::date >= $2)
       AND ($3::date IS NULL OR (e.starts_at AT TIME ZONE v.time_zone)::date <= $3)
     ORDER BY e.starts_at
     LIMIT 100`,
    [city, from, to],
  );

  res.render('home', {
    title: 'Upcoming events',
    cities: cities.rows.map((r) => r.city),
    events: events.rows,
    filters: { city, from, to },
  });
});

module.exports = router;

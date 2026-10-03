// Route guards and a small helper for one-time messages.

function flash(req, type, text) {
  req.session.flash = { type, text };
}

function requireLogin(req, res, next) {
  if (!res.locals.customer) {
    flash(req, 'info', 'Please log in first.');
    // After logging in, go back to the page they asked for. A form POST URL (like
    // /events/5/hold) can't be opened as a page, so those go to the home page instead.
    const next = req.method === 'GET' ? req.originalUrl : '/';
    return res.redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!res.locals.customer || !res.locals.customer.is_admin) {
    return res.status(403).render('error', {
      title: 'Admins only',
      message: 'Log in as admin@example.com to see the dashboard.',
    });
  }
  next();
}

module.exports = { flash, requireLogin, requireAdmin };

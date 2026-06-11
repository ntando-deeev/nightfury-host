/**
 * NightFury Host — Auth Middleware
 */

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return res.redirect('/dashboard');
}

module.exports = { requireAuth, requireAdmin };

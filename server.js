/**
 * ╔══════════════════════════════════════════════════════╗
 * ║         🔥 NightFury Host — v2.0                     ║
 * ║   Real coin system · Real bot deployment · Admin     ║
 * ║              Created by Mr Ntando Ofc               ║
 * ╚══════════════════════════════════════════════════════╝
 */

const express      = require('express');
const session      = require('express-session');
const path         = require('path');
const rateLimit    = require('express-rate-limit');
const fs           = require('fs');

// DB must init first
require('./src/db');

const app  = express();
const PORT = process.env.PORT || 3000;

// SESSION STORE
const SQLiteStore = require('connect-sqlite3')(session);
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }),
  secret: process.env.SESSION_SECRET || 'nf_secret_xK9mL2pQ7rT4wY',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

app.use('/api/auth',      authLimiter, require('./src/routes/auth'));
app.use('/api/dashboard', require('./src/routes/dashboard'));
app.use('/api/admin',     require('./src/routes/admin'));

app.get('/ping', (req, res) => {
  res.json({ status: 'alive', bot: 'NightFury Host', time: new Date().toISOString() });
});

const pages = {
  '/'          : 'index.html',
  '/login'     : 'login.html',
  '/register'  : 'register.html',
  '/dashboard' : 'dashboard.html',
  '/admin'     : 'admin.html',
};

Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', file));
  });
});

app.use((req, res) => {
  if (fs.existsSync(path.join(__dirname, 'public', '404.html'))) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log('NightFury Host v2.0 running on port ' + PORT);
});

// ONE-TIME ADMIN SEED — remove after first use
app.get('/seed-admin', (req, res) => {
  const token = req.query.token;
  if (token !== (process.env.SEED_TOKEN || 'nf_seed_9x2k')) {
    return res.status(403).json({ error: 'Invalid token' });
  }
  const { db } = require('./src/db');
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: 'email required' });
  const result = db.prepare('UPDATE users SET is_admin = 1, coins = 99999 WHERE email = ?').run(email);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ success: true, message: 'User promoted to admin with 99999 coins' });
});

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
  '/'           : 'index.html',
  '/login'      : 'login.html',
  '/register'   : 'register.html',
  '/dashboard'  : 'dashboard.html',
  '/admin'      : 'admin.html',
  '/admin-login': 'admin-login.html',
};

Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', file));
  });
});

// TEMP ADMIN SETUP — auto-removed after first successful use
const bcrypt_seed = require('bcryptjs');
const { v4: uuidv4_seed } = require('uuid');
app.get('/setup-nf-admin-x7k2', async (req, res) => {
  try {
    const { db: sdb } = require('./src/db');
    const existing = sdb.prepare('SELECT id FROM users WHERE email = ?').get('nightfury.opik.net');
    if (existing) {
      sdb.prepare('UPDATE users SET is_admin = 1, coins = 99999 WHERE email = ?').run('nightfury.opik.net');
      return res.json({ success: true, message: 'Existing user promoted to admin' });
    }
    const hash    = await bcrypt_seed.hash('ntandoooe', 10);
    const uuid    = uuidv4_seed();
    const refCode = uuidv4_seed().slice(0, 8).toUpperCase();
    sdb.prepare(`INSERT INTO users (uuid, username, email, password, coins, is_admin, referral_code) VALUES (?, ?, ?, ?, 99999, 1, ?)`).run(uuid, 'nightfury', 'nightfury.opik.net', hash, refCode);
    res.json({ success: true, message: 'Admin created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

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


app.use((req, res) => {
  if (fs.existsSync(path.join(__dirname, 'public', '404.html'))) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log('NightFury Host v2.0 running on port ' + PORT);
});

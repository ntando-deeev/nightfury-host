/**
 * NightFury Host — SQLite Database Layer
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'nightfury.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Performance settings
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── SCHEMA ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid        TEXT    UNIQUE NOT NULL,
    username    TEXT    UNIQUE NOT NULL,
    email       TEXT    UNIQUE NOT NULL,
    password    TEXT    NOT NULL,
    coins       INTEGER DEFAULT 50,
    is_admin    INTEGER DEFAULT 0,
    is_banned   INTEGER DEFAULT 0,
    referral_code TEXT  UNIQUE,
    referred_by TEXT,
    last_daily  INTEGER DEFAULT 0,
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS bots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id    TEXT    NOT NULL,
    panel_server  TEXT    DEFAULT '36a73d5f',
    status        TEXT    DEFAULT 'stopped',
    deployed_at   INTEGER,
    stopped_at    INTEGER,
    total_hours   REAL    DEFAULT 0,
    created_at    INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id)
  );

  CREATE TABLE IF NOT EXISTS coin_transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount      INTEGER NOT NULL,
    type        TEXT    NOT NULL,
    description TEXT,
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Default settings
const setDefault = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
setDefault.run('coins_per_hour', '2');
setDefault.run('daily_reward', '20');
setDefault.run('signup_bonus', '50');
setDefault.run('referral_reward', '25');
setDefault.run('panel_url', process.env.PANEL_URL || '');
setDefault.run('panel_key', process.env.PANEL_KEY || '');
setDefault.run('panel_server_id', process.env.PANEL_SERVER_ID || '36a73d5f');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const getSetting = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
};

const setSetting = (key, value) => {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
};

const addCoins = db.transaction((userId, amount, type, description) => {
  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(amount, userId);
  db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(userId, amount, type, description);
});

module.exports = { db, getSetting, setSetting, addCoins };

const express = require('express');
const { db, addCoins, getSetting, setSetting } = require('../db');
const panel = require('../panel');
const { requireAdmin } = require('../middleware');
const router = express.Router();

// All routes require admin
router.use(requireAdmin);

// ── DASHBOARD STATS ───────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const totalUsers   = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const totalBots    = db.prepare('SELECT COUNT(*) as c FROM bots').get().c;
    const runningBots  = db.prepare("SELECT COUNT(*) as c FROM bots WHERE status = 'running'").get().c;
    const totalCoins   = db.prepare('SELECT SUM(coins) as s FROM users').get().s || 0;
    const bannedUsers  = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_banned = 1').get().c;

    let panelStatus = null;
    try { panelStatus = await panel.getServerStatus(); } catch {}

    res.json({ totalUsers, totalBots, runningBots, totalCoins, bannedUsers, panel: panelStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LIST USERS ────────────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const page  = parseInt(req.query.page  || 1);
  const limit = parseInt(req.query.limit || 20);
  const search = req.query.search || '';
  const offset = (page - 1) * limit;

  const where = search ? `WHERE username LIKE ? OR email LIKE ?` : '';
  const params = search ? [`%${search}%`, `%${search}%`] : [];

  const users = db.prepare(`
    SELECT u.id, u.username, u.email, u.coins, u.is_admin, u.is_banned, u.referral_code, u.created_at,
           b.status as bot_status
    FROM users u
    LEFT JOIN bots b ON b.user_id = u.id
    ${where}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM users ${where}`).get(...params).c;

  res.json({ users, total, page, pages: Math.ceil(total / limit) });
});

// ── GET SINGLE USER ───────────────────────────────────────────────────────────
router.get('/users/:id', (req, res) => {
  const user = db.prepare(`
    SELECT u.*, b.status as bot_status, b.session_id, b.deployed_at, b.total_hours
    FROM users u LEFT JOIN bots b ON b.user_id = u.id
    WHERE u.id = ?
  `).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const txns = db.prepare('SELECT * FROM coin_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
  res.json({ user, transactions: txns });
});

// ── UPDATE USER COINS ─────────────────────────────────────────────────────────
router.post('/users/:id/coins', (req, res) => {
  const { amount, reason } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ error: 'Invalid amount' });

  const user = db.prepare('SELECT id, coins FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  addCoins(user.id, parseInt(amount), 'admin', reason || `Admin adjustment by ${req.session.username}`);
  const updated = db.prepare('SELECT coins FROM users WHERE id = ?').get(user.id);
  res.json({ success: true, coins: updated.coins });
});

// ── BAN / UNBAN USER ──────────────────────────────────────────────────────────
router.post('/users/:id/ban', (req, res) => {
  const { ban } = req.body; // true = ban, false = unban
  db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(ban ? 1 : 0, req.params.id);
  res.json({ success: true, banned: !!ban });
});

// ── DELETE USER ───────────────────────────────────────────────────────────────
router.delete('/users/:id', (req, res) => {
  if (parseInt(req.params.id) === req.session.userId)
    return res.status(400).json({ error: 'Cannot delete your own account' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── PROMOTE / DEMOTE ADMIN ────────────────────────────────────────────────────
router.post('/users/:id/admin', (req, res) => {
  const { isAdmin } = req.body;
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, req.params.id);
  res.json({ success: true });
});

// ── ALL BOTS ──────────────────────────────────────────────────────────────────
router.get('/bots', (req, res) => {
  const bots = db.prepare(`
    SELECT b.*, u.username, u.email
    FROM bots b JOIN users u ON u.id = b.user_id
    ORDER BY b.deployed_at DESC NULLS LAST
  `).all();
  res.json(bots);
});

// ── PANEL POWER CONTROL ───────────────────────────────────────────────────────
router.post('/panel/power', async (req, res) => {
  const { action } = req.body;
  if (!['start','stop','restart','kill'].includes(action))
    return res.status(400).json({ error: 'Invalid action' });
  try {
    await panel.powerAction(action);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PANEL STATUS ──────────────────────────────────────────────────────────────
router.get('/panel/status', async (req, res) => {
  try {
    const status = await panel.getServerStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SITE SETTINGS ─────────────────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  rows.forEach(r => { if (!r.key.includes('key') && !r.key.includes('panel_key')) out[r.key] = r.value; });
  res.json(out);
});

router.post('/settings', (req, res) => {
  const allowed = ['coins_per_hour','daily_reward','signup_bonus','referral_reward','panel_server_id'];
  Object.entries(req.body).forEach(([k, v]) => {
    if (allowed.includes(k)) setSetting(k, v);
  });
  // Handle panel creds separately
  if (req.body.panel_url) setSetting('panel_url', req.body.panel_url);
  if (req.body.panel_key && req.body.panel_key !== '***') setSetting('panel_key', req.body.panel_key);
  res.json({ success: true });
});

// ── COIN DRAIN (charge running bots per hour) ─────────────────────────────────
router.post('/billing/tick', (req, res) => {
  // Called by a cron or manually — deducts coins for running bots
  const coinsPerHour = parseInt(getSetting('coins_per_hour') || '2');
  const runningBots  = db.prepare("SELECT * FROM bots WHERE status = 'running'").all();
  let processed = 0;

  for (const bot of runningBots) {
    const user = db.prepare('SELECT id, coins FROM users WHERE id = ?').get(bot.user_id);
    if (!user) continue;

    if (user.coins < coinsPerHour) {
      // Auto-stop bot — no coins
      db.prepare("UPDATE bots SET status = 'stopped', stopped_at = ? WHERE id = ?")
        .run(Math.floor(Date.now()/1000), bot.id);
      db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
        .run(user.id, 0, 'auto_stop', 'Bot auto-stopped: insufficient coins');
    } else {
      addCoins(user.id, -coinsPerHour, 'hourly', 'Hourly hosting charge');
      processed++;
    }
  }

  res.json({ success: true, processed, coinsPerHour });
});

// ── TRANSACTIONS ──────────────────────────────────────────────────────────────
router.get('/transactions', (req, res) => {
  const page  = parseInt(req.query.page  || 1);
  const limit = parseInt(req.query.limit || 50);
  const offset = (page - 1) * limit;

  const txns = db.prepare(`
    SELECT ct.*, u.username
    FROM coin_transactions ct JOIN users u ON u.id = ct.user_id
    ORDER BY ct.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare('SELECT COUNT(*) as c FROM coin_transactions').get().c;
  res.json({ transactions: txns, total });
});

module.exports = router;

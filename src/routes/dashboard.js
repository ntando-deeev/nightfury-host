const express = require('express');
const { db, addCoins, getSetting } = require('../db');
const panel = require('../panel');
const { requireAuth } = require('../middleware');
const router = express.Router();

// ── GET MY BOT STATUS ─────────────────────────────────────────────────────────
router.get('/bot/status', requireAuth, async (req, res) => {
  try {
    const bot = db.prepare('SELECT * FROM bots WHERE user_id = ?').get(req.session.userId);
    const panelStatus = await panel.getServerStatus().catch(() => null);
    res.json({ bot: bot || null, panel: panelStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DEPLOY BOT ────────────────────────────────────────────────────────────────
router.post('/bot/deploy', requireAuth, async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id || session_id.trim().length < 10)
      return res.status(400).json({ error: 'Invalid session ID' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const coinsNeeded = 5; // cost to deploy
    if (user.coins < coinsNeeded)
      return res.status(402).json({ error: `You need at least ${coinsNeeded} coins to deploy` });

    // Check if already running — only one bot per user (shared server)
    const existingBot = db.prepare('SELECT * FROM bots WHERE user_id = ? AND status = ?').get(req.session.userId, 'running');
    if (existingBot) return res.status(409).json({ error: 'Your bot is already running. Stop it first.' });

    // Deploy to panel
    await panel.deployBot(session_id.trim());

    // Upsert bot record
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO bots (user_id, session_id, status, deployed_at)
      VALUES (?, ?, 'running', ?)
      ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id, status='running', deployed_at=excluded.deployed_at
    `).run(req.session.userId, session_id.trim(), now);

    // Deduct deploy cost
    addCoins(req.session.userId, -coinsNeeded, 'deploy', 'Bot deployment cost');

    res.json({ success: true, message: 'Bot deployed successfully! 🔥' });
  } catch (err) {
    console.error('Deploy error:', err.message);
    res.status(500).json({ error: 'Panel error: ' + err.message });
  }
});

// ── STOP BOT ──────────────────────────────────────────────────────────────────
router.post('/bot/stop', requireAuth, async (req, res) => {
  try {
    const bot = db.prepare('SELECT * FROM bots WHERE user_id = ?').get(req.session.userId);
    if (!bot) return res.status(404).json({ error: 'No bot found' });

    await panel.stopBot();

    const now = Math.floor(Date.now() / 1000);
    const hours = bot.deployed_at ? (now - bot.deployed_at) / 3600 : 0;

    db.prepare('UPDATE bots SET status = ?, stopped_at = ?, total_hours = total_hours + ? WHERE user_id = ?')
      .run('stopped', now, hours.toFixed(4), req.session.userId);

    res.json({ success: true, message: 'Bot stopped.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── RESTART BOT ───────────────────────────────────────────────────────────────
router.post('/bot/restart', requireAuth, async (req, res) => {
  try {
    const bot = db.prepare('SELECT * FROM bots WHERE user_id = ?').get(req.session.userId);
    if (!bot) return res.status(404).json({ error: 'No bot found' });

    const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.session.userId);
    if (user.coins < 2) return res.status(402).json({ error: 'Not enough coins to restart (need 2)' });

    await panel.restartBot();
    addCoins(req.session.userId, -2, 'restart', 'Bot restart cost');

    res.json({ success: true, message: 'Bot restarting... ♻️' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DAILY REWARD ──────────────────────────────────────────────────────────────
router.post('/daily', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const now = Math.floor(Date.now() / 1000);
  const cooldown = 86400; // 24h

  if (now - user.last_daily < cooldown) {
    const remaining = cooldown - (now - user.last_daily);
    const hrs = Math.floor(remaining / 3600);
    const mins = Math.floor((remaining % 3600) / 60);
    return res.status(429).json({ error: `Daily reward available in ${hrs}h ${mins}m` });
  }

  const reward = parseInt(getSetting('daily_reward') || '20');
  addCoins(req.session.userId, reward, 'daily', 'Daily check-in reward');
  db.prepare('UPDATE users SET last_daily = ? WHERE id = ?').run(now, req.session.userId);

  res.json({ success: true, coins: reward, message: `+${reward} coins claimed! 🎁` });
});

// ── COIN HISTORY ─────────────────────────────────────────────────────────────
router.get('/coins/history', requireAuth, (req, res) => {
  const history = db.prepare(`
    SELECT amount, type, description, created_at
    FROM coin_transactions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 30
  `).all(req.session.userId);
  res.json(history);
});

// ── STATS (dashboard overview) ────────────────────────────────────────────────
router.get('/stats', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT id, username, coins, referral_code, last_daily, created_at FROM users WHERE id = ?').get(req.session.userId);
  const bot  = db.prepare('SELECT status, deployed_at, total_hours FROM bots WHERE user_id = ?').get(req.session.userId);

  let panelStatus = null;
  try { panelStatus = await panel.getServerStatus(); } catch {}

  const nextDaily = user.last_daily + 86400;
  const now = Math.floor(Date.now() / 1000);

  res.json({
    user,
    bot: bot || { status: 'none' },
    panel: panelStatus,
    daily_available: now >= nextDaily,
    next_daily_in: Math.max(0, nextDaily - now),
  });
});

module.exports = router;

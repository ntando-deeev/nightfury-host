const express = require('express');
const { db, addCoins, getSetting } = require('../db');
const panel = require('../panel');
const { requireAuth } = require('../middleware');
const router = express.Router();

// GET bot + panel status
router.get('/bot/status', requireAuth, async (req, res) => {
  try {
    const bot = db.prepare('SELECT * FROM bots WHERE user_id = ?').get(req.session.userId);
    const panelStatus = await panel.getServerStatus().catch(() => null);
    // Cross-check bots.json for live state
    let liveConfig = null;
    if (bot) {
      const bots = await panel.readBotsConfig().catch(() => []);
      liveConfig = bots.find(b => b.userId === String(req.session.userId)) || null;
    }
    res.json({ bot: bot || null, panel: panelStatus, live: liveConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DEPLOY bot
router.post('/bot/deploy', requireAuth, async (req, res) => {
  try {
    const { session_id } = req.body;
    if (!session_id || session_id.trim().length < 10)
      return res.status(400).json({ error: 'Invalid SESSION_ID — must be at least 10 characters' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const coinsNeeded = parseInt(getSetting('deploy_cost') || '5');
    if (user.coins < coinsNeeded)
      return res.status(402).json({ error: `You need at least ${coinsNeeded} coins to deploy` });

    // Write to panel bots.json + restart server
    await panel.deployBot(req.session.userId, session_id.trim(), user.username);

    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO bots (user_id, session_id, status, deployed_at)
      VALUES (?, ?, 'running', ?)
      ON CONFLICT(user_id) DO UPDATE SET
        session_id   = excluded.session_id,
        status       = 'running',
        deployed_at  = excluded.deployed_at
    `).run(req.session.userId, session_id.trim(), now);

    addCoins(req.session.userId, -coinsNeeded, 'deploy', 'Bot deployment cost');

    res.json({ success: true, message: 'Bot deployed! It will be live within 30 seconds. 🔥' });
  } catch (err) {
    console.error('Deploy error:', err.message);
    res.status(500).json({ error: 'Panel error: ' + err.message });
  }
});

// STOP bot
router.post('/bot/stop', requireAuth, async (req, res) => {
  try {
    const bot = db.prepare('SELECT * FROM bots WHERE user_id = ?').get(req.session.userId);
    if (!bot) return res.status(404).json({ error: 'No bot found to stop' });

    await panel.stopBot(req.session.userId);

    const now = Math.floor(Date.now() / 1000);
    const hours = bot.deployed_at ? (now - bot.deployed_at) / 3600 : 0;
    db.prepare('UPDATE bots SET status = ?, stopped_at = ?, total_hours = total_hours + ? WHERE user_id = ?')
      .run('stopped', now, parseFloat(hours.toFixed(4)), req.session.userId);

    res.json({ success: true, message: 'Bot stopped.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RESTART bot
router.post('/bot/restart', requireAuth, async (req, res) => {
  try {
    const bot = db.prepare('SELECT * FROM bots WHERE user_id = ?').get(req.session.userId);
    if (!bot) return res.status(404).json({ error: 'No bot found' });

    const user = db.prepare('SELECT coins FROM users WHERE id = ?').get(req.session.userId);
    const cost = parseInt(getSetting('restart_cost') || '2');
    if (user.coins < cost) return res.status(402).json({ error: `Need ${cost} coins to restart` });

    // Re-deploy with same session id — this marks active: true again
    await panel.deployBot(req.session.userId, bot.session_id, user.username || req.session.username);
    db.prepare("UPDATE bots SET status = 'running', deployed_at = ? WHERE user_id = ?")
      .run(Math.floor(Date.now() / 1000), req.session.userId);
    addCoins(req.session.userId, -cost, 'restart', 'Bot restart cost');

    res.json({ success: true, message: 'Bot restarting... ♻️' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DAILY reward
router.post('/daily', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const now  = Math.floor(Date.now() / 1000);
  const cd   = 86400;

  if (now - user.last_daily < cd) {
    const rem  = cd - (now - user.last_daily);
    const hrs  = Math.floor(rem / 3600);
    const mins = Math.floor((rem % 3600) / 60);
    return res.status(429).json({ error: `Daily reward available in ${hrs}h ${mins}m` });
  }

  const reward = parseInt(getSetting('daily_reward') || '20');
  addCoins(req.session.userId, reward, 'daily', 'Daily check-in reward');
  db.prepare('UPDATE users SET last_daily = ? WHERE id = ?').run(now, req.session.userId);

  res.json({ success: true, coins: reward, message: `+${reward} coins claimed! 🎁` });
});

// COIN history
router.get('/coins/history', requireAuth, (req, res) => {
  const history = db.prepare(`
    SELECT amount, type, description, created_at
    FROM coin_transactions
    WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 30
  `).all(req.session.userId);
  res.json(history);
});

// STATS overview
router.get('/stats', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT id, username, coins, referral_code, last_daily, created_at FROM users WHERE id = ?').get(req.session.userId);
  const bot  = db.prepare('SELECT status, deployed_at, total_hours, session_id FROM bots WHERE user_id = ?').get(req.session.userId);

  let panelStatus = null;
  let liveConfig  = null;
  try {
    panelStatus = await panel.getServerStatus();
    if (bot) {
      const bots = await panel.readBotsConfig();
      liveConfig = bots.find(b => b.userId === String(req.session.userId)) || null;
    }
  } catch {}

  const nextDaily = user.last_daily + 86400;
  const now = Math.floor(Date.now() / 1000);

  res.json({
    user,
    bot:  bot || { status: 'none' },
    live: liveConfig,
    panel: panelStatus,
    daily_available: now >= nextDaily,
    next_daily_in:   Math.max(0, nextDaily - now),
  });
});

module.exports = router;

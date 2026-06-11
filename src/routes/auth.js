const express = require('express');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db, addCoins, getSetting } = require('../db');
const router = express.Router();

// ── REGISTER ──────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, referral } = req.body;

    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields required' });
    if (username.length < 3 || username.length > 20)
      return res.status(400).json({ error: 'Username must be 3–20 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return res.status(400).json({ error: 'Username: letters, numbers, underscores only' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const exists = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (exists) return res.status(409).json({ error: 'Username or email already taken' });

    const hash    = await bcrypt.hash(password, 10);
    const uuid    = uuidv4();
    const refCode = uuidv4().slice(0, 8).toUpperCase();
    const bonus   = parseInt(getSetting('signup_bonus') || '50');

    const insert = db.prepare(`
      INSERT INTO users (uuid, username, email, password, coins, referral_code, referred_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let referrerId = null;
    if (referral) {
      const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referral.toUpperCase());
      if (referrer) referrerId = referrer.id;
    }

    const result = insert.run(uuid, username, email, hash, bonus, refCode, referral || null);
    const userId = result.lastInsertRowid;

    // Log signup bonus transaction
    db.prepare('INSERT INTO coin_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(
      userId, bonus, 'bonus', 'Welcome bonus on signup'
    );

    // Reward referrer
    if (referrerId) {
      const refReward = parseInt(getSetting('referral_reward') || '25');
      addCoins(referrerId, refReward, 'referral', `Referral reward: @${username} joined`);
    }

    req.session.userId   = userId;
    req.session.username = username;
    req.session.isAdmin  = 0;

    res.json({ success: true, redirect: '/dashboard' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'All fields required' });

    const user = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?').get(email, email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.is_banned) return res.status(403).json({ error: 'Account banned. Contact support.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.userId   = user.id;
    req.session.username = user.username;
    req.session.isAdmin  = user.is_admin;

    res.json({ success: true, redirect: user.is_admin ? '/admin' : '/dashboard' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── LOGOUT ────────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true, redirect: '/login' }));
});

// ── ME ────────────────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.prepare('SELECT id, username, email, coins, is_admin, referral_code, created_at FROM users WHERE id = ?').get(req.session.userId);
  res.json(user);
});

module.exports = router;

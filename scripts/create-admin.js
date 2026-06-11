/**
 * NightFury Host — Create Admin User
 * Usage: node scripts/create-admin.js <username> <email> <password>
 */
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../src/db');

const [,, username, email, password] = process.argv;

if (!username || !email || !password) {
  console.error('Usage: node scripts/create-admin.js <username> <email> <password>');
  process.exit(1);
}

(async () => {
  const hash    = await bcrypt.hash(password, 10);
  const uuid    = uuidv4();
  const refCode = uuidv4().slice(0, 8).toUpperCase();

  try {
    db.prepare(`
      INSERT INTO users (uuid, username, email, password, coins, is_admin, referral_code)
      VALUES (?, ?, ?, ?, 99999, 1, ?)
    `).run(uuid, username, email, hash, refCode);

    console.log(`✅ Admin created!`);
    console.log(`   Username : ${username}`);
    console.log(`   Email    : ${email}`);
    console.log(`   Coins    : 99999`);
    console.log(`   Login at : /login`);
  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit(0);
})();

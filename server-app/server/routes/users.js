const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');

const SAFE_FIELDS = 'id, username, name, family, phone, is_active, credits, total_minutes, total_spent, created_at, last_login';

function nextUserNumber(db) {
  const row = db.prepare(`
    SELECT MAX(CAST(username AS INTEGER)) as mx
    FROM users
    WHERE username GLOB '[0-9]*' AND CAST(username AS INTEGER) >= 1000
  `).get();
  return Math.max(1000, (row.mx || 999) + 1);
}

router.get('/', (req, res) => {
  const db = getDb();
  const users = db.prepare(`SELECT ${SAFE_FIELDS} FROM users ORDER BY CAST(username AS INTEGER) DESC`).all();
  res.json(users);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد' });
  res.json(user);
});

// Create - auto username/password from next number >= 1000
router.post('/', (req, res) => {
  const { name = '', family = '', phone = '', credits = 0 } = req.body;
  const db = getDb();
  try {
    const num = nextUserNumber(db);
    const username = String(num);
    const hash = bcrypt.hashSync(username, 10); // password = same as username
    const result = db.prepare(
      'INSERT INTO users (username, password, name, family, phone, credits) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(username, hash, name.trim(), family.trim(), phone.trim(), credits);

    if (credits > 0) {
      db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
        .run(result.lastInsertRowid, credits, 'charge', 'شارژ اولیه');
    }
    res.json({ id: result.lastInsertRowid, username, name, family, phone, credits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { name, family, phone, password } = req.body;
  const db = getDb();
  try {
    if (password && password.trim()) {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET name=?, family=?, phone=?, password=? WHERE id=?')
        .run(name || '', family || '', phone || '', hash, req.params.id);
    } else {
      db.prepare('UPDATE users SET name=?, family=?, phone=? WHERE id=?')
        .run(name || '', family || '', phone || '', req.params.id);
    }
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'این کد قبلاً وجود دارد' });
    res.status(500).json({ error: err.message });
  }
});

// Toggle active/inactive
router.post('/:id/toggle', (req, res) => {
  const db = getDb();
  const io = req.app.get('io');
  const connectedClients = req.app.get('connectedClients');

  const user = db.prepare('SELECT is_active FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد' });

  const newStatus = user.is_active ? 0 : 1;
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, req.params.id);

  // If deactivating, kick client if online
  if (!newStatus) {
    connectedClients.forEach((client, socketId) => {
      if (client.userId == req.params.id) {
        io.to(socketId).emit('session:end', { reason: 'account_disabled' });
      }
    });
  }

  res.json({ is_active: newStatus });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/:id/charge', (req, res) => {
  const { amount, description = 'شارژ دستی توسط ادمین' } = req.body;
  const db = getDb();
  const io = req.app.get('io');
  const connectedClients = req.app.get('connectedClients');

  db.prepare('UPDATE users SET credits = credits + ?, total_spent = total_spent + ? WHERE id = ?')
    .run(amount, amount * 100, req.params.id);
  db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
    .run(req.params.id, amount, 'charge', description);

  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.params.id);
  connectedClients.forEach((client, socketId) => {
    if (client.userId == req.params.id) {
      client.credits = user.credits;
      io.to(socketId).emit('credits:update', { credits: user.credits });
      io.emit('clients:update', Array.from(connectedClients.values()));
    }
  });
  res.json({ credits: user.credits });
});

router.get('/:id/transactions', (req, res) => {
  const db = getDb();
  const transactions = db.prepare(
    'SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(req.params.id);
  res.json(transactions);
});

module.exports = router;

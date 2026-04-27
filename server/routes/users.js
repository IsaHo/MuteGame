const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');

router.get('/', (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, username, credits, total_minutes, total_spent, created_at, last_login FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username, credits, total_minutes, total_spent, created_at, last_login FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد' });
  res.json(user);
});

router.post('/', (req, res) => {
  const { username, password, credits = 0 } = req.body;
  const db = getDb();
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password, credits) VALUES (?, ?, ?)').run(username, hash, credits);
    if (credits > 0) {
      db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(result.lastInsertRowid, credits, 'charge', 'شارژ اولیه');
    }
    res.json({ id: result.lastInsertRowid, username, credits });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'این نام کاربری قبلاً وجود دارد' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  try {
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE users SET username = ?, password = ? WHERE id = ?').run(username, hash, req.params.id);
    } else {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, req.params.id);
    }
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'این نام کاربری قبلاً وجود دارد' });
    res.status(500).json({ error: err.message });
  }
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

  db.prepare('UPDATE users SET credits = credits + ?, total_spent = total_spent + ? WHERE id = ?').run(amount, amount * 100, req.params.id);
  db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)').run(req.params.id, amount, 'charge', description);

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
  const transactions = db.prepare('SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(req.params.id);
  res.json(transactions);
});

module.exports = router;

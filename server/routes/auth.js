const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'mutegame_jwt_secret_2024';

router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
  }
  const token = jwt.sign({ id: admin.id, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: admin.username });
});

router.post('/client/login', (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
  }
  const { password: _, ...safe } = user;
  res.json({ user: safe });
});

module.exports = router;

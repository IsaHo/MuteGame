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
  if (!user.is_active) {
    return res.status(403).json({ error: 'حساب شما غیرفعال است. با ادمین تماس بگیرید.' });
  }
  const { password: _, ...safe } = user;
  res.json({ user: safe });
});

router.post('/client/change-password', (req, res) => {
  const { userId, currentPassword, newPassword } = req.body;
  if (!userId || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'همه فیلدها الزامی است' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'رمز جدید باید حداقل ۴ کاراکتر باشد' });
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'رمز فعلی اشتباه است' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, userId);
  res.json({ success: true });
});

module.exports = router;

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');
const { audit } = require('../audit');

const JWT_SECRET = require('../jwt-secret');

function normalizeIp(ip) {
  if (!ip) return '';
  return String(ip).replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
}

router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
  }
  // First successful admin login pins admin_ip; can be cleared from admin panel.
  const reqIp = normalizeIp(req.ip);
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'admin_ip'").get()?.value;
  // Set req.admin so the audit row records the authenticated id/username
  // instead of falling back to req.body.username (spoofable).
  req.admin = { id: admin.id, username: admin.username, role: admin.role };
  db.transaction(() => {
    if (!existing && reqIp) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('admin_ip', ?, CURRENT_TIMESTAMP)").run(reqIp);
    }
    audit(req, 'auth.admin.login', 'admin', admin.id, { ip: reqIp, pinned_ip: !existing });
  })();
  const token = jwt.sign({ id: admin.id, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: admin.username, adminIp: existing || reqIp });
});

router.post('/admin/reset-admin-ip', (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
  }
  const reqIp = normalizeIp(req.ip);
  req.admin = { id: admin.id, username: admin.username, role: admin.role };
  db.transaction(() => {
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('admin_ip', ?, CURRENT_TIMESTAMP)").run(reqIp);
    audit(req, 'auth.admin-ip.reset', 'settings', null, { new_ip: reqIp });
  })();
  res.json({ success: true, adminIp: reqIp });
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

const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { requireAdmin, audit, PERMS } = require('../audit');

const router = express.Router();

router.get('/_perms', (_req, res) => res.json({ perms: PERMS }));

router.get('/', requireAdmin('admins.view'), (_req, res) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, username, role, permissions, is_active, display_name, created_at, last_login FROM admins ORDER BY id ASC`
  ).all();
  res.json(rows);
});

router.post('/', requireAdmin('admins.edit'), (req, res) => {
  const { username, password, role = 'manager', permissions = '', display_name = '' } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'نام کاربری و رمز الزامی است' });
  if (password.length < 4) return res.status(400).json({ error: 'رمز حداقل ۴ کاراکتر' });
  const db = getDb();
  const exists = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: 'نام کاربری تکراری است' });
  const hash = bcrypt.hashSync(password, 10);
  const permsStr = role === 'super' ? '*' : (Array.isArray(permissions) ? permissions.join(',') : String(permissions));
  let row;
  db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO admins (username, password, role, permissions, display_name) VALUES (?, ?, ?, ?, ?)`
    ).run(username, hash, role, permsStr, display_name);
    audit(req, 'admin.create', 'admin', info.lastInsertRowid, { username, role });
    row = db.prepare('SELECT id, username, role, permissions, is_active, display_name FROM admins WHERE id = ?').get(info.lastInsertRowid);
  })();
  res.json(row);
});

router.put('/:id', requireAdmin('admins.edit'), (req, res) => {
  const db = getDb();
  const target = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'ادمین پیدا نشد' });
  // Don't let non-super demote a super
  if (target.role === 'super' && req.admin.role !== 'super') {
    return res.status(403).json({ error: 'فقط super-admin می‌تواند ادمین super را ویرایش کند' });
  }
  const { username, password, role, permissions, is_active, display_name } = req.body;
  const updates = [];
  const args = [];
  if (username) { updates.push('username = ?'); args.push(username); }
  if (password && password.length >= 4) { updates.push('password = ?'); args.push(bcrypt.hashSync(password, 10)); }
  if (role) {
    updates.push('role = ?'); args.push(role);
    if (role === 'super') { updates.push("permissions = '*'"); }
  }
  if (permissions !== undefined && role !== 'super') {
    updates.push('permissions = ?');
    args.push(Array.isArray(permissions) ? permissions.join(',') : String(permissions));
  }
  if (is_active !== undefined) { updates.push('is_active = ?'); args.push(is_active ? 1 : 0); }
  if (display_name !== undefined) { updates.push('display_name = ?'); args.push(display_name); }
  if (!updates.length) return res.json({ success: true });
  args.push(req.params.id);
  let row;
  db.transaction(() => {
    db.prepare(`UPDATE admins SET ${updates.join(', ')} WHERE id = ?`).run(...args);
    audit(req, 'admin.update', 'admin', req.params.id, { username, role, is_active });
    row = db.prepare('SELECT id, username, role, permissions, is_active, display_name FROM admins WHERE id = ?').get(req.params.id);
  })();
  res.json(row);
});

router.delete('/:id', requireAdmin('admins.edit'), (req, res) => {
  const db = getDb();
  const target = db.prepare('SELECT username, role FROM admins WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'پیدا نشد' });
  if (target.role === 'super') {
    const superCount = db.prepare("SELECT COUNT(*) as c FROM admins WHERE role = 'super'").get().c;
    if (superCount <= 1) return res.status(400).json({ error: 'نمی‌توان آخرین super-admin را حذف کرد' });
  }
  if (req.admin?.id === Number(req.params.id)) return res.status(400).json({ error: 'نمی‌توان خود را حذف کرد' });
  db.transaction(() => {
    db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
    audit(req, 'admin.delete', 'admin', req.params.id, { username: target.username });
  })();
  res.json({ success: true });
});

router.post('/me/password', requireAdmin(), (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'رمز فعلی و جدید لازم است' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'رمز جدید حداقل ۴ کاراکتر' });
  const db = getDb();
  const me = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(currentPassword, me.password)) return res.status(401).json({ error: 'رمز فعلی اشتباه است' });
  db.transaction(() => {
    db.prepare('UPDATE admins SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.admin.id);
    audit(req, 'admin.password.self', 'admin', req.admin.id);
  })();
  res.json({ success: true });
});

module.exports = router;

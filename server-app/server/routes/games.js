const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb } = require('../database');
const { requireAdmin, audit } = require('../audit');

const router = express.Router();

// Image storage dir — overrideable via IMAGE_DIR env (set by Electron main)
const IMAGE_DIR = process.env.IMAGE_DIR || path.join(__dirname, '..', 'images');
fs.mkdirSync(IMAGE_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, IMAGE_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 6) || '.png';
    const safe = `game_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
    cb(null, safe);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /image\/(png|jpe?g|webp|gif)/i.test(file.mimetype);
    cb(ok ? null : new Error('فقط فایل تصویر مجاز است'), ok);
  },
});

// Static serving of images (mounted at /api/games/image/<filename>).
// CSP locks the response to image rendering — even if a bad file slipped
// through the upload filter, the admin dashboard origin can't execute it.
const imageStaticHeaders = (_req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};
router.use('/image', imageStaticHeaders, express.static(IMAGE_DIR));

// ── List games (public — clients also fetch this)
router.get('/', (req, res) => {
  const db = getDb();
  const onlyActive = req.query.active === '1';
  const rows = db.prepare(
    `SELECT * FROM games ${onlyActive ? "WHERE active = 1" : ''} ORDER BY sort_order ASC, name ASC`
  ).all();
  res.json(rows);
});

// ── Create
router.post('/', requireAdmin('games.edit'), (req, res) => {
  const { name, exe_name, category = 'all', sort_order = 0, hint_path = '', is_launcher = 0 } = req.body;
  if (!name || !exe_name) return res.status(400).json({ error: 'نام و exe_name الزامی است' });
  const db = getDb();
  const info = db.prepare(
    `INSERT INTO games (name, exe_name, category, sort_order, hint_path, is_launcher) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name, exe_name, category, sort_order, hint_path, is_launcher ? 1 : 0);
  audit(req, 'game.create', 'game', info.lastInsertRowid, { name, exe_name, is_launcher });
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(info.lastInsertRowid);
  req.app.get('io').emit('games:update', db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY sort_order, name').all());
  res.json(game);
});

// ── Update
router.put('/:id', requireAdmin('games.edit'), (req, res) => {
  const { name, exe_name, category, sort_order, hint_path, active, is_launcher } = req.body;
  const db = getDb();
  const exists = db.prepare('SELECT id FROM games WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'بازی پیدا نشد' });
  db.prepare(
    `UPDATE games SET name = COALESCE(?, name),
                      exe_name = COALESCE(?, exe_name),
                      category = COALESCE(?, category),
                      sort_order = COALESCE(?, sort_order),
                      hint_path = COALESCE(?, hint_path),
                      active = COALESCE(?, active),
                      is_launcher = COALESCE(?, is_launcher)
     WHERE id = ?`
  ).run(name, exe_name, category, sort_order, hint_path, active,
        is_launcher === undefined ? null : (is_launcher ? 1 : 0),
        req.params.id);
  audit(req, 'game.update', 'game', req.params.id, req.body);
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  req.app.get('io').emit('games:update', db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY sort_order, name').all());
  res.json(game);
});

// ── Delete
router.delete('/:id', requireAdmin('games.edit'), (req, res) => {
  const db = getDb();
  const game = db.prepare('SELECT image_path FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'بازی پیدا نشد' });
  if (game.image_path) {
    try { fs.unlinkSync(path.join(IMAGE_DIR, game.image_path)); } catch {}
  }
  db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
  audit(req, 'game.delete', 'game', req.params.id);
  req.app.get('io').emit('games:update', db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY sort_order, name').all());
  res.json({ success: true });
});

// ── Upload/replace image
router.post('/:id/image', requireAdmin('games.edit'), upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'تصویری ارسال نشد' });
  const db = getDb();
  const old = db.prepare('SELECT image_path FROM games WHERE id = ?').get(req.params.id);
  if (!old) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(404).json({ error: 'بازی پیدا نشد' });
  }
  if (old.image_path) {
    try { fs.unlinkSync(path.join(IMAGE_DIR, old.image_path)); } catch {}
  }
  db.prepare('UPDATE games SET image_path = ? WHERE id = ?').run(req.file.filename, req.params.id);
  audit(req, 'game.image', 'game', req.params.id, { filename: req.file.filename });
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  req.app.get('io').emit('games:update', db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY sort_order, name').all());
  res.json(game);
});

module.exports = router;

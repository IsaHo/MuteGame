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

// Pre-stocked image library — operator drops files here, admin picks from a
// gallery instead of using FileDialog every time. Lives next to IMAGE_DIR
// so the same multer storage / static rules apply.
const LIBRARY_DIR = path.join(IMAGE_DIR, 'library');
fs.mkdirSync(LIBRARY_DIR, { recursive: true });

// Game/app preset list. Operator picks from this in the admin form to
// auto-fill name + exe_name + category + is_launcher (and the emoji used as
// the image fallback when no real picture is uploaded).
const PRESETS_PATH = path.join(__dirname, '..', 'data', 'game-presets.json');

// Allowed image extensions. SVG was previously included; it has been REMOVED
// because served-as-image/svg+xml lets an attacker execute script in the admin
// dashboard's origin (stored XSS → JWT theft). If the operator needs SVG, we
// re-encode via a raster pipeline rather than serve the SVG bytes directly.
// Keeping the list to formats whose decoders cannot execute embedded payloads.
const IMAGE_EXT_REGEX = /\.(png|jpe?g|jfif|webp|gif|bmp|tiff?|ico|avif|heic|heif|apng)$/i;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, IMAGE_DIR),
  filename: (_req, file, cb) => {
    // Preserve the original extension (lower-cased, length-capped to keep
    // weirdly long suffixes from polluting disk filenames). Fall back to
    // `.img` if the upload arrived with no extension at all — the server
    // doesn't try to guess from MIME because a wrong guess locks the kiosk
    // out of rendering the file.
    const raw = path.extname(file.originalname || '').toLowerCase().slice(0, 8);
    // Hard-fall to a known-good `.png`. The old fallback `(raw || '.img')`
    // preserved attacker-chosen extensions like `.html` because they failed
    // the regex but were still non-empty → express.static then served them
    // as text/html.
    const ext = raw && IMAGE_EXT_REGEX.test('x' + raw) ? raw : '.png';
    const safe = `game_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
    cb(null, safe);
  },
});
const upload = multer({
  storage,
  // 8 MB ceiling — bumped from 4 MB because HEIC/RAW thumbnails routinely
  // crowd 5–6 MB straight from a phone.
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Accept any MIME the browser tags as an image. This is broader than the
    // old hard-coded list (png|jpe?g|webp|gif) so operators can drop in BMP /
    // TIFF / SVG / AVIF / HEIC / ICO without us bouncing them.
    const mime = String(file.mimetype || '').toLowerCase();
    // BOTH must pass. The old `okMime || okExt` let a `*.svg` through on
    // `image/png` MIME (or vice-versa), and our defenses are weakest at the
    // intersection of those mismatches.
    const okMime = mime.startsWith('image/') && !mime.includes('svg');
    const okExt = IMAGE_EXT_REGEX.test(file.originalname || '');
    const ok = okMime && okExt;
    cb(ok ? null : new Error('فقط فایل تصویر مجاز است'), ok);
  },
});

// Static serving of images (mounted at /api/games/image/<filename>).
// CSP locks the response to image rendering only — even if a bad file slipped
// through the upload filter, the admin dashboard origin can't execute it.
// `nosniff` stops browsers from MIME-guessing a payload back into text/html.
const imageStaticHeaders = (_req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};
router.use('/image', imageStaticHeaders, express.static(IMAGE_DIR));
router.use('/library', imageStaticHeaders, express.static(LIBRARY_DIR));

// Preset list — name+exe+category catalogue. Public so admin can read it
// without auth (no secrets in there). Loaded from disk every request so the
// operator can edit the JSON and have the change visible without restart.
router.get('/presets', (_req, res) => {
  try {
    const raw = fs.readFileSync(PRESETS_PATH, 'utf8');
    res.json(JSON.parse(raw));
  } catch (e) {
    res.status(500).json({ error: 'فایل preset قابل خواندن نیست: ' + e.message });
  }
});

// List of images currently in /images/library — admin's gallery feeds off
// this. Returns just filenames; client builds the URL via /api/games/library/.
// Path is "/library-list" (not "/library/") to avoid colliding with the
// static-file mount point above.
router.get('/library-list', (_req, res) => {
  try {
    const files = fs.readdirSync(LIBRARY_DIR)
      .filter(f => IMAGE_EXT_REGEX.test(f))
      .sort();
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Library matching ───────────────────────────────────────────────────
// Tokenize a string into normalised lowercase words. Used by both sides of
// the fuzzy match (game name vs library filename) so spelling variants
// like "Counter-Strike 2" / "counter_strike_2" / "Counter Strike 2" all
// produce the same token set.
function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);
}

// Pick the best library file for a game name. We score every candidate via:
//   (a) exact slug match           → 100
//   (b) one-side-contains-other    →  60 + length-bonus
//   (c) shared-token count         →  10 × shared (max ~50)
// Ties broken by shorter filename (fewer ambiguous extras) and alphabetical.
// Returns the filename or null if no candidate scores ≥ 30 (weak match
// threshold — better to leave the game without an image than slap on a
// random one).
function findBestLibraryMatch(gameName) {
  let files;
  try {
    files = fs.readdirSync(LIBRARY_DIR).filter(f => IMAGE_EXT_REGEX.test(f));
  } catch { return null; }
  if (files.length === 0) return null;

  const gameTokens = tokenize(gameName);
  if (gameTokens.length === 0) return null;
  const gameSlug = gameTokens.join('_');

  let best = null;
  let bestScore = 0;
  for (const f of files) {
    const stem = f.replace(/\.[^.]+$/, '');
    const fileTokens = tokenize(stem);
    const fileSlug = fileTokens.join('_');

    let score = 0;
    if (fileSlug === gameSlug) {
      score = 100;
    } else if (fileSlug.includes(gameSlug) || gameSlug.includes(fileSlug)) {
      // Reward containment, slightly preferring shorter file slugs (less padding)
      score = 60 + Math.max(0, 20 - Math.abs(fileSlug.length - gameSlug.length));
    } else {
      const shared = gameTokens.filter(t => fileTokens.includes(t));
      // Single-letter shared tokens are noisy ("v", "x"), discount them
      const meaningful = shared.filter(t => t.length >= 2);
      if (meaningful.length > 0) {
        score = Math.min(50, meaningful.length * 18);
        // Bonus when ALL of the game's meaningful tokens appear in the file
        const gameMeaningful = gameTokens.filter(t => t.length >= 2);
        if (gameMeaningful.length > 0 &&
            meaningful.length === gameMeaningful.length) score += 12;
      }
    }

    if (score > bestScore || (score === bestScore && best && f.length < best.length)) {
      best = f;
      bestScore = score;
    }
  }
  return bestScore >= 30 ? best : null;
}

// Apply a library image to a game (copy + update DB). Pure helper so the
// HTTP handler and the bulk auto-match endpoint can share the same logic
// — including the "delete the old image on replace" cleanup.
function applyLibraryImageToGame(db, gameId, libraryFilename) {
  const src = path.join(LIBRARY_DIR, libraryFilename);
  if (!fs.existsSync(src)) return null;
  const game = db.prepare('SELECT image_path FROM games WHERE id = ?').get(gameId);
  if (!game) return null;
  if (game.image_path) {
    try { fs.unlinkSync(path.join(IMAGE_DIR, game.image_path)); } catch {}
  }
  const ext = path.extname(libraryFilename).toLowerCase();
  const safe = `game_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
  fs.copyFileSync(src, path.join(IMAGE_DIR, safe));
  db.prepare('UPDATE games SET image_path = ? WHERE id = ?').run(safe, gameId);
  return safe;
}

// Use a library image as a game's image. Copies (doesn't move) so the same
// library file can be reused across many games. The copy is renamed with the
// same `game_<ts>_<rnd>` scheme as direct uploads so old delete-on-replace
// cleanup keeps working.
router.post('/:id/image-from-library', requireAdmin('games.edit'), (req, res) => {
  const { filename } = req.body || {};
  // Two-part validation: (a) the chars must be safe (no path separators,
  // no `..`), (b) the extension must be an image type we recognise. We use
  // the shared IMAGE_EXT_REGEX so adding a format here only needs the one
  // edit at the top of the file.
  const safeChars = typeof filename === 'string' && /^[\w\-. ]+$/.test(filename) && !filename.includes('..');
  if (!safeChars || !IMAGE_EXT_REGEX.test(filename)) {
    return res.status(400).json({ error: 'نام فایل نامعتبر است' });
  }
  const src = path.join(LIBRARY_DIR, filename);
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'تصویر در کتابخانه پیدا نشد' });

  const db = getDb();
  const old = db.prepare('SELECT image_path FROM games WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'بازی پیدا نشد' });
  if (old.image_path) {
    try { fs.unlinkSync(path.join(IMAGE_DIR, old.image_path)); } catch {}
  }
  const ext = path.extname(filename).toLowerCase();
  const safe = `game_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
  fs.copyFileSync(src, path.join(IMAGE_DIR, safe));
  let game;
  db.transaction(() => {
    db.prepare('UPDATE games SET image_path = ? WHERE id = ?').run(safe, req.params.id);
    audit(req, 'game.image.library', 'game', req.params.id, { from: filename, stored: safe });
    game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  })();
  req.app.get('io').emit('games:update', db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY sort_order, name').all());
  res.json(game);
});

// ── Bulk auto-match library images to games that don't have one yet.
// Walks every game with NULL/empty image_path, runs findBestLibraryMatch
// on its name, and applies the winner. Returns counts so the admin UI can
// show a useful toast ("۲۳ بازی تصویر گرفتند").
router.post('/auto-match-images', requireAdmin('games.edit'), (req, res) => {
  const db = getDb();
  // `?force=1` re-matches games that already have an image too — operator
  // can use this to refresh after dropping new files into library/.
  const force = req.query.force === '1';
  const where = force
    ? "active = 1"
    : "active = 1 AND (image_path IS NULL OR image_path = '')";
  const games = db.prepare(`SELECT id, name FROM games WHERE ${where}`).all();

  const matched = [];
  const unmatched = [];
  db.transaction(() => {
    for (const g of games) {
      const fname = findBestLibraryMatch(g.name);
      if (!fname) { unmatched.push({ id: g.id, name: g.name }); continue; }
      const stored = applyLibraryImageToGame(db, g.id, fname);
      if (stored) matched.push({ id: g.id, name: g.name, from: fname, stored });
      else unmatched.push({ id: g.id, name: g.name });
    }
    audit(req, 'game.image.auto-match', 'game', null, { matched: matched.length, unmatched: unmatched.length, force });
  })();
  req.app.get('io').emit('games:update',
    db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY sort_order, name').all());
  res.json({
    matched: matched.length,
    unmatched: unmatched.length,
    total: games.length,
    samples: matched.slice(0, 5),
    skipped: unmatched.slice(0, 5),
  });
});

// ── List games (public — clients also fetch this)
router.get('/', (req, res) => {
  const db = getDb();
  const onlyActive = req.query.active === '1';
  const rows = db.prepare(
    `SELECT * FROM games ${onlyActive ? "WHERE active = 1" : ''} ORDER BY sort_order ASC, name ASC`
  ).all();
  res.json(rows);
});

// Defense-in-depth: the kiosk client refuses to subprocess anything that
// doesn't look like a basename + known extension, so we reject the same
// pattern at the boundary instead of letting bad data into the games row.
const EXE_NAME_RE = /^[A-Za-z0-9._-]+\.(exe|bat|cmd|lnk)$/i;

// ── Create
router.post('/', requireAdmin('games.edit'), (req, res) => {
  const { name, exe_name, category = 'all', sort_order = 0, hint_path = '', is_launcher = 0,
          active = 1 } = req.body;
  if (!name || !exe_name) return res.status(400).json({ error: 'نام و exe_name الزامی است' });
  if (!EXE_NAME_RE.test(exe_name)) return res.status(400).json({ error: 'exe_name نامعتبر است (فقط نام فایل با پسوند .exe/.bat/.cmd/.lnk)' });
  const db = getDb();
  let game, matched;
  db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO games (name, exe_name, category, sort_order, hint_path, is_launcher, active) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(name, exe_name, category, sort_order, hint_path, is_launcher ? 1 : 0, active ? 1 : 0);
    // Auto-match library image so brand-new games don't appear blank in the
    // kiosk client. The operator can override later via "از مجموعه" picker.
    matched = findBestLibraryMatch(name);
    if (matched) {
      try { applyLibraryImageToGame(db, info.lastInsertRowid, matched); } catch {}
    }
    audit(req, 'game.create', 'game', info.lastInsertRowid, { name, exe_name, is_launcher, autoImage: matched || null });
    game = db.prepare('SELECT * FROM games WHERE id = ?').get(info.lastInsertRowid);
  })();
  req.app.get('io').emit('games:update', db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY sort_order, name').all());
  res.json(game);
});

// ── Update
router.put('/:id', requireAdmin('games.edit'), (req, res) => {
  const { name, exe_name, category, sort_order, hint_path, active, is_launcher } = req.body;
  if (exe_name !== undefined && exe_name !== null && !EXE_NAME_RE.test(exe_name)) {
    return res.status(400).json({ error: 'exe_name نامعتبر است (فقط نام فایل با پسوند .exe/.bat/.cmd/.lnk)' });
  }
  const db = getDb();
  const exists = db.prepare('SELECT id FROM games WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'بازی پیدا نشد' });
  let game;
  db.transaction(() => {
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
    game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  })();
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
  db.transaction(() => {
    db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
    audit(req, 'game.delete', 'game', req.params.id);
  })();
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
  let game;
  db.transaction(() => {
    db.prepare('UPDATE games SET image_path = ? WHERE id = ?').run(req.file.filename, req.params.id);
    audit(req, 'game.image', 'game', req.params.id, { filename: req.file.filename });
    game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  })();
  req.app.get('io').emit('games:update', db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY sort_order, name').all());
  res.json(game);
});

module.exports = router;

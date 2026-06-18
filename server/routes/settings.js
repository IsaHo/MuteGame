const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { audit } = require('../audit');

// Enforces JWT-decoded admin role first (primary auth), then admin-IP pinning
// (defense-in-depth). Both must pass for the route to run.
function adminIpGuard(req, res, next) {
  const auth = req.app.get('requireAdmin');
  const ipGuard = req.app.get('requireAdminIp');
  const chain = (mw, nextMw) => (req2, res2, nxt) =>
    typeof mw === 'function' ? mw(req2, res2, () => nextMw(req2, res2, nxt)) : nextMw(req2, res2, nxt);
  return chain(auth, ipGuard || ((_q, _s, n) => n()))(req, res, next);
}

function getAllSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

router.get('/', (req, res) => {
  const db = getDb();
  res.json(getAllSettings(db));
});

router.post('/', adminIpGuard, (req, res) => {
  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  const update = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) upsert.run(k, String(v));
    audit(req, 'settings.update', 'settings', null, { keys: Object.keys(obj) });
  });
  update(req.body);
  const all = getAllSettings(db);
  // Notify connected admins + clients so currency / pricing updates take effect immediately
  try { req.app.get('io')?.emit('settings:update', all); } catch {}
  res.json(all);
});

module.exports = router;

const jwt = require('jsonwebtoken');
const { getDb } = require('./database');

const JWT_SECRET = require('./jwt-secret');

function normalizeIp(ip) {
  if (!ip) return '';
  return String(ip).replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
}

/* Permissions catalog — keep in sync with admin UI */
const PERMS = [
  'users.view', 'users.edit', 'users.financial',
  'clients.view', 'clients.control',
  'shop.view', 'shop.edit', 'shop.pos',
  'games.view', 'games.edit',
  'network.view', 'network.edit',
  'settings.view', 'settings.edit',
  'admins.view', 'admins.edit',
  'reports.view', 'audit.view',
];

/* Decode JWT and load admin (no enforcement here — endpoints choose what to require) */
function attachAdmin(req, _res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const db = getDb();
    const admin = db.prepare('SELECT id, username, role, permissions, is_active, display_name FROM admins WHERE id = ?').get(payload.id);
    if (admin && admin.is_active) {
      req.admin = admin;
      req.admin.perms = admin.permissions === '*' || admin.role === 'super'
        ? null  // null = all
        : (admin.permissions || '').split(',').filter(Boolean);
    }
  } catch {}
  next();
}

/* Require admin (any role). Optionally require a specific permission. */
function requireAdmin(perm) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'احراز هویت لازم است' });
    if (perm && req.admin.perms !== null && !req.admin.perms.includes(perm)) {
      return res.status(403).json({ error: 'دسترسی برای این عملیات ندارید' });
    }
    next();
  };
}

/*
 * Append one audit row. Throws on DB failure — callers MUST run this inside
 * a `db.transaction(...)` that also performs the state change. If the audit
 * insert fails, the throw rolls back the surrounding transaction so the
 * state change is undone too. Previous swallow-and-continue behavior left
 * the DB in a state where users.credits had changed but no forensic record
 * existed; this is the central failure mode Finding #2 calls out.
 */
function audit(req, action, entity, entityId, details) {
  const db = getDb();
  const adminUsername = req.admin?.username || (req.body && req.body.username) || '-';
  const adminId = req.admin?.id || null;
  const adminIp = normalizeIp(req.ip);
  const detailsStr = details ? (typeof details === 'string' ? details : JSON.stringify(details)) : '';
  db.prepare(`INSERT INTO audit_log (admin_id, admin_username, admin_ip, action, entity, entity_id, details)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(adminId, adminUsername, adminIp, action, entity || '', entityId ? String(entityId) : '', detailsStr);
}

module.exports = { attachAdmin, requireAdmin, audit, normalizeIp, PERMS };

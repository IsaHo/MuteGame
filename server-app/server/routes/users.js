const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');

// Lazy-load: middlewares are registered on app and we read them at request time.
// Enforces JWT-decoded admin role first (primary auth), then admin-IP pinning
// (defense-in-depth). Both must pass for the route to run.
function adminIpGuard(req, res, next) {
  const auth = req.app.get('requireAdmin');
  const ipGuard = req.app.get('requireAdminIp');
  const chain = (mw, nextMw) => (req2, res2, nxt) =>
    typeof mw === 'function' ? mw(req2, res2, () => nextMw(req2, res2, nxt)) : nextMw(req2, res2, nxt);
  return chain(auth, ipGuard || ((_q, _s, n) => n()))(req, res, next);
}

const SAFE_FIELDS = 'id, username, name, family, phone, is_active, credits, total_minutes, total_spent, debt, debt_since, discount_percent, limit_minutes, allowed_seats, post_pay, created_at, last_login';

function nextUserNumber(db) {
  const row = db.prepare(`
    SELECT MAX(CAST(username AS INTEGER)) as mx
    FROM users
    WHERE username GLOB '[0-9]*' AND CAST(username AS INTEGER) >= 1000
  `).get();
  return Math.max(1000, (row.mx || 999) + 1);
}

function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function applyDiscount(db, userId, amount) {
  const settings = getSettings(db);
  const allUsers = db.prepare('SELECT id FROM users ORDER BY total_minutes DESC').all();
  const rank = allUsers.findIndex(u => u.id == userId) + 1;
  const tierDiscount = rank === 1 ? Number(settings.tier1_discount || 10) :
                       rank === 2 ? Number(settings.tier2_discount || 5) :
                       rank === 3 ? Number(settings.tier3_discount || 2) : 0;
  const user = db.prepare('SELECT discount_percent FROM users WHERE id = ?').get(userId);
  const discount = Math.max(tierDiscount, Number(user?.discount_percent || 0));
  const bonus = Math.floor(amount * discount / 100);
  return { total: amount + bonus, bonus, discount };
}

function notifyClient(req, userId, event, data) {
  const io = req.app.get('io');
  const connectedClients = req.app.get('connectedClients');
  connectedClients.forEach((client, socketId) => {
    if (client.userId == userId) {
      io.to(socketId).emit(event, data);
    }
  });
}

function syncClientCredits(req, userId, credits, debt) {
  const io = req.app.get('io');
  const connectedClients = req.app.get('connectedClients');
  connectedClients.forEach((client, socketId) => {
    if (client.userId == userId) {
      client.credits = credits;
      io.to(socketId).emit('credits:update', { credits, debt });
      io.emit('clients:update', Array.from(connectedClients.values()));
    }
  });
}

router.get('/', (req, res) => {
  const db = getDb();
  const users = db.prepare(`SELECT ${SAFE_FIELDS} FROM users ORDER BY CAST(username AS INTEGER) DESC`).all();
  res.json(users);
});

router.get('/bad-payers', (req, res) => {
  const db = getDb();
  const settings = getSettings(db);
  const days = Number(settings.bad_payer_days || 7);
  const users = db.prepare(`
    SELECT ${SAFE_FIELDS} FROM users
    WHERE debt > 0
    AND (debt_since IS NULL OR debt_since <= datetime('now', 'localtime', '-${days} days'))
    ORDER BY debt DESC
  `).all();
  res.json(users);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const user = db.prepare(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد' });
  res.json(user);
});

router.post('/', adminIpGuard, (req, res) => {
  const { name = '', family = '', phone = '', credits = 0,
          limit_minutes = 0, allowed_seats = 1, post_pay = 0 } = req.body;
  const db = getDb();
  try {
    const num = nextUserNumber(db);
    const username = String(num);
    const hash = bcrypt.hashSync(username, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password, name, family, phone, credits, limit_minutes, allowed_seats, post_pay) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(username, hash, name.trim(), family.trim(), phone.trim(), credits,
          Number(limit_minutes) || 0, Math.max(1, Number(allowed_seats) || 1), post_pay ? 1 : 0);

    if (credits > 0) {
      db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
        .run(result.lastInsertRowid, credits, 'charge', 'شارژ اولیه');
    }
    res.json({ id: result.lastInsertRowid, username, name, family, phone, credits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', adminIpGuard, (req, res) => {
  const { name, family, phone, password, discount_percent,
          limit_minutes, allowed_seats, post_pay } = req.body;
  const db = getDb();
  try {
    const updates = [];
    const params = [];
    if (name !== undefined) { updates.push('name=?'); params.push(name || ''); }
    if (family !== undefined) { updates.push('family=?'); params.push(family || ''); }
    if (phone !== undefined) { updates.push('phone=?'); params.push(phone || ''); }
    if (discount_percent !== undefined) { updates.push('discount_percent=?'); params.push(Number(discount_percent) || 0); }
    if (limit_minutes !== undefined) { updates.push('limit_minutes=?'); params.push(Number(limit_minutes) || 0); }
    if (allowed_seats !== undefined) { updates.push('allowed_seats=?'); params.push(Math.max(1, Number(allowed_seats) || 1)); }
    if (post_pay !== undefined) { updates.push('post_pay=?'); params.push(post_pay ? 1 : 0); }
    if (password && password.trim()) { updates.push('password=?'); params.push(bcrypt.hashSync(password, 10)); }
    if (updates.length === 0) return res.json({ success: true });
    params.push(req.params.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/toggle', adminIpGuard, (req, res) => {
  const db = getDb();
  const io = req.app.get('io');
  const connectedClients = req.app.get('connectedClients');

  const user = db.prepare('SELECT is_active FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر پیدا نشد' });

  const newStatus = user.is_active ? 0 : 1;
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, req.params.id);

  if (!newStatus) {
    connectedClients.forEach((client, socketId) => {
      if (client.userId == req.params.id) {
        io.to(socketId).emit('session:end', { reason: 'account_disabled' });
      }
    });
  }

  res.json({ is_active: newStatus });
});

router.delete('/:id', adminIpGuard, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Charge (add credits) with tier/individual discount
router.post('/:id/charge', adminIpGuard, (req, res) => {
  const { amount, description, free = false } = req.body;
  const db = getDb();

  // Free charge: skip discount logic (it's already a gift) and don't bump
  // total_spent (which feeds tier rankings) — also tag the txn type so it
  // doesn't pollute revenue reports.
  if (free) {
    const amt = Number(amount);
    const desc = description || '🎁 شارژ رایگان (هدیه ادمین)';
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amt, req.params.id);
    db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
      .run(req.params.id, amt, 'free_gift', desc);
    const user = db.prepare('SELECT credits, debt FROM users WHERE id = ?').get(req.params.id);
    syncClientCredits(req, req.params.id, user.credits, user.debt);
    return res.json({ credits: user.credits, bonus: 0, discount: 0, free: true });
  }

  const { total, bonus, discount } = applyDiscount(db, req.params.id, Number(amount));

  const desc = description || (bonus > 0
    ? `شارژ ${Number(amount).toLocaleString()} ریال + ${bonus.toLocaleString()} ریال تخفیف (${discount}%)`
    : 'شارژ دستی توسط ادمین');

  db.prepare('UPDATE users SET credits = credits + ?, total_spent = total_spent + ? WHERE id = ?')
    .run(total, Number(amount), req.params.id);
  db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
    .run(req.params.id, total, 'charge', desc);

  const user = db.prepare('SELECT credits, debt FROM users WHERE id = ?').get(req.params.id);
  syncClientCredits(req, req.params.id, user.credits, user.debt);
  res.json({ credits: user.credits, bonus, discount });
});

// Decharge (remove credits)
router.post('/:id/decharge', adminIpGuard, (req, res) => {
  const { amount, description = 'کاهش شارژ توسط ادمین' } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET credits = MAX(0, credits - ?) WHERE id = ?').run(Number(amount), req.params.id);
  db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
    .run(req.params.id, -Number(amount), 'decharge', description);

  const user = db.prepare('SELECT credits, debt FROM users WHERE id = ?').get(req.params.id);
  syncClientCredits(req, req.params.id, user.credits, user.debt);
  res.json({ credits: user.credits });
});

// Add debt
router.post('/:id/debt/add', adminIpGuard, (req, res) => {
  const { amount, description = 'افزایش بدهی' } = req.body;
  const db = getDb();
  const current = db.prepare('SELECT debt FROM users WHERE id = ?').get(req.params.id);
  const wasZero = !current || current.debt <= 0;

  db.prepare('UPDATE users SET debt = debt + ?' + (wasZero ? ', debt_since = CURRENT_TIMESTAMP' : '') + ' WHERE id = ?')
    .run(Number(amount), req.params.id);
  db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
    .run(req.params.id, Number(amount), 'debt_add', description);

  const user = db.prepare('SELECT credits, debt FROM users WHERE id = ?').get(req.params.id);
  notifyClient(req, req.params.id, 'credits:update', { credits: user.credits, debt: user.debt });
  res.json({ debt: user.debt });
});

// Pay debt
router.post('/:id/debt/pay', adminIpGuard, (req, res) => {
  const { amount, description = 'پرداخت بدهی' } = req.body;
  const db = getDb();
  db.prepare('UPDATE users SET debt = MAX(0, debt - ?) WHERE id = ?').run(Number(amount), req.params.id);

  const user = db.prepare('SELECT credits, debt FROM users WHERE id = ?').get(req.params.id);
  if (user.debt <= 0) {
    db.prepare('UPDATE users SET debt = 0, debt_since = NULL WHERE id = ?').run(req.params.id);
  }
  db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
    .run(req.params.id, -Number(amount), 'debt_pay', description);

  const updated = db.prepare('SELECT credits, debt FROM users WHERE id = ?').get(req.params.id);
  notifyClient(req, req.params.id, 'credits:update', { credits: updated.credits, debt: updated.debt });
  res.json({ debt: updated.debt });
});

router.get('/:id/transactions', (req, res) => {
  const db = getDb();
  const transactions = db.prepare(
    'SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(req.params.id);
  res.json(transactions);
});

module.exports = router;

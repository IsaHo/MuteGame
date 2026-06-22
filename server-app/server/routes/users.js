const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const billing = require('../billing');
const { audit } = require('../audit');

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
  const initialCredits = Math.max(0, Number(credits) || 0);
  const adminCtx = { admin_id: req.admin && req.admin.id };
  try {
    let username, result;
    db.transaction(() => {
      const num = nextUserNumber(db);
      username = String(num);
      const hash = bcrypt.hashSync(username, 10);
      result = db.prepare(
        'INSERT INTO users (username, password, name, family, phone, credits, limit_minutes, allowed_seats, post_pay) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)'
      ).run(username, hash, name.trim(), family.trim(), phone.trim(),
            Number(limit_minutes) || 0, Math.max(1, Number(allowed_seats) || 1), post_pay ? 1 : 0);
      if (initialCredits > 0) {
        billing.creditUser(db, {
          user_id: result.lastInsertRowid,
          amount: initialCredits,
          event_type: 'manual_credit',
          description: 'شارژ اولیه',
          ctx: adminCtx,
        });
      }
      audit(req, 'user.create', 'user', result.lastInsertRowid, { username, name, family, phone, credits: initialCredits, limit_minutes, allowed_seats, post_pay });
    })();
    res.json({ id: result.lastInsertRowid, username, name, family, phone, credits: initialCredits });
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
    db.transaction(() => {
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      audit(req, 'user.update', 'user', req.params.id, { fields: updates.map(u => u.split('=')[0]) });
    })();
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
  db.transaction(() => {
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(newStatus, req.params.id);
    audit(req, 'user.toggle-active', 'user', req.params.id, { is_active: newStatus });
  })();

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
  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  db.transaction(() => {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    audit(req, 'user.delete', 'user', req.params.id, { username: target?.username || null });
  })();
  res.json({ success: true });
});

// Charge (add credits) with tier/individual discount. C3B: all balance
// mutation goes through billing.creditUser; total_spent denorm bump
// happens in same txn after the helper.
router.post('/:id/charge', adminIpGuard, (req, res) => {
  const { amount, description, free = false } = req.body;
  const db = getDb();
  const userId = Number(req.params.id);
  const adminCtx = { admin_id: req.admin && req.admin.id };

  if (free) {
    const amt = Number(amount);
    if (!(amt > 0)) return res.status(400).json({ error: 'مبلغ نامعتبر' });
    const desc = description || '🎁 شارژ رایگان (هدیه ادمین)';
    let result;
    db.transaction(() => {
      result = billing.creditUser(db, {
        user_id: userId, amount: amt,
        event_type: 'manual_credit', description: desc,
        ctx: adminCtx,
      });
      audit(req, 'user.charge.free', 'user', userId, { amount: amt, description: desc });
    })();
    syncClientCredits(req, userId, result.credits_after, result.debt_after);
    return res.json({ credits: result.credits_after, bonus: 0, discount: 0, free: true });
  }

  const requested = Number(amount);
  if (!(requested > 0)) return res.status(400).json({ error: 'مبلغ نامعتبر' });
  const { total, bonus, discount } = applyDiscount(db, userId, requested);

  const desc = description || (bonus > 0
    ? `شارژ ${requested.toLocaleString()} ریال + ${bonus.toLocaleString()} ریال تخفیف (${discount}%)`
    : 'شارژ دستی توسط ادمین');

  let result;
  db.transaction(() => {
    result = billing.creditUser(db, {
      user_id: userId, amount: total,
      event_type: 'recharge', description: desc,
      ctx: adminCtx,
    });
    db.prepare('UPDATE users SET total_spent = total_spent + ? WHERE id = ?').run(requested, userId);
    audit(req, 'user.charge', 'user', userId, { requested, total, bonus, discount, description: desc, debt_paid: result.debt_paid, credits_added: result.credits_added });
  })();
  syncClientCredits(req, userId, result.credits_after, result.debt_after);
  res.json({ credits: result.credits_after, bonus, discount });
});

// Decharge (remove credits) — partial mode preserves the old
// MAX(0, credits - amount) silent-floor semantic.
router.post('/:id/decharge', adminIpGuard, (req, res) => {
  const { amount, description = 'کاهش شارژ توسط ادمین' } = req.body;
  const db = getDb();
  const amt = Number(amount);
  if (!(amt > 0)) return res.status(400).json({ error: 'مبلغ نامعتبر' });
  const userId = Number(req.params.id);
  const adminCtx = { admin_id: req.admin && req.admin.id };
  let result;
  db.transaction(() => {
    result = billing.chargeUser(db, {
      user_id: userId, amount: amt,
      event_type: 'manual_debit', description, mode: 'partial',
      ctx: adminCtx,
    });
    audit(req, 'user.decharge', 'user', userId, {
      requested: amt,
      charged: amt - result.shortfall,
      shortfall: result.shortfall,
      description,
    });
  })();
  syncClientCredits(req, userId, result.c_after, result.d_after);
  res.json({ credits: result.c_after });
});

// Add debt — credits untouched, debt += amount. debt_since denorm
// set on zero→nonzero transition.
router.post('/:id/debt/add', adminIpGuard, (req, res) => {
  const { amount, description = 'افزایش بدهی' } = req.body;
  const db = getDb();
  const amt = Number(amount);
  if (!(amt > 0)) return res.status(400).json({ error: 'مبلغ نامعتبر' });
  const userId = Number(req.params.id);
  const adminCtx = { admin_id: req.admin && req.admin.id };
  let result;
  db.transaction(() => {
    result = billing.chargeUser(db, {
      user_id: userId, amount: amt,
      event_type: 'debt_add', description,
      ctx: adminCtx,
    });
    if (result.d_after - result.debt_delta === 0) {
      db.prepare('UPDATE users SET debt_since = CURRENT_TIMESTAMP WHERE id = ? AND debt_since IS NULL').run(userId);
    }
    audit(req, 'user.debt.add', 'user', userId, { amount: amt, description });
  })();
  notifyClient(req, userId, 'credits:update', { credits: result.c_after, debt: result.d_after });
  res.json({ debt: result.d_after });
});

// Pay debt — debt -= min(amount, debt). debt_since cleared on debt→0.
router.post('/:id/debt/pay', adminIpGuard, (req, res) => {
  const { amount, description = 'پرداخت بدهی' } = req.body;
  const db = getDb();
  const amt = Number(amount);
  if (!(amt > 0)) return res.status(400).json({ error: 'مبلغ نامعتبر' });
  const userId = Number(req.params.id);
  const adminCtx = { admin_id: req.admin && req.admin.id };
  let result;
  db.transaction(() => {
    result = billing.creditUser(db, {
      user_id: userId, amount: amt,
      event_type: 'debt_pay', description,
      ctx: adminCtx,
    });
    if (result.debt_after === 0) {
      db.prepare('UPDATE users SET debt_since = NULL WHERE id = ?').run(userId);
    }
    audit(req, 'user.debt.pay', 'user', userId, { requested: amt, paid: result.debt_paid, description });
  })();
  notifyClient(req, userId, 'credits:update', { credits: result.credits_after, debt: result.debt_after });
  res.json({ debt: result.debt_after });
});

router.get('/:id/transactions', (req, res) => {
  const db = getDb();
  const transactions = db.prepare(
    'SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(req.params.id);
  res.json(transactions);
});

module.exports = router;

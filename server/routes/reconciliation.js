'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAdmin, audit } = require('../audit');
const svc = require('../reconciliation-service');

function parsePageInt(raw, { fallback, min, max, label }) {
  if (raw === undefined) return { value: fallback };
  if (!/^\d+$/.test(String(raw))) return { error: `${label} نامعتبر است` };
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return { error: `${label} باید بین ${min} و ${max} باشد` };
  }
  return { value };
}

// GET /api/reconciliation/summary
router.get('/summary', requireAdmin('users.financial'), (req, res) => {
  try {
    res.json(svc.getReconciliationSummary(getDb()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/reconciliation/users?drift_only=true&limit=50&offset=0
router.get('/users', requireAdmin('users.financial'), (req, res) => {
  if (req.query.drift_only !== undefined && !['true', 'false'].includes(req.query.drift_only)) {
    return res.status(400).json({ error: 'drift_only باید true یا false باشد' });
  }
  const driftOnly = req.query.drift_only === 'true';
  const limitResult = parsePageInt(req.query.limit, { fallback: 50, min: 1, max: 200, label: 'limit' });
  const offsetResult = parsePageInt(req.query.offset, { fallback: 0, min: 0, max: 1000000, label: 'offset' });
  if (limitResult.error || offsetResult.error) {
    return res.status(400).json({ error: limitResult.error || offsetResult.error });
  }
  try {
    res.json(svc.getReconciliationUsers(getDb(), {
      driftOnly, limit: limitResult.value, offset: offsetResult.value,
    }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/reconciliation/users/:id/ledger?limit=100&offset=0
router.get('/users/:id/ledger', requireAdmin('users.financial'), (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'شناسه کاربر نامعتبر' });
  const limitResult = parsePageInt(req.query.limit, { fallback: 100, min: 1, max: 500, label: 'limit' });
  const offsetResult = parsePageInt(req.query.offset, { fallback: 0, min: 0, max: 1000000, label: 'offset' });
  if (limitResult.error || offsetResult.error) {
    return res.status(400).json({ error: limitResult.error || offsetResult.error });
  }
  const db = getDb();
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) return res.status(404).json({ error: 'کاربر پیدا نشد' });
  try {
    res.json(svc.getUserLedger(db, {
      userId, limit: limitResult.value, offset: offsetResult.value,
    }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/reconciliation/users/:id/correct
router.post('/users/:id/correct', requireAdmin('users.reconcile'), (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'شناسه کاربر نامعتبر' });

  const { idempotency_key, reason, expected_current_credits, expected_current_debt, expected_last_ledger_id } = req.body || {};

  const keyStr = typeof idempotency_key === 'string' ? idempotency_key.trim() : '';
  if (keyStr.length < 1 || keyStr.length > 200) return res.status(400).json({ error: 'idempotency_key باید ۱ تا ۲۰۰ کاراکتر باشد' });

  const reasonStr = typeof reason === 'string' ? reason.trim() : '';
  if (reasonStr.length < 10 || reasonStr.length > 500) return res.status(400).json({ error: 'دلیل باید ۱۰ تا ۵۰۰ کاراکتر باشد' });

  if (typeof expected_current_credits !== 'number' || !Number.isFinite(expected_current_credits) ||
      typeof expected_current_debt    !== 'number' || !Number.isFinite(expected_current_debt)) {
    return res.status(400).json({ error: 'expected_current_credits/debt باید عدد معتبر باشد' });
  }
  if (!Number.isInteger(expected_last_ledger_id) || expected_last_ledger_id <= 0) {
    return res.status(400).json({ error: 'expected_last_ledger_id نامعتبر' });
  }

  const db = getDb();
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) return res.status(404).json({ error: 'کاربر پیدا نشد' });

  const fingerprint = svc.makeFingerprint(userId, req.body);
  let result;
  try {
    result = svc.applyCorrection(db, {
      userId, adminId: req.admin.id, idempotencyKey: keyStr, reason: reasonStr,
      expectedCurrentCredits: expected_current_credits,
      expectedCurrentDebt:    expected_current_debt,
      expectedLastLedgerId:   expected_last_ledger_id,
      fingerprint,
      auditFn: (_db, _adminId, correctedUserId, details) =>
        audit(req, 'reconciliation.correct', 'user', correctedUserId, details),
    });
  } catch (e) {
    if (e.code === 'BASELINE_REQUIRED')    return res.status(409).json({ error: 'کاربر پایه‌ای است؛ اصلاح ممنوع', code: 'BASELINE_REQUIRED' });
    if (e.code === 'DRIFT_DETECTED')       return res.status(409).json({ error: 'مقادیر مورد انتظار منسوخ شده', code: 'DRIFT_DETECTED' });
    if (e.code === 'IDEMPOTENCY_CONFLICT') return res.status(409).json({ error: 'کلید idempotency تداخل دارد', code: 'IDEMPOTENCY_CONFLICT' });
    if (e.code === 'ALREADY_CLEAN')        return res.status(409).json({ error: 'حساب تمیز است؛ اصلاح لازم نیست', code: 'ALREADY_CLEAN' });
    if (e.code === 'USER_NOT_FOUND')       return res.status(404).json({ error: 'کاربر پیدا نشد', code: 'USER_NOT_FOUND' });
    console.error('[reconciliation.correct]', e.stack || e.message);
    return res.status(500).json({ error: 'خطای داخلی سرور' });
  }

  // Post-commit socket sync — not transactional, best-effort
  try {
    const io = req.app.get('io');
    const clients = req.app.get('connectedClients');
    if (io && clients) {
      for (const [socketId, c] of clients) {
        if (Number(c.userId) === userId) {
          c.credits = result.credits;
          c.debt    = result.debt;
          io.to(socketId).emit('credits:update', { credits: result.credits, debt: result.debt });
        }
      }
      io.emit('clients:update', Array.from(clients.values()));
    }
  } catch (e) { console.error('[reconciliation] socket sync (non-fatal):', e.message); }

  res.json(result);
});

module.exports = { router };

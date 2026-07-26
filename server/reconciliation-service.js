'use strict';

const crypto = require('crypto');
const billing = require('./billing');

const EPSILON = 0.001;

// ─── Service (db-only, no HTTP — direct node:test coverage) ──────────────

const USERS_SQL = `
  WITH last_ledger AS (
    SELECT user_id, credits_after, debt_after, created_at, id AS ledger_id
    FROM credit_ledger
    WHERE id IN (SELECT MAX(id) FROM credit_ledger GROUP BY user_id)
  )
  SELECT
    u.id, u.username, u.name, u.family,
    u.credits                AS actual_credits,
    u.debt                   AS actual_debt,
    ll.credits_after         AS expected_credits,
    ll.debt_after            AS expected_debt,
    ROUND(u.credits - COALESCE(ll.credits_after, u.credits), 6) AS credits_drift,
    ROUND(u.debt   - COALESCE(ll.debt_after,   u.debt),   6)   AS debt_drift,
    ll.ledger_id             AS last_ledger_id,
    ll.created_at            AS last_ledger_at,
    (ll.user_id IS NULL)     AS has_legacy_baseline
  FROM users u
  LEFT JOIN last_ledger ll ON ll.user_id = u.id
  ORDER BY u.id
`;

function rowStatus(r) {
  if (r.has_legacy_baseline) return 'baseline';
  if (Math.abs(r.credits_drift) > EPSILON || Math.abs(r.debt_drift) > EPSILON) return 'drift';
  return 'clean';
}

function getReconciliationSummary(db) {
  const rows = db.prepare(USERS_SQL).all();
  let drifted = 0;
  let baselineOnly = 0;
  let totalDriftMagnitude = 0;
  for (const r of rows) {
    if (r.has_legacy_baseline) { baselineOnly++; continue; }
    if (Math.abs(r.credits_drift) > EPSILON || Math.abs(r.debt_drift) > EPSILON) {
      drifted++;
      totalDriftMagnitude += Math.abs(r.credits_drift) + Math.abs(r.debt_drift);
    }
  }
  return {
    total_users: rows.length,
    drifted,
    baseline_only: baselineOnly,
    total_drift_magnitude: Math.round(totalDriftMagnitude * 1000) / 1000,
    checked_at: new Date().toISOString(),
  };
}

function getReconciliationUsers(db, { driftOnly = false, limit = 50, offset = 0 } = {}) {
  const rows = db.prepare(USERS_SQL).all().map(r => ({ ...r, status: rowStatus(r) }));
  const filtered = driftOnly ? rows.filter(r => r.status === 'drift') : rows;
  return { total: filtered.length, rows: filtered.slice(offset, offset + limit) };
}

function getUserLedger(db, { userId, limit = 100, offset = 0 } = {}) {
  const total = db.prepare('SELECT COUNT(*) AS c FROM credit_ledger WHERE user_id = ?').get(userId).c;
  const rows = db.prepare(
    'SELECT id, event_type, amount_credits, amount_debt, credits_before, credits_after, ' +
    'debt_before, debt_after, description, created_at ' +
    'FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
  ).all(userId, limit, offset);
  return { total, rows };
}

function makeFingerprint(userId, {
  reason = '', expected_current_credits, expected_current_debt, expected_last_ledger_id,
}) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({
      user_id: userId,
      reason: String(reason).trim(),
      expected_current_credits,
      expected_current_debt,
      expected_last_ledger_id,
    }))
    .digest('hex');
}

/*
 * defaultAuditFn — writes to audit_log using the passed db.
 * Injected so the service stays testable without jwt-secret / getDb().
 */
function defaultAuditFn(db, adminId, userId, details) {
  db.prepare(
    'INSERT INTO audit_log (admin_id, admin_username, admin_ip, action, entity, entity_id, details) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(adminId, '', '', 'reconciliation.correct', 'user', String(userId), JSON.stringify(details));
}

/*
 * applyCorrection — one BEGIN IMMEDIATE transaction:
 *   1. idempotency check
 *   2. optimistic lock on users row (expected_current_credits/debt)
 *   3. latest ledger row check + expected_last_ledger_id optimistic check
 *   4. billing.manualReconciliation (appends credit_ledger + updates users)
 *   5. reconciliation_log insert
 *   6. auditFn (default = write to audit_log; injected for tests)
 *
 * Error codes on thrown Error:
 *   IDEMPOTENCY_CONFLICT  — same key, different user/fingerprint
 *   USER_NOT_FOUND        — user deleted between route check and transaction
 *   DRIFT_DETECTED        — stale expected values or ledger changed
 *   BASELINE_REQUIRED     — user has no ledger rows
 *   ALREADY_CLEAN         — both deltas within epsilon (no-op)
 */
function applyCorrection(db, {
  userId, adminId, idempotencyKey, reason,
  expectedCurrentCredits, expectedCurrentDebt, expectedLastLedgerId,
  fingerprint,
  auditFn = defaultAuditFn,
}) {
  return db.transaction(() => {
    // 1. Idempotency
    const existing = db.prepare(
      'SELECT id, user_id, request_fingerprint, credits_after, debt_after, correction_ledger_id ' +
      'FROM reconciliation_log WHERE idempotency_key = ?'
    ).get(idempotencyKey);
    if (existing) {
      if (existing.user_id !== userId || existing.request_fingerprint !== fingerprint) {
        const e = new Error('idempotency key reused with different request'); e.code = 'IDEMPOTENCY_CONFLICT'; throw e;
      }
      return { cached: true, credits: existing.credits_after, debt: existing.debt_after, ledger_id: existing.correction_ledger_id };
    }

    // 2. Load user
    const user = db.prepare('SELECT id, credits, debt FROM users WHERE id = ?').get(userId);
    if (!user) { const e = new Error('user not found'); e.code = 'USER_NOT_FOUND'; throw e; }

    // 3a. Optimistic check on balance
    if (Math.abs(user.credits - expectedCurrentCredits) > EPSILON ||
        Math.abs(user.debt    - expectedCurrentDebt)    > EPSILON) {
      const e = new Error('stale expected values'); e.code = 'DRIFT_DETECTED'; throw e;
    }

    // 3b. Latest ledger row
    const lastLedger = db.prepare(
      'SELECT id, credits_after, debt_after FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 1'
    ).get(userId);
    if (!lastLedger) { const e = new Error('no ledger rows — baseline'); e.code = 'BASELINE_REQUIRED'; throw e; }

    // 3c. Optimistic check on ledger id
    if (lastLedger.id !== expectedLastLedgerId) {
      const e = new Error('ledger changed since read'); e.code = 'DRIFT_DETECTED'; throw e;
    }

    // 4. Compute deltas
    const creditsDelta = lastLedger.credits_after - user.credits;
    const debtDelta    = lastLedger.debt_after    - user.debt;
    if (Math.abs(creditsDelta) <= EPSILON && Math.abs(debtDelta) <= EPSILON) {
      const e = new Error('already clean'); e.code = 'ALREADY_CLEAN'; throw e;
    }

    // 5. Apply billing
    const result = billing.manualReconciliation(db, {
      user_id: userId, credits_delta: creditsDelta, debt_delta: debtDelta, reason, ctx: { admin_id: adminId },
    });

    // 6. Insert reconciliation_log
    db.prepare(
      'INSERT INTO reconciliation_log ' +
      '(idempotency_key, request_fingerprint, user_id, admin_id, reason, ' +
      'credits_before, credits_after, debt_before, debt_after, ledger_id, correction_ledger_id) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      idempotencyKey, fingerprint, userId, adminId, reason,
      user.credits, result.credits, user.debt, result.debt,
      lastLedger.id, result.ledger_id
    );

    // 7. Audit (inside transaction — rollback if this throws)
    auditFn(db, adminId, userId, {
      reason,
      credits_before: user.credits,
      credits_after: result.credits,
      debt_before: user.debt,
      debt_after: result.debt,
      ledger_id: lastLedger.id,
      correction_ledger_id: result.ledger_id,
    });

    return { cached: false, credits: result.credits, debt: result.debt, ledger_id: result.ledger_id };
  }).immediate();
}

module.exports = {
  getReconciliationSummary,
  getReconciliationUsers,
  getUserLedger,
  applyCorrection,
  makeFingerprint,
  EPSILON,
};

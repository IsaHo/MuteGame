/*
 * Billing engine helpers — the ONLY module allowed to mutate users.credits
 * or users.debt. Direct UPDATE on those columns from any other module is a
 * bug to be rejected in review (see feedback_mutegame_billing memory).
 *
 * Public surface:
 *   openSession           — atomically claim a seat; locks current rate
 *   closeSession          — final flush + close; idempotent
 *   chargeUser            — non-session debit (shop, manual)
 *   creditUser            — credit balance (recharge / debt_pay / manual_credit)
 *   manualReconciliation  — operator-resolved drift correction
 *   billSessionUntilLocked — internal tick helper, exported for the ticker
 *   computeCurrentRate    — derive rate from settings; exported for tests
 *
 * Errors:
 *   DriftDetectedError    — optimistic-concurrency assertion failed
 *   SeatBusyError         — partial UNIQUE INDEX rejected open
 *   InsufficientFundsError — non-post_pay user owes more than balance (strict mode)
 *
 * Transaction policy: every public helper wraps its work in
 * `db.transaction(fn).immediate()` which issues `BEGIN IMMEDIATE`. This
 * serializes concurrent writers at BEGIN time instead of at write
 * escalation, eliminating spurious DriftDetectedError races between the
 * ticker and admin actions in the same process. Nested invocations
 * (caller already inside another better-sqlite3 transaction) degrade to
 * SAVEPOINT regardless of the outer mode — safe.
 *
 * Optimistic concurrency is still asserted on every users-row write
 * (`WHERE credits = c_before AND debt = d_before` + `changes() === 1`)
 * as defense in depth — protects against cross-process writers (other
 * connections to the same file) and against future code paths that
 * read outside a transaction.
 */

const crypto = require('crypto');

class DriftDetectedError extends Error {
  constructor(msg) { super(msg); this.name = 'DriftDetectedError'; this.code = 'DRIFT_DETECTED'; }
}
class SeatBusyError extends Error {
  constructor(computerName, seatSlot) {
    super('seat busy: ' + computerName + '#' + seatSlot);
    this.name = 'SeatBusyError';
    this.code = 'SEAT_BUSY';
    this.computer_name = computerName;
    this.seat_slot = seatSlot;
  }
}
class InsufficientFundsError extends Error {
  constructor(user_id, shortfall) {
    super('insufficient funds user=' + user_id + ' shortfall=' + shortfall);
    this.name = 'InsufficientFundsError';
    this.code = 'INSUFFICIENT_FUNDS';
    this.user_id = user_id;
    this.shortfall = shortfall;
  }
}
class ResumeRejectedError extends Error {
  constructor(reason, details) {
    super('resume rejected: ' + reason);
    this.name = 'ResumeRejectedError';
    this.code = 'RESUME_REJECTED';
    this.reason = reason;
    this.details = details || {};
  }
}

const RESUME_REJECT_REASONS = new Set([
  'invalid_payload', 'session_not_found', 'state_closed',
  'wrong_computer', 'wrong_user', 'recovery_max_age_exceeded',
  'duplicate_client', 'race_lost', 'internal_error',
]);

const VALID_EVENT_TYPES = new Set([
  'tick','recharge','debt_pay','debt_add','shop',
  'manual_credit','manual_debit','reconciliation',
]);

const CLOSE_REASONS = new Set([
  'user_logout', 'admin_force_logout', 'force_login_displace',
  'recovery_timeout', 'pre_migration', 'no_funds',
  'closing_routine', 'session_expired', 'boot_recovery',
  'boot_recovery_age', 'disconnect_reopen',
]);

/*
 * Format a Date as SQLite-compatible "YYYY-MM-DD HH:MM:SS.mmm" in UTC.
 * Milliseconds are preserved — the ticker depends on them for fractional
 * accumulation (drop ms here and a 0.5s tick rounds to 1s, breaking the
 * unpaid_micros invariant). SQLite DATETIME columns accept the fractional
 * form; readers/reports tolerate it; Date.parse(s+'Z') round-trips cleanly.
 */
function isoNow(date) {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/*
 * Parse SQLite-style "YYYY-MM-DD HH:MM:SS" (or ISO) as UTC milliseconds.
 * Throws on bad input so callers fail loud instead of silently NaN-billing.
 */
function parseDbTimestampMs(s) {
  if (!s) throw new Error('parseDbTimestampMs: null/undefined input');
  const iso = String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z');
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error('parseDbTimestampMs: unparseable input ' + s);
  return ms;
}

/*
 * computeCurrentRate — derive rate_per_hour applicable at `now` from
 * settings. Locked into a session at openSession() time. Ledger rows stamp
 * the locked value so reports reconstruct the actual price paid even if
 * settings change later.
 *
 * Window semantics: peak window [peak_start, peak_end). If `now` falls in
 * peak → peak_multiplier. Else if in offpeak → offpeak_multiplier. Else
 * multiplier = 1. Peak wins over offpeak on overlap.
 */
function computeCurrentRate(db, now) {
  const get = (k) => {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    return r ? r.value : null;
  };
  const base       = Number(get('gaming_price_per_hour') || 0);
  const peakStart  = Number(get('gaming_peak_start') || 0);
  const peakEnd    = Number(get('gaming_peak_end') || 0);
  const peakMul    = Number(get('gaming_peak_multiplier') || 1);
  const offStart   = Number(get('gaming_offpeak_start') || 0);
  const offEnd     = Number(get('gaming_offpeak_end') || 0);
  const offMul     = Number(get('gaming_offpeak_multiplier') || 1);

  const hour = now.getHours();
  const inWindow = (h, start, end) => start < end
    ? (h >= start && h < end)
    : (h >= start || h < end);

  let multiplier = 1;
  if (inWindow(hour, peakStart, peakEnd)) multiplier = peakMul;
  else if (inWindow(hour, offStart, offEnd)) multiplier = offMul;

  return {
    rate_per_hour: base * multiplier,
    multiplier,
    base_rate_per_hour: base,
  };
}

/*
 * _writeLedgerRow — internal append-only ledger writer. Used by every helper
 * that touches users.credits / users.debt. Wraps optimistic-concurrency
 * assertion + arithmetic CHECK enforcement (schema-level) + audit fields.
 */
function _writeLedgerRow(db, {
  user_id, session_id, event_type,
  credits_delta, debt_delta,
  c_before, c_after, d_before, d_after,
  rate_per_hour, multiplier, tick_seconds,
  admin_id, description,
  shift_id = null, payment_method = null, payment_amount = null,
}) {
  if (!VALID_EVENT_TYPES.has(event_type)) {
    throw new RangeError('invalid event_type=' + event_type);
  }
  db.prepare(
    'INSERT INTO credit_ledger ('
    + 'user_id, session_id, event_type, '
    + 'amount_credits, amount_debt, '
    + 'credits_before, credits_after, debt_before, debt_after, '
    + 'rate_per_hour, multiplier, tick_seconds, '
    + 'admin_id, description, shift_id, payment_method, payment_amount'
    + ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    user_id, session_id || null, event_type,
    credits_delta, debt_delta,
    c_before, c_after, d_before, d_after,
    rate_per_hour == null ? null : rate_per_hour,
    multiplier == null ? null : multiplier,
    tick_seconds == null ? null : tick_seconds,
    admin_id || null,
    description || null,
    shift_id || null,
    payment_method || null,
    payment_amount == null ? null : payment_amount
  );
}

/*
 * _applyChargeLocked — compute split (credits-first then debt if post_pay)
 * and persist with optimistic-concurrency assertion. Caller already holds
 * a transaction. Returns the deltas applied + shortfall (mode='partial' only).
 *
 * mode:
 *   'strict'  — if amount > credits AND user not post_pay: throw InsufficientFunds
 *   'partial' — if amount > credits AND user not post_pay: charge available, return shortfall>0
 *
 * Both modes: post_pay user with amount > credits → credits → 0, debt += shortfall.
 *
 * Returns: { credits_delta, debt_delta, c_after, d_after, shortfall }
 */
function _applyChargeLocked(db, {
  user_id, session_id, amount, event_type, mode,
  rate_per_hour, multiplier, tick_seconds,
  description, ctx,
  shift_id = null, payment_method = null,
}) {
  if (!(amount > 0)) throw new RangeError('_applyChargeLocked: amount must be > 0, got ' + amount);
  if (mode !== 'strict' && mode !== 'partial') {
    throw new RangeError('_applyChargeLocked: invalid mode=' + mode);
  }
  const u = db.prepare('SELECT id, credits, debt, post_pay FROM users WHERE id = ?').get(user_id);
  if (!u) throw new Error('_applyChargeLocked: user ' + user_id + ' not found');
  const c_before = u.credits;
  const d_before = u.debt;

  // ── debt_add branch ─────────────────────────────────────────────────
  // Pure debt accrual: credits untouched, debt += amount. Used for
  // operator-entered debt (service-rendered-on-credit). total_spent is
  // NOT bumped — debt_add is not customer spending. mode is irrelevant
  // here (no credits → no shortfall path).
  if (event_type === 'debt_add') {
    const c_after = c_before;
    const d_after = d_before + amount;
    const upd = db.prepare(
      'UPDATE users SET debt = ? WHERE id = ? AND credits = ? AND debt = ?'
    ).run(d_after, user_id, c_before, d_before);
    if (upd.changes !== 1) {
      throw new DriftDetectedError(
        'debt_add drift user=' + user_id + ' expected(c=' + c_before + ',d=' + d_before + ') changes=' + upd.changes
      );
    }
    _writeLedgerRow(db, {
      user_id, session_id, event_type,
      credits_delta: 0, debt_delta: amount,
      c_before, c_after, d_before, d_after,
      rate_per_hour, multiplier, tick_seconds,
      admin_id: ctx && ctx.admin_id,
      description, shift_id, payment_method,
    });
    return { credits_delta: 0, debt_delta: amount, c_after, d_after, shortfall: 0 };
  }

  // ── credit-first charge branch (tick / shop / manual_debit) ─────────
  let credits_delta = 0;
  let debt_delta = 0;
  let shortfall = 0;
  let charged = amount;

  if (c_before >= amount) {
    credits_delta = -amount;
  } else if (u.post_pay) {
    credits_delta = -c_before;
    debt_delta = amount - c_before;
  } else if (mode === 'partial') {
    // Charge what we can; report the gap.
    credits_delta = -c_before;
    shortfall = amount - c_before;
    charged = c_before;
    if (charged === 0) {
      // Nothing to record — no ledger row, no balance change. Caller must
      // still know there's a shortfall to act on (eviction).
      return { credits_delta: 0, debt_delta: 0, c_after: c_before, d_after: d_before, shortfall };
    }
  } else {
    throw new InsufficientFundsError(user_id, amount - c_before);
  }

  const c_after = c_before + credits_delta;
  const d_after = d_before + debt_delta;

  const upd = db.prepare(
    'UPDATE users SET credits = ?, debt = ?, total_spent = total_spent + ? '
    + 'WHERE id = ? AND credits = ? AND debt = ?'
  ).run(c_after, d_after, charged, user_id, c_before, d_before);
  if (upd.changes !== 1) {
    throw new DriftDetectedError(
      'charge drift user=' + user_id + ' expected(c=' + c_before + ',d=' + d_before + ') changes=' + upd.changes
    );
  }

  _writeLedgerRow(db, {
    user_id, session_id, event_type,
    credits_delta, debt_delta,
    c_before, c_after, d_before, d_after,
    rate_per_hour, multiplier, tick_seconds,
    admin_id: ctx && ctx.admin_id,
    description, shift_id, payment_method,
  });

  return { credits_delta, debt_delta, c_after, d_after, shortfall };
}

/*
 * openSession — atomically claim a seat. Stamps locked_rate_per_hour from
 * the current settings + session_uuid for client resume protocol. Throws
 * SeatBusyError if the partial UNIQUE INDEX rejects (concurrent claim).
 *
 * Returns: { session_id, session_uuid, locked_rate_per_hour, multiplier, started_at }
 */
function openSession(db, { user_id, computer_name, seat_slot = 0, ctx = {}, now = new Date() }) {
  if (!Number.isInteger(user_id)) throw new TypeError('openSession: user_id must be integer');
  if (typeof computer_name !== 'string' || !computer_name.length) {
    throw new TypeError('openSession: computer_name required');
  }
  if (!Number.isInteger(seat_slot) || seat_slot < 0) {
    throw new RangeError('openSession: seat_slot must be non-negative integer');
  }

  return db.transaction(() => {
    const rate = computeCurrentRate(db, now);
    const session_uuid = crypto.randomUUID();
    const nowIso = isoNow(now);
    let info;
    try {
      info = db.prepare(
        'INSERT INTO sessions ('
        + 'user_id, computer_name, seat_slot, session_uuid, '
        + 'state, start_time, last_billed_at, unpaid_micros, '
        + 'locked_rate_per_hour, duration'
        + ') VALUES (?, ?, ?, ?, \'active\', ?, ?, 0, ?, 0)'
      ).run(user_id, computer_name, seat_slot, session_uuid, nowIso, nowIso, rate.rate_per_hour);
    } catch (e) {
      // Narrow catch: only the seat partial UNIQUE INDEX. The only UNIQUE
      // index on sessions covers (computer_name, seat_slot) — match on
      // those column names in the error text. Anything else rethrows.
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE'
          && /sessions\.computer_name/i.test(e.message)
          && /sessions\.seat_slot/i.test(e.message)) {
        throw new SeatBusyError(computer_name, seat_slot);
      }
      throw e;
    }
    return {
      session_id: info.lastInsertRowid,
      session_uuid,
      locked_rate_per_hour: rate.rate_per_hour,
      multiplier: rate.multiplier,
      started_at: nowIso,
    };
  }).immediate();
}

/*
 * billSessionUntilLocked — advance a session's last_billed_at to `now`,
 * compute owed micros, fold into unpaid_micros, charge whole units against
 * the user. Caller already holds a transaction (the ticker / closeSession).
 *
 * Returns: { tick_seconds, charged_units, shortfall, unpaid_micros_after,
 *            credits_after, debt_after }
 *
 * Throws on backward clock warp (defensive — boot probe should already have
 * caught this, but a within-process clock jump is possible).
 */
function billSessionUntilLocked(db, session, now, ctx = {}) {
  if (!session || session.state !== 'active') {
    throw new Error('billSessionUntilLocked: expected active session, got state=' + (session && session.state));
  }
  const lastMs = parseDbTimestampMs(session.last_billed_at);
  const nowMs = now.getTime();
  const deltaSec = (nowMs - lastMs) / 1000;
  if (deltaSec < 0) {
    throw new Error('billSessionUntilLocked: clock warp — now < last_billed_at by ' + Math.abs(deltaSec) + 's');
  }
  if (deltaSec === 0) {
    return { tick_seconds: 0, charged_units: 0, shortfall: 0, unpaid_micros_after: session.unpaid_micros, credits_after: null, debt_after: null };
  }

  const rate = session.locked_rate_per_hour;
  const owedMicros = Math.floor(deltaSec * rate * 1_000_000 / 3600);
  const totalMicros = session.unpaid_micros + owedMicros;
  const wholeUnits = Math.floor(totalMicros / 1_000_000);
  const remainderMicros = totalMicros - wholeUnits * 1_000_000;
  const nowIso = isoNow(now);

  const sUpd = db.prepare(
    'UPDATE sessions SET last_billed_at = ?, unpaid_micros = ?, duration = duration + ? '
    + 'WHERE id = ? AND state = \'active\''
  ).run(nowIso, remainderMicros, Math.floor(deltaSec), session.id);
  if (sUpd.changes !== 1) {
    throw new Error('billSessionUntilLocked: session UPDATE matched ' + sUpd.changes + ' rows id=' + session.id);
  }

  if (wholeUnits === 0) {
    return { tick_seconds: deltaSec, charged_units: 0, shortfall: 0, unpaid_micros_after: remainderMicros, credits_after: null, debt_after: null };
  }

  const charge = _applyChargeLocked(db, {
    user_id: session.user_id,
    session_id: session.id,
    amount: wholeUnits,
    event_type: 'tick',
    mode: 'partial',          // session tick MUST be partial — kiosk eviction is upstream
    rate_per_hour: rate,
    multiplier: null,
    tick_seconds: Math.floor(deltaSec),
    description: 'tick s=' + session.id + ' dt=' + deltaSec.toFixed(1) + 's',
    ctx,
  });

  return {
    tick_seconds: deltaSec,
    charged_units: wholeUnits - charge.shortfall,
    shortfall: charge.shortfall,
    unpaid_micros_after: remainderMicros,
    credits_after: charge.c_after,
    debt_after: charge.d_after,
  };
}

/*
 * closeSession — final flush (partial mode) + close. Idempotent: closing an
 * already-closed session is a no-op.
 *
 * Returns: { session_id, already_closed, end_reason, tick_seconds,
 *            charged_units, shortfall }
 */
function closeSession(db, { session_id, end_reason, ctx = {}, now = new Date() }) {
  if (!Number.isInteger(session_id)) throw new TypeError('closeSession: session_id must be integer');
  if (!CLOSE_REASONS.has(end_reason)) {
    throw new RangeError('closeSession: invalid end_reason=' + end_reason);
  }

  return db.transaction(() => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session_id);
    if (!session) throw new Error('closeSession: session ' + session_id + ' not found');
    if (session.state === 'closed' || session.end_time) {
      return {
        session_id, already_closed: true,
        end_reason: session.end_reason,
        tick_seconds: 0, charged_units: 0, shortfall: 0,
      };
    }

    let finalTick = { tick_seconds: 0, charged_units: 0, shortfall: 0 };
    if (session.state === 'active') {
      const t = billSessionUntilLocked(db, session, now, ctx);
      finalTick = {
        tick_seconds: t.tick_seconds,
        charged_units: t.charged_units,
        shortfall: t.shortfall,
      };
    }

    const nowIso = isoNow(now);
    const upd = db.prepare(
      'UPDATE sessions SET end_time = ?, state = \'closed\', end_reason = ?, closed_by_admin_id = ? '
      + 'WHERE id = ? AND end_time IS NULL'
    ).run(nowIso, end_reason, (ctx && ctx.admin_id) || null, session_id);
    if (upd.changes !== 1) {
      throw new Error('closeSession: race — session ' + session_id + ' update matched ' + upd.changes);
    }

    return { session_id, already_closed: false, end_reason, ...finalTick };
  }).immediate();
}

/*
 * chargeUser — non-session debit. Default mode='strict' (shop purchase
 * refuses on insufficient funds). Use mode='partial' for ops paths that
 * want to drain available credits then signal a shortfall to the caller.
 *
 * Returns: { credits_after, debt_after, credits_delta, debt_delta, shortfall }
 */
function chargeUser(db, { user_id, amount, event_type, description, ctx = {}, session_id = null, mode = 'strict', shift_id = null, payment_method = null }) {
  if (!['shop', 'manual_debit', 'debt_add'].includes(event_type)) {
    throw new RangeError('chargeUser: event_type ' + event_type + ' not allowed on debit path');
  }
  return db.transaction(() => _applyChargeLocked(db, {
    user_id, session_id, amount, event_type, mode,
    rate_per_hour: null, multiplier: null, tick_seconds: null,
    description, ctx, shift_id, payment_method,
  })).immediate();
}

/*
 * creditUser — credit balance. Behavior depends on event_type:
 *   'recharge'      — pay outstanding debt first, remainder → credits
 *   'debt_pay'      — debt -= min(amount, debt); excess dropped
 *   'manual_credit' — credits += amount only; debt untouched
 *
 * Returns: { credits_after, debt_after, credits_added, debt_paid }
 */
function creditUser(db, { user_id, amount, event_type, description, ctx = {}, shift_id = null, payment_method = null, payment_amount = null }) {
  if (!(amount > 0)) throw new RangeError('creditUser: amount must be > 0, got ' + amount);
  if (!['recharge', 'debt_pay', 'manual_credit'].includes(event_type)) {
    throw new RangeError('creditUser: event_type ' + event_type + ' not allowed on credit path');
  }

  return db.transaction(() => {
    const u = db.prepare('SELECT id, credits, debt FROM users WHERE id = ?').get(user_id);
    if (!u) throw new Error('creditUser: user ' + user_id + ' not found');
    const c_before = u.credits;
    const d_before = u.debt;

    let credits_delta = 0;
    let debt_delta = 0;
    if (event_type === 'recharge') {
      const paid = Math.min(amount, d_before);
      debt_delta = -paid;
      credits_delta = amount - paid;
    } else if (event_type === 'debt_pay') {
      debt_delta = -Math.min(amount, d_before);
    } else {
      credits_delta = amount;
    }

    const c_after = c_before + credits_delta;
    const d_after = d_before + debt_delta;

    const upd = db.prepare(
      'UPDATE users SET credits = ?, debt = ? '
      + 'WHERE id = ? AND credits = ? AND debt = ?'
    ).run(c_after, d_after, user_id, c_before, d_before);
    if (upd.changes !== 1) {
      throw new DriftDetectedError(
        'credit drift user=' + user_id + ' expected(c=' + c_before + ',d=' + d_before + ') changes=' + upd.changes
      );
    }

    _writeLedgerRow(db, {
      user_id, session_id: null, event_type,
      credits_delta, debt_delta,
      c_before, c_after, d_before, d_after,
      rate_per_hour: null, multiplier: null, tick_seconds: null,
      admin_id: ctx && ctx.admin_id,
      description, shift_id, payment_method, payment_amount,
    });

    return {
      credits_after: c_after,
      debt_after: d_after,
      credits_added: credits_delta,
      debt_paid: -debt_delta,
    };
  }).immediate();
}

/*
 * manualReconciliation — the ONLY helper allowed to apply arbitrary signed
 * deltas to BOTH credits AND debt in a single write. Reserved for operator-
 * resolved drift correction. Lands as event_type='reconciliation'.
 *
 * Both deltas may be 0, positive, or negative — but the resulting balance
 * must be ≥ 0 on each axis (schema CHECK would otherwise reject; we check
 * preemptively for a clearer error).
 */
function manualReconciliation(db, { user_id, credits_delta, debt_delta, reason, ctx = {} }) {
  if (typeof credits_delta !== 'number' || !Number.isFinite(credits_delta)) {
    throw new TypeError('manualReconciliation: credits_delta must be finite number');
  }
  if (typeof debt_delta !== 'number' || !Number.isFinite(debt_delta)) {
    throw new TypeError('manualReconciliation: debt_delta must be finite number');
  }
  if (!reason || typeof reason !== 'string') {
    throw new TypeError('manualReconciliation: reason required');
  }
  if (credits_delta === 0 && debt_delta === 0) {
    throw new RangeError('manualReconciliation: at least one delta must be non-zero');
  }

  return db.transaction(() => {
    const u = db.prepare('SELECT id, credits, debt FROM users WHERE id = ?').get(user_id);
    if (!u) throw new Error('manualReconciliation: user ' + user_id + ' not found');
    const c_before = u.credits;
    const d_before = u.debt;
    const c_after = c_before + credits_delta;
    const d_after = d_before + debt_delta;
    if (c_after < 0) throw new RangeError('manualReconciliation: resulting credits ' + c_after + ' < 0');
    if (d_after < 0) throw new RangeError('manualReconciliation: resulting debt ' + d_after + ' < 0');

    const upd = db.prepare(
      'UPDATE users SET credits = ?, debt = ? '
      + 'WHERE id = ? AND credits = ? AND debt = ?'
    ).run(c_after, d_after, user_id, c_before, d_before);
    if (upd.changes !== 1) {
      throw new DriftDetectedError('reconciliation drift user=' + user_id);
    }

    _writeLedgerRow(db, {
      user_id, session_id: null, event_type: 'reconciliation',
      credits_delta, debt_delta,
      c_before, c_after, d_before, d_after,
      rate_per_hour: null, multiplier: null, tick_seconds: null,
      admin_id: ctx && ctx.admin_id,
      description: 'reconciliation: ' + reason,
    });

    return { credits_after: c_after, debt_after: d_after };
  }).immediate();
}

/*
 * resumeSession — kiosk-recovery handshake. Called from server/index.js
 * client:resume socket handler. Atomically validates the kiosk's claim
 * to a recovering session and transitions state='recovering' → 'active'
 * with last_billed_at = `now` (skipping the un-billable
 * disconnect-to-reconnect gap per the freeze).
 *
 * Validation (in order):
 *   1. session exists by uuid
 *   2. session.end_time IS NULL and state !== 'closed'
 *   3. session.computer_name === payload.computer_name
 *      (defense against cross-PC replay; computer_name is kiosk-asserted
 *       but raises the bar significantly)
 *   4. session.user_id === payload.user_id
 *      (F14 fix per Phase 4 preflight Q1 — defends against kiosk-side
 *       uuid bleed across sessions)
 *   5. now - last_billed_at < billing_resume_max_age_seconds (default 600s)
 *
 * If session.state === 'recovering': atomic UPDATE to 'active'. changes()===1
 * required or → ResumeRejectedError('duplicate_client') (lost race to
 * another resume).
 *
 * If session.state === 'active': idempotent re-claim. Same-client retry
 * during a transient round-trip. Last-billed-at is NOT touched (ticker
 * has been billing legitimately while session was 'active'). The caller
 * (server/index.js) is responsible for checking the connectedClients
 * map to differentiate "same client retry" from "different client
 * duplicate" — billing.js doesn't know about sockets.
 *
 * Throws ResumeRejectedError with .reason set to one of:
 *   invalid_payload / session_not_found / state_closed /
 *   wrong_computer / wrong_user / recovery_max_age_exceeded /
 *   duplicate_client
 *
 * Returns: {
 *   session_id, user_id, username, computer_name,
 *   credits, debt, post_pay, locked_rate_per_hour,
 *   last_billed_at (iso, == now), start_time, was_recovering (bool)
 * }
 */
function resumeSession(db, { session_uuid, computer_name, user_id, ctx = {}, now = new Date() }) {
  if (!session_uuid || typeof session_uuid !== 'string') {
    throw new ResumeRejectedError('invalid_payload');
  }
  if (!computer_name || typeof computer_name !== 'string') {
    throw new ResumeRejectedError('invalid_payload');
  }
  if (!Number.isInteger(user_id)) {
    throw new ResumeRejectedError('invalid_payload');
  }

  return db.transaction(() => {
    const sess = db.prepare(
      'SELECT s.id, s.user_id, s.computer_name, s.state, s.end_time, '
      + 's.session_uuid, s.locked_rate_per_hour, s.last_billed_at, '
      + 's.unpaid_micros, s.start_time, '
      + 'u.username, u.credits, u.debt, u.post_pay '
      + 'FROM sessions s LEFT JOIN users u ON u.id = s.user_id '
      + 'WHERE s.session_uuid = ?'
    ).get(session_uuid);
    if (!sess) throw new ResumeRejectedError('session_not_found');
    if (sess.end_time !== null || sess.state === 'closed') {
      throw new ResumeRejectedError('state_closed');
    }
    if (sess.computer_name !== computer_name) {
      throw new ResumeRejectedError('wrong_computer', {
        expected_computer: sess.computer_name,
      });
    }
    if (sess.user_id !== user_id) {
      throw new ResumeRejectedError('wrong_user', {
        expected_user: sess.user_id,
      });
    }

    // Age check.
    const maxAgeRow = db.prepare(
      "SELECT value FROM settings WHERE key = 'billing_resume_max_age_seconds'"
    ).get();
    const maxAgeS = Number((maxAgeRow && maxAgeRow.value) || 600);
    const lastMs = parseDbTimestampMs(sess.last_billed_at);
    const ageS = (now.getTime() - lastMs) / 1000;
    if (ageS > maxAgeS) {
      throw new ResumeRejectedError('recovery_max_age_exceeded', {
        age_s: ageS, max_age_s: maxAgeS,
      });
    }

    const nowIso = isoNow(now);
    let wasRecovering = false;
    if (sess.state === 'recovering') {
      // Atomic transition. Only ONE concurrent resume can win — the
      // others see changes()===0 and get duplicate_client.
      const upd = db.prepare(
        "UPDATE sessions SET state='active', last_billed_at=? "
        + "WHERE id=? AND state='recovering'"
      ).run(nowIso, sess.id);
      if (upd.changes !== 1) {
        throw new ResumeRejectedError('duplicate_client');
      }
      wasRecovering = true;
    }
    // state === 'active': idempotent re-claim. Don't touch last_billed_at;
    // ticker has been billing normally. Caller checks connectedClients
    // map to enforce same-vs-different-client policy.

    return {
      session_id: sess.id,
      user_id: sess.user_id,
      username: sess.username,
      computer_name: sess.computer_name,
      credits: sess.credits,
      debt: sess.debt,
      post_pay: sess.post_pay ? 1 : 0,
      locked_rate_per_hour: sess.locked_rate_per_hour,
      last_billed_at: wasRecovering ? nowIso : sess.last_billed_at,
      start_time: sess.start_time,
      was_recovering: wasRecovering,
    };
  }).immediate();
}

module.exports = {
  openSession,
  closeSession,
  chargeUser,
  creditUser,
  manualReconciliation,
  billSessionUntilLocked,
  computeCurrentRate,
  isoNow,
  parseDbTimestampMs,
  resumeSession,
  DriftDetectedError,
  SeatBusyError,
  InsufficientFundsError,
  ResumeRejectedError,
  VALID_EVENT_TYPES,
  CLOSE_REASONS,
  RESUME_REJECT_REASONS,
};

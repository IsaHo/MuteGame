'use strict';

const VALID_PAYMENT_METHODS = ['cash', 'card', 'transfer'];
const VALID_STATUS_FILTERS  = ['open', 'closed'];
const MAX_CLOSE_NOTE        = 500;

// Parse close_breakdown from stored JSON string; mutates shift in-place.
function parseShift(shift) {
  if (!shift) return shift;
  if (typeof shift.close_breakdown === 'string') {
    try { shift.close_breakdown = JSON.parse(shift.close_breakdown); }
    catch (_) { shift.close_breakdown = null; }
  }
  return shift;
}

// Returns current open shift id, or null if no shift is open.
// Safe to call inside or outside a transaction.
function getOpenShiftId(db) {
  const row = db.prepare("SELECT id FROM shifts WHERE status = 'open'").get();
  return row ? row.id : null;
}

// Compute per-payment-method totals for a given shift.
// For recharge events: SUM(amount_credits - amount_debt) captures the FULL cash received.
// shop_orders uses status='completed' only — pending/cancelled excluded per design.
function computeShiftTotals(db, shiftId) {
  const q = (sql) => {
    const row = db.prepare(sql).get(shiftId);
    return row ? (row.v || 0) : 0;
  };

  const cash_in_charges   = q("SELECT COALESCE(SUM(COALESCE(payment_amount, amount_credits - amount_debt)), 0) AS v FROM credit_ledger WHERE shift_id = ? AND event_type = 'recharge' AND payment_method = 'cash'");
  const card_in_charges   = q("SELECT COALESCE(SUM(COALESCE(payment_amount, amount_credits - amount_debt)), 0) AS v FROM credit_ledger WHERE shift_id = ? AND event_type = 'recharge' AND payment_method = 'card'");
  const xfer_in_charges   = q("SELECT COALESCE(SUM(COALESCE(payment_amount, amount_credits - amount_debt)), 0) AS v FROM credit_ledger WHERE shift_id = ? AND event_type = 'recharge' AND payment_method = 'transfer'");

  const cash_in_debt_pay  = q("SELECT COALESCE(SUM(ABS(amount_debt)), 0) AS v FROM credit_ledger WHERE shift_id = ? AND event_type = 'debt_pay' AND payment_method = 'cash'");
  const card_in_debt_pay  = q("SELECT COALESCE(SUM(ABS(amount_debt)), 0) AS v FROM credit_ledger WHERE shift_id = ? AND event_type = 'debt_pay' AND payment_method = 'card'");
  const xfer_in_debt_pay  = q("SELECT COALESCE(SUM(ABS(amount_debt)), 0) AS v FROM credit_ledger WHERE shift_id = ? AND event_type = 'debt_pay' AND payment_method = 'transfer'");

  const cash_in_shop      = q("SELECT COALESCE(SUM(total), 0) AS v FROM shop_orders WHERE shift_id = ? AND payment_method = 'cash' AND status = 'completed'");
  const card_in_shop      = q("SELECT COALESCE(SUM(total), 0) AS v FROM shop_orders WHERE shift_id = ? AND payment_method = 'card' AND status = 'completed'");
  const xfer_in_shop      = q("SELECT COALESCE(SUM(total), 0) AS v FROM shop_orders WHERE shift_id = ? AND payment_method = 'transfer' AND status = 'completed'");
  const wallet_shop       = q("SELECT COALESCE(SUM(total), 0) AS v FROM shop_orders WHERE shift_id = ? AND payment_method = 'credits' AND status = 'completed'");

  const cash_out_expenses = q("SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE shift_id = ? AND payment_method = 'cash' AND is_void = 0");
  const card_out_expenses = q("SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE shift_id = ? AND payment_method = 'card' AND is_void = 0");
  const xfer_out_expenses = q("SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE shift_id = ? AND payment_method = 'transfer' AND is_void = 0");

  return {
    cash_in_charges, card_in_charges, xfer_in_charges,
    cash_in_debt_pay, card_in_debt_pay, xfer_in_debt_pay,
    cash_in_shop, card_in_shop, xfer_in_shop, wallet_shop,
    cash_out_expenses, card_out_expenses, xfer_out_expenses,
    total_cash_in: cash_in_charges + cash_in_debt_pay + cash_in_shop,
    total_card_in: card_in_charges + card_in_debt_pay + card_in_shop,
    total_xfer_in: xfer_in_charges + xfer_in_debt_pay + xfer_in_shop,
    total_cash_out: cash_out_expenses,
    gross_cash_in: cash_in_charges + cash_in_debt_pay + cash_in_shop,
  };
}

function openShift(db, { opening_cash, admin, auditFn }) {
  if (!Number.isInteger(opening_cash) || opening_cash < 0) {
    return { status: 400, body: { error: 'مبلغ اول شیفت باید عدد صحیح غیر منفی باشد', code: 'INVALID_OPENING_CASH' } };
  }

  let newShift;
  try {
    db.transaction(() => {
      const r = db.prepare(
        "INSERT INTO shifts (status, opened_by_id, opened_by_name, opening_cash) VALUES ('open', ?, ?, ?)"
      ).run(admin.id, admin.display_name || admin.username, opening_cash);

      newShift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(r.lastInsertRowid);
      auditFn('shift.open', 'shift', newShift.id,
              { opening_cash, opened_by: admin.username });
    }).immediate();
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { status: 409, body: { error: 'شیفت باز دیگری وجود دارد', code: 'SHIFT_ALREADY_OPEN' } };
    }
    throw e;
  }

  return { status: 201, body: { shift: parseShift(newShift) } };
}

function getOpenShift(db) {
  const shift = db.prepare("SELECT * FROM shifts WHERE status = 'open'").get();
  if (!shift) return { status: 404, body: { error: 'شیفتی باز نیست', code: 'NO_OPEN_SHIFT' } };
  return { status: 200, body: { shift: parseShift(shift) } };
}

function listShifts(db, { status, limit = 20 } = {}) {
  if (status && !VALID_STATUS_FILTERS.includes(status)) {
    return { status: 400, body: { error: 'وضعیت باید open یا closed باشد', code: 'INVALID_STATUS' } };
  }
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 20));
  const where = status ? "WHERE status = ?" : "";
  const args  = status ? [status, safeLimit] : [safeLimit];
  const shifts = db.prepare(`SELECT * FROM shifts ${where} ORDER BY id DESC LIMIT ?`).all(...args);
  return { status: 200, body: { shifts: shifts.map(parseShift) } };
}

function getShift(db, id) {
  if (!Number.isInteger(id) || id <= 0) {
    return { status: 400, body: { error: 'شناسه شیفت نامعتبر است' } };
  }
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
  if (!shift) return { status: 404, body: { error: 'شیفت یافت نشد' } };
  return { status: 200, body: { shift: parseShift(shift) } };
}

function previewShift(db, id) {
  if (!Number.isInteger(id) || id <= 0) {
    return { status: 400, body: { error: 'شناسه شیفت نامعتبر است' } };
  }
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
  if (!shift) return { status: 404, body: { error: 'شیفت یافت نشد' } };

  const totals = computeShiftTotals(db, id);
  const expected_cash = Math.round(
    shift.opening_cash
    + totals.cash_in_charges
    + totals.cash_in_debt_pay
    + totals.cash_in_shop
    - totals.cash_out_expenses
  );

  return {
    status: 200,
    body: { shift: parseShift(shift), totals, expected_cash },
  };
}

function closeShift(db, { shiftId, counted_cash, close_note, admin, auditFn }) {
  if (!Number.isInteger(counted_cash) || counted_cash < 0) {
    return { status: 400, body: { error: 'موجودی شمارش‌شده باید عدد صحیح غیر منفی باشد', code: 'INVALID_COUNTED_CASH' } };
  }
  if (!Number.isInteger(shiftId) || shiftId <= 0) {
    return { status: 400, body: { error: 'شناسه شیفت نامعتبر است', code: 'INVALID_SHIFT_ID' } };
  }
  if (close_note != null) {
    if (String(close_note).length > MAX_CLOSE_NOTE) {
      return { status: 400, body: { error: `یادداشت بستن حداکثر ${MAX_CLOSE_NOTE} کاراکتر`, code: 'CLOSE_NOTE_TOO_LONG' } };
    }
  }

  let result;
  db.transaction(() => {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
    if (!shift) {
      result = { status: 404, body: { error: 'شیفت یافت نشد' } };
      return;
    }

    if (shift.status === 'closed') {
      result = { status: 200, body: { shift: parseShift(shift), already_closed: true } };
      return;
    }

    const totals = computeShiftTotals(db, shiftId);
    const expected_cash = Math.round(
      shift.opening_cash
      + totals.cash_in_charges
      + totals.cash_in_debt_pay
      + totals.cash_in_shop
      - totals.cash_out_expenses
    );
    const variance = counted_cash - expected_cash;
    const close_breakdown_json = JSON.stringify(totals);

    const upd = db.prepare(
      "UPDATE shifts SET status = 'closed', closed_at = CURRENT_TIMESTAMP, " +
      "closed_by_id = ?, closed_by_name = ?, counted_cash = ?, expected_cash = ?, variance = ?, " +
      "close_note = ?, close_breakdown = ? " +
      "WHERE id = ? AND status = 'open'"
    ).run(
      admin.id, admin.display_name || admin.username,
      counted_cash, expected_cash, variance,
      close_note || null, close_breakdown_json, shiftId
    );

    if (upd.changes === 0) {
      // Concurrent close — idempotent
      const closed = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
      result = { status: 200, body: { shift: parseShift(closed), already_closed: true } };
      return;
    }

    auditFn('shift.close', 'shift', shiftId,
            { counted_cash, expected_cash, variance, close_note: close_note || null });

    const closed = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
    result = { status: 200, body: { shift: parseShift(closed) } };
  }).immediate();

  return result;
}

module.exports = {
  getOpenShiftId,
  openShift, getOpenShift, listShifts, getShift, previewShift, closeShift,
};

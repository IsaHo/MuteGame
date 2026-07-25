'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { applyBillingSchemaV2, applyBillingMigrationPhase3, applyExpensesSchema, applyShiftSchema } = require('../database');
const billing = require('../billing');
const svc = require('../shift-service');

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  // Minimal tables needed for billing + shift tests
  db.exec(`
    CREATE TABLE admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'manager',
      permissions TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      display_name TEXT DEFAULT ''
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL DEFAULT '',
      credits REAL NOT NULL DEFAULT 0 CHECK (credits >= 0),
      total_minutes INTEGER NOT NULL DEFAULT 0,
      total_spent REAL NOT NULL DEFAULT 0,
      debt REAL NOT NULL DEFAULT 0 CHECK (debt >= 0),
      debt_since DATETIME,
      is_active INTEGER DEFAULT 1,
      discount_percent REAL DEFAULT 0,
      limit_minutes INTEGER DEFAULT 0,
      allowed_seats INTEGER DEFAULT 1,
      post_pay INTEGER DEFAULT 0,
      limit_time INTEGER DEFAULT 0
    );
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      computer_name TEXT,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      end_reason TEXT,
      duration INTEGER DEFAULT 0,
      session_uuid TEXT,
      seat_slot INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'closed',
      last_billed_at DATETIME,
      unpaid_micros INTEGER NOT NULL DEFAULT 0,
      locked_rate_per_hour REAL,
      closed_by_admin_id INTEGER
    );
    CREATE UNIQUE INDEX idx_one_open_session_per_seat
      ON sessions (computer_name, seat_slot) WHERE end_time IS NULL;
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT INTO settings (key, value) VALUES
      ('billing_engine_version', '2'),
      ('billing_recovery_grace_seconds', '120'),
      ('billing_kiosk_lockout_level', 'medium'),
      ('billing_clock_warp_tolerance_s', '60'),
      ('billing_resume_max_age_seconds', '600');
    CREATE TABLE credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      admin_username TEXT,
      admin_ip TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      details TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TRIGGER IF NOT EXISTS audit_log_no_update
    BEFORE UPDATE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
    BEFORE DELETE ON audit_log
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    CREATE TABLE shop_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      computer_name TEXT,
      items TEXT NOT NULL DEFAULT '[]',
      total REAL NOT NULL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Apply billing schema (credit_ledger) and expenses
  applyBillingSchemaV2(db);
  applyBillingMigrationPhase3(db);
  applyExpensesSchema(db);
  applyShiftSchema(db);

  return db;
}

function makeAuditFn(db) {
  return (action, entity, entityId, details) => {
    db.prepare(
      'INSERT INTO audit_log (admin_id, admin_username, admin_ip, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(1, 'test', '127.0.0.1', action, entity || '', entityId ? String(entityId) : '', JSON.stringify(details || {}));
  };
}

const ADMIN = { id: 1, username: 'test', display_name: 'Test Admin' };

function addUser(db, { credits = 0, debt = 0 } = {}) {
  const r = db.prepare('INSERT INTO users (username, credits, debt) VALUES (?, ?, ?)').run(
    'u' + Date.now() + Math.random(), credits, debt
  );
  return r.lastInsertRowid;
}

// ─── Schema invariants ────────────────────────────────────────────────────

describe('shifts schema', () => {
  test('shifts table created', () => {
    const db = makeDb();
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shifts'").get();
    assert.ok(row, 'shifts table exists');
  });

  test('credit_ledger has shift_id and payment_method columns', () => {
    const db = makeDb();
    const cols = db.prepare('PRAGMA table_info(credit_ledger)').all().map(c => c.name);
    assert.ok(cols.includes('shift_id'));
    assert.ok(cols.includes('payment_method'));
  });

  test('shop_orders has shift_id column', () => {
    const db = makeDb();
    const cols = db.prepare('PRAGMA table_info(shop_orders)').all().map(c => c.name);
    assert.ok(cols.includes('shift_id'));
  });

  test('expenses has shift_id column', () => {
    const db = makeDb();
    const cols = db.prepare('PRAGMA table_info(expenses)').all().map(c => c.name);
    assert.ok(cols.includes('shift_id'));
  });

  test('partial unique index prevents two open shifts', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    const r = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SHIFT_ALREADY_OPEN');
  });

  test('can open shift after prior is closed', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const r1 = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    svc.closeShift(db, { shiftId: r1.body.shift.id, counted_cash: 0, admin: ADMIN, auditFn });
    const r2 = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    assert.equal(r2.status, 201);
  });
});

// ─── openShift ───────────────────────────────────────────────────────────

describe('openShift', () => {
  test('returns 400 for negative opening_cash', () => {
    const db = makeDb();
    const r = svc.openShift(db, { opening_cash: -1, admin: ADMIN, auditFn: makeAuditFn(db) });
    assert.equal(r.status, 400);
  });

  test('returns 400 for non-integer opening_cash', () => {
    const db = makeDb();
    const r = svc.openShift(db, { opening_cash: 1.5, admin: ADMIN, auditFn: makeAuditFn(db) });
    assert.equal(r.status, 400);
  });

  test('creates shift with correct fields', () => {
    const db = makeDb();
    const r = svc.openShift(db, { opening_cash: 5000, admin: ADMIN, auditFn: makeAuditFn(db) });
    assert.equal(r.status, 201);
    assert.equal(r.body.shift.status, 'open');
    assert.equal(r.body.shift.opening_cash, 5000);
    assert.equal(r.body.shift.opened_by_id, ADMIN.id);
  });

  test('audit row written inside transaction', () => {
    const db = makeDb();
    const r = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn: makeAuditFn(db) });
    const audRow = db.prepare("SELECT * FROM audit_log WHERE action = 'shift.open'").get();
    assert.ok(audRow);
    assert.equal(audRow.entity_id, String(r.body.shift.id));
  });
});

// ─── getOpenShiftId ──────────────────────────────────────────────────────

describe('getOpenShiftId', () => {
  test('returns null when no shift open', () => {
    const db = makeDb();
    assert.equal(svc.getOpenShiftId(db), null);
  });

  test('returns shift id when shift is open', () => {
    const db = makeDb();
    const r = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn: makeAuditFn(db) });
    assert.equal(svc.getOpenShiftId(db), r.body.shift.id);
  });
});

// ─── Soft enforcement (no shift) ─────────────────────────────────────────

describe('soft enforcement — no open shift', () => {
  test('creditUser (recharge) succeeds with shift_id=NULL when no shift open', () => {
    const db = makeDb();
    const userId = addUser(db);
    // No shift open — getOpenShiftId returns null; billing should still work
    const result = billing.creditUser(db, {
      user_id: userId, amount: 10000, event_type: 'recharge',
      description: 'test', shift_id: null, payment_method: 'cash',
    });
    assert.equal(result.credits_after, 10000);
    const row = db.prepare('SELECT shift_id FROM credit_ledger WHERE user_id = ?').get(userId);
    assert.equal(row.shift_id, null);
  });

  test('chargeUser (debt_add) succeeds with shift_id=NULL when no shift open', () => {
    const db = makeDb();
    const userId = addUser(db, { credits: 0 });
    const result = billing.chargeUser(db, {
      user_id: userId, amount: 5000, event_type: 'debt_add',
      description: 'test', shift_id: null,
    });
    assert.equal(result.d_after, 5000);
  });
});

// ─── Shift attachment ────────────────────────────────────────────────────

describe('shift attachment in billing', () => {
  test('creditUser stores shift_id and payment_method in ledger', () => {
    const db = makeDb();
    const userId = addUser(db);
    const shiftR = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn: makeAuditFn(db) });
    const shiftId = shiftR.body.shift.id;

    billing.creditUser(db, {
      user_id: userId, amount: 20000, event_type: 'recharge',
      description: 'cash top-up', shift_id: shiftId, payment_method: 'cash',
    });

    const row = db.prepare('SELECT shift_id, payment_method FROM credit_ledger WHERE user_id = ?').get(userId);
    assert.equal(row.shift_id, shiftId);
    assert.equal(row.payment_method, 'cash');
  });

  test('recharge bonus is not counted as cash received', () => {
    const db = makeDb();
    const userId = addUser(db);
    const shiftId = svc.openShift(
      db, { opening_cash: 0, admin: ADMIN, auditFn: makeAuditFn(db) }
    ).body.shift.id;

    billing.creditUser(db, {
      user_id: userId,
      amount: 55000,
      payment_amount: 50000,
      event_type: 'recharge',
      description: '50000 paid + 5000 bonus',
      shift_id: shiftId,
      payment_method: 'cash',
    });

    const preview = svc.previewShift(db, shiftId);
    assert.equal(preview.body.totals.cash_in_charges, 50000);
    assert.equal(preview.body.expected_cash, 50000);
  });
});

// ─── previewShift / expected cash formula ────────────────────────────────

describe('previewShift expected cash formula', () => {
  test('opening=1000 + cash recharge 500 + cash shop 300 - cash expense 200 → expected=1600', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const userId = addUser(db);

    const shiftR = svc.openShift(db, { opening_cash: 1000, admin: ADMIN, auditFn });
    const shiftId = shiftR.body.shift.id;

    // Cash recharge 500 (user has no debt)
    billing.creditUser(db, {
      user_id: userId, amount: 500, event_type: 'recharge',
      description: 'recharge', shift_id: shiftId, payment_method: 'cash',
    });

    // Cash shop order 300
    db.prepare("INSERT INTO shop_orders (user_id, total, payment_method, status, shift_id) VALUES (?, 300, 'cash', 'completed', ?)")
      .run(userId, shiftId);

    // Cash expense 200
    db.prepare("INSERT INTO expenses (date, category, description, amount, payment_method, admin_id, admin_username, is_void, shift_id) VALUES ('2026-01-01', 'test', 'test', 200, 'cash', 1, 'admin', 0, ?)")
      .run(shiftId);

    const prev = svc.previewShift(db, shiftId);
    assert.equal(prev.status, 200);
    assert.equal(prev.body.expected_cash, 1600);
  });

  test('pending shop orders are excluded from totals', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const userId = addUser(db);
    const shiftR = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    const shiftId = shiftR.body.shift.id;

    // Pending order — must NOT count
    db.prepare("INSERT INTO shop_orders (user_id, total, payment_method, status, shift_id) VALUES (?, 1000, 'cash', 'pending', ?)")
      .run(userId, shiftId);

    const prev = svc.previewShift(db, shiftId);
    assert.equal(prev.body.totals.cash_in_shop, 0);
  });

  test('cancelled shop orders are excluded', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const userId = addUser(db);
    const shiftR = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    const shiftId = shiftR.body.shift.id;

    db.prepare("INSERT INTO shop_orders (user_id, total, payment_method, status, shift_id) VALUES (?, 999, 'cash', 'cancelled', ?)")
      .run(userId, shiftId);

    const prev = svc.previewShift(db, shiftId);
    assert.equal(prev.body.totals.cash_in_shop, 0);
  });

  test('voided expenses are excluded', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const shiftR = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    const shiftId = shiftR.body.shift.id;

    db.prepare("INSERT INTO expenses (date, category, description, amount, payment_method, admin_id, admin_username, is_void, shift_id) VALUES ('2026-01-01', 'test', 'test', 500, 'cash', 1, 'admin', 1, ?)")
      .run(shiftId);

    const prev = svc.previewShift(db, shiftId);
    assert.equal(prev.body.totals.cash_out_expenses, 0);
  });

  test('card and transfer totals tracked separately', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const userId = addUser(db);
    const shiftR = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    const shiftId = shiftR.body.shift.id;

    billing.creditUser(db, {
      user_id: userId, amount: 300, event_type: 'recharge',
      description: 'card top-up', shift_id: shiftId, payment_method: 'card',
    });
    billing.creditUser(db, {
      user_id: userId, amount: 200, event_type: 'recharge',
      description: 'transfer top-up', shift_id: shiftId, payment_method: 'transfer',
    });

    const prev = svc.previewShift(db, shiftId);
    assert.equal(prev.body.totals.card_in_charges, 300);
    assert.equal(prev.body.totals.xfer_in_charges, 200);
    assert.equal(prev.body.totals.cash_in_charges, 0);
  });
});

// ─── closeShift ──────────────────────────────────────────────────────────

describe('closeShift', () => {
  test('persists expected_cash, counted_cash, variance', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const userId = addUser(db);
    const shiftR = svc.openShift(db, { opening_cash: 1000, admin: ADMIN, auditFn });
    const shiftId = shiftR.body.shift.id;

    billing.creditUser(db, {
      user_id: userId, amount: 500, event_type: 'recharge',
      description: 'cash', shift_id: shiftId, payment_method: 'cash',
    });

    const r = svc.closeShift(db, {
      shiftId, counted_cash: 1400, admin: ADMIN, auditFn,
    });
    assert.equal(r.status, 200);
    const closed = r.body.shift;
    assert.equal(closed.status, 'closed');
    assert.equal(closed.expected_cash, 1500);
    assert.equal(closed.counted_cash, 1400);
    assert.equal(closed.variance, -100);
  });

  test('idempotent close — second call returns already_closed=true', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const shiftR = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    const shiftId = shiftR.body.shift.id;
    svc.closeShift(db, { shiftId, counted_cash: 0, admin: ADMIN, auditFn });
    const r2 = svc.closeShift(db, { shiftId, counted_cash: 99, admin: ADMIN, auditFn });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.already_closed, true);
    // Ensure first close values were not overwritten
    assert.equal(r2.body.shift.counted_cash, 0);
  });

  test('returns 400 for negative counted_cash', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const shiftR = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    const r = svc.closeShift(db, { shiftId: shiftR.body.shift.id, counted_cash: -1, admin: ADMIN, auditFn });
    assert.equal(r.status, 400);
  });

  test('returns 404 for unknown shiftId', () => {
    const db = makeDb();
    const r = svc.closeShift(db, { shiftId: 9999, counted_cash: 0, admin: ADMIN, auditFn: makeAuditFn(db) });
    assert.equal(r.status, 404);
  });

  test('audit row written on close', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const shiftR = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    svc.closeShift(db, { shiftId: shiftR.body.shift.id, counted_cash: 0, admin: ADMIN, auditFn });
    const audRow = db.prepare("SELECT * FROM audit_log WHERE action = 'shift.close'").get();
    assert.ok(audRow);
  });

  test('close_breakdown is persisted as parsed object on closed shift', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const shiftR = svc.openShift(db, { opening_cash: 500, admin: ADMIN, auditFn });
    const shiftId = shiftR.body.shift.id;
    const r = svc.closeShift(db, { shiftId, counted_cash: 500, admin: ADMIN, auditFn });
    assert.equal(r.status, 200);
    assert.ok(r.body.shift.close_breakdown, 'close_breakdown must be present');
    assert.equal(typeof r.body.shift.close_breakdown, 'object', 'close_breakdown must be parsed object');
    assert.ok('total_cash_in' in r.body.shift.close_breakdown, 'breakdown must have total_cash_in');
  });

  test('close_note > 500 chars returns 400', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const shiftR = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn });
    const r = svc.closeShift(db, {
      shiftId: shiftR.body.shift.id,
      counted_cash: 0,
      close_note: 'x'.repeat(501),
      admin: ADMIN,
      auditFn,
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'CLOSE_NOTE_TOO_LONG');
  });
});

// ─── Validation ──────────────────────────────────────────────────────────

describe('input validation', () => {
  test('listShifts rejects unknown status filter', () => {
    const db = makeDb();
    const r = svc.listShifts(db, { status: 'archived' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'INVALID_STATUS');
  });

  test('getShift rejects non-integer id', () => {
    const db = makeDb();
    const r = svc.getShift(db, NaN);
    assert.equal(r.status, 400);
  });

  test('previewShift rejects zero id', () => {
    const db = makeDb();
    const r = svc.previewShift(db, 0);
    assert.equal(r.status, 400);
  });

  test('closeShift rejects non-integer shiftId', () => {
    const db = makeDb();
    const r = svc.closeShift(db, { shiftId: 1.5, counted_cash: 0, admin: ADMIN, auditFn: makeAuditFn(db) });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'INVALID_SHIFT_ID');
  });
});

// ─── Shop order shift assignment ─────────────────────────────────────────

describe('shop order shift assignment', () => {
  test('order created pending has null shift_id; approve sets it to then-current open shift', () => {
    const db = makeDb();
    const auditFn = makeAuditFn(db);
    const userId = addUser(db, { credits: 5000 });

    const shiftA = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn }).body.shift;

    // Create pending order with no shift_id (route behaviour)
    const orderId = db.prepare(
      "INSERT INTO shop_orders (user_id, total, payment_method, status) VALUES (?, 500, 'cash', 'pending')"
    ).run(userId).lastInsertRowid;

    const pendingOrder = db.prepare('SELECT shift_id FROM shop_orders WHERE id = ?').get(orderId);
    assert.equal(pendingOrder.shift_id, null, 'pending order must have null shift_id');

    // Close shift A, open shift B
    svc.closeShift(db, { shiftId: shiftA.id, counted_cash: 0, admin: ADMIN, auditFn });
    const shiftB = svc.openShift(db, { opening_cash: 0, admin: ADMIN, auditFn }).body.shift;

    // Simulate approve (what the route does inside its transaction)
    const approveShiftId = svc.getOpenShiftId(db);
    db.transaction(() => {
      db.prepare('UPDATE shop_orders SET status = ?, shift_id = ? WHERE id = ?')
        .run('completed', approveShiftId, orderId);
    })();

    const completed = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(orderId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.shift_id, shiftB.id, 'order must belong to shift B, not shift A');
    assert.notEqual(completed.shift_id, shiftA.id);
  });
});

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const Database = require('better-sqlite3');

const { applyExpensesSchema } = require('../database');
const {
    createExpense, updateExpense, voidExpense,
    importExpenses, getExpenses,
} = require('../expense-service');

const ADMIN = { id: 1, username: 'test_admin' };

function createTestDb() {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE audit_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id     INTEGER,
            admin_username TEXT,
            admin_ip     TEXT,
            action       TEXT NOT NULL,
            entity       TEXT,
            entity_id    TEXT,
            details      TEXT DEFAULT '',
            created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    applyExpensesSchema(db);
    return db;
}

function makeAuditFn(db) {
    return (action, entity, entityId, details) => {
        db.prepare(
            `INSERT INTO audit_log (admin_id, admin_username, admin_ip, action, entity, entity_id, details)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(ADMIN.id, ADMIN.username, '127.0.0.1',
              action, entity || '', entityId ? String(entityId) : '',
              JSON.stringify(details || {}));
    };
}

// T1
test('create expense appears in GET list with integer amount', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);

    const r = createExpense(db, {
        date: '2026-07-25', category: 'اجاره', desc: 'اجاره ماه تیر',
        amount: 500000, payment_method: 'cash',
    }, ADMIN, af);

    assert.equal(r.status, 201);
    assert.ok(r.body.expense.id > 0);
    assert.equal(typeof r.body.expense.amount, 'number');
    assert.equal(r.body.expense.amount, 500000);
    assert.equal(r.body.expense.desc, 'اجاره ماه تیر');

    const list = getExpenses(db, { dateFrom: '2026-07-25', dateTo: '2026-07-25' });
    assert.equal(list.expenses.length, 1);
    assert.equal(list.total, 500000);
});

// T2
test('duplicate idempotency_key returns 200 with duplicate:true, no new row', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);

    const body = { date: '2026-07-25', amount: 100000, idempotency_key: 'uuid-001' };
    const r1 = createExpense(db, body, ADMIN, af);
    assert.equal(r1.status, 201);

    const r2 = createExpense(db, body, ADMIN, af);
    assert.equal(r2.status, 200);
    assert.equal(r2.body.duplicate, true);
    assert.equal(r2.body.expense.id, r1.body.expense.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c, 1);
});

// T3
test('void expense sets is_void=1 and writes audit row with action=expense.void', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);

    const c  = createExpense(db, { date: '2026-07-25', amount: 50000 }, ADMIN, af);
    const id = c.body.expense.id;

    const r = voidExpense(db, id, 'اشتباه وارد شد', ADMIN, af);
    assert.equal(r.status, 200);
    assert.ok(r.body.ok);

    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    assert.equal(row.is_void, 1);
    assert.equal(row.void_reason, 'اشتباه وارد شد');

    const aRow = db.prepare("SELECT * FROM audit_log WHERE action = 'expense.void'").get();
    assert.ok(aRow, 'audit row must exist');
});

// T4
test('PUT on voided expense returns 409', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);

    const c  = createExpense(db, { date: '2026-07-25', amount: 50000 }, ADMIN, af);
    const id = c.body.expense.id;
    voidExpense(db, id, 'علت', ADMIN, af);

    const r = updateExpense(db, id, { date: '2026-07-25', amount: 60000 }, ADMIN, af);
    assert.equal(r.status, 409);
});

// T5
test('GET with date_from/date_to filter returns only matching rows and correct total', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);

    createExpense(db, { date: '2026-07-20', amount: 10000 }, ADMIN, af);
    createExpense(db, { date: '2026-07-25', amount: 20000 }, ADMIN, af);
    createExpense(db, { date: '2026-07-26', amount: 30000 }, ADMIN, af);

    const r = getExpenses(db, { dateFrom: '2026-07-24', dateTo: '2026-07-25' });
    assert.equal(r.expenses.length, 1);
    assert.equal(r.total, 20000);
});

// T6
test('import 3 QSettings expenses sets migrated=1 with correct idempotency_key', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);

    const items = [
        { date: '2026-07-10', amount: 10000, idempotency_key: 'local_1720000000001', desc: 'هزینه ۱' },
        { date: '2026-07-11', amount: 20000, idempotency_key: 'local_1720000000002', desc: 'هزینه ۲' },
        { date: '2026-07-12', amount: 30000, idempotency_key: 'local_1720000000003', desc: 'هزینه ۳' },
    ];
    const r = importExpenses(db, items, ADMIN, af);
    assert.equal(r.body.imported, 3);
    assert.equal(r.body.skipped, 0);

    const rows = db.prepare('SELECT * FROM expenses ORDER BY id').all();
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.migrated === 1));
    assert.deepEqual(
        rows.map(row => row.idempotency_key),
        ['local_1720000000001', 'local_1720000000002', 'local_1720000000003'],
    );
});

// T7
test('re-import same 3 → skipped=3, imported=0, no duplicates', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);

    const items = [
        { date: '2026-07-10', amount: 10000, idempotency_key: 'local_1720000000001' },
        { date: '2026-07-11', amount: 20000, idempotency_key: 'local_1720000000002' },
        { date: '2026-07-12', amount: 30000, idempotency_key: 'local_1720000000003' },
    ];

    importExpenses(db, items, ADMIN, af);
    const r = importExpenses(db, items, ADMIN, af);

    assert.equal(r.body.imported, 0);
    assert.equal(r.body.skipped, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c, 3);
});

// T8
test('invalid amounts and dates are rejected with 400', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);

    const base = { date: '2026-07-25' };
    assert.equal(createExpense(db, { ...base, amount: 0 },      ADMIN, af).status, 400, 'zero');
    assert.equal(createExpense(db, { ...base, amount: -100 },   ADMIN, af).status, 400, 'negative');
    assert.equal(createExpense(db, { ...base, amount: 10.5 },   ADMIN, af).status, 400, 'float');
    assert.equal(createExpense(db, { ...base, amount: 'abc' },  ADMIN, af).status, 400, 'string');
    assert.equal(createExpense(db, { date: 'not-a-date', amount: 1000 }, ADMIN, af).status, 400, 'bad date');
    assert.equal(createExpense(db, { date: '26-07-25',   amount: 1000 }, ADMIN, af).status, 400, 'short year');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c, 0, 'nothing inserted');
});

// T10
test('impossible date (2026-02-31) rejected with 400, nothing inserted', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);
    const r = createExpense(db, { date: '2026-02-31', amount: 1000 }, ADMIN, af);
    assert.equal(r.status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c, 0);
});

// T11
test('import batch with one invalid date causes 400 and inserts nothing (atomicity)', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);
    const items = [
        { date: '2026-07-10', amount: 10000, idempotency_key: 'local_a1' },
        { date: '2026-02-31', amount: 20000, idempotency_key: 'local_a2' },
    ];
    const r = importExpenses(db, items, ADMIN, af);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('ردیف'), 'error must include item index');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c, 0,
        'no rows must be inserted when batch is invalid');
});

// T12
test('import: imported + skipped always equals input length', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);
    const first3 = [
        { date: '2026-07-10', amount: 10000, idempotency_key: 'local_b1' },
        { date: '2026-07-11', amount: 20000, idempotency_key: 'local_b2' },
        { date: '2026-07-12', amount: 30000, idempotency_key: 'local_b3' },
    ];
    importExpenses(db, first3, ADMIN, af);

    const batch4 = [...first3, { date: '2026-07-13', amount: 40000, idempotency_key: 'local_b4' }];
    const r = importExpenses(db, batch4, ADMIN, af);
    assert.equal(r.status, 200);
    assert.equal(r.body.imported + r.body.skipped, batch4.length,
        'imported + skipped must equal input length');
    assert.equal(r.body.imported, 1);
    assert.equal(r.body.skipped, 3);
});

// T13
test('import: explicitly invalid payment_method rejected with 400, omitted defaults to cash', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);

    const bad = importExpenses(db, [
        { date: '2026-07-25', amount: 10000, idempotency_key: 'pm-bad-1', payment_method: 'bitcoin' },
    ], ADMIN, af);
    assert.equal(bad.status, 400, 'invalid payment_method must be rejected');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c, 0);

    const ok = importExpenses(db, [
        { date: '2026-07-25', amount: 10000, idempotency_key: 'pm-ok-1' },
    ], ADMIN, af);
    assert.equal(ok.status, 200, 'omitted payment_method must be accepted');
    const row = db.prepare('SELECT payment_method FROM expenses WHERE idempotency_key = ?').get('pm-ok-1');
    assert.equal(row.payment_method, 'cash', 'omitted payment_method defaults to cash');
});

// T14
test('createExpense and updateExpense persist trimmed category', () => {
    const db = createTestDb();
    const af = makeAuditFn(db);

    const c = createExpense(db, {
        date: '2026-07-25', amount: 10000, category: '  اجاره  ',
    }, ADMIN, af);
    assert.equal(c.status, 201);
    assert.equal(c.body.expense.category, 'اجاره', 'createExpense must trim category');

    const u = updateExpense(db, c.body.expense.id, {
        date: '2026-07-25', amount: 20000, category: '  برق  ',
    }, ADMIN, af);
    assert.equal(u.status, 200);
    assert.equal(u.body.expense.category, 'برق', 'updateExpense must trim category');
});

// T9
test('audit atomicity: audit failure rolls back the expense insert', () => {
    const db = createTestDb();
    const throwingAuditFn = () => { throw new Error('simulated audit failure'); };

    assert.throws(() => {
        createExpense(db, { date: '2026-07-25', amount: 50000 }, ADMIN, throwingAuditFn);
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM expenses').get().c, 0,
        'no expense row must survive an audit failure');
});

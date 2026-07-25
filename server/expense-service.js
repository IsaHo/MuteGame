'use strict';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_PAYMENT_METHODS = ['cash', 'card', 'transfer'];
const MAX_IMPORT_BATCH = 500;

// Round-trip check: catches overflow dates like 2026-02-31 that ISO string
// parsing may silently accept in some runtimes.
function isValidGregorianDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// Returns null on valid, or Persian error string on invalid.
function validateExpense(body) {
    if (!body.date || !ISO_DATE_RE.test(body.date)) return 'تاریخ باید به فرمت YYYY-MM-DD باشد';
    if (!isValidGregorianDate(body.date)) return 'تاریخ نامعتبر است';

    const amt = Number(body.amount);
    if (!Number.isInteger(amt) || amt <= 0 || !Number.isSafeInteger(amt))
        return 'مبلغ باید عدد صحیح مثبت باشد';

    if (body.category != null) {
        const cat = String(body.category).trim();
        if (cat.length < 1 || cat.length > 50) return 'دسته‌بندی باید ۱ تا ۵۰ کاراکتر باشد';
    }

    const desc = body.desc !== undefined ? body.desc : (body.description || '');
    if (String(desc).length > 500) return 'توضیحات حداکثر ۵۰۰ کاراکتر';

    if (body.payment_method !== undefined && !VALID_PAYMENT_METHODS.includes(body.payment_method))
        return 'روش پرداخت باید یکی از: cash، card، transfer باشد';

    return null;
}

const SELECT_COLS = `id, date, category, description AS desc, amount, payment_method,
    admin_id, admin_username, is_void, void_reason, created_at, updated_at`;

function getExpenses(db, { dateFrom, dateTo, category, includeVoid } = {}) {
    const today = new Date().toISOString().split('T')[0];
    const from = dateFrom || today;
    const to   = dateTo   || today;

    const where = ['date >= ?', 'date <= ?'];
    const args  = [from, to];
    if (!includeVoid) where.push('is_void = 0');
    if (category) { where.push('category = ?'); args.push(category); }

    const rows = db.prepare(
        `SELECT ${SELECT_COLS} FROM expenses WHERE ${where.join(' AND ')} ORDER BY date DESC, id DESC`
    ).all(...args);

    return { expenses: rows, total: rows.reduce((s, r) => s + r.amount, 0) };
}

// getShiftIdFn is optional; when provided it is called INSIDE the transaction so
// the shift lookup and the INSERT are atomic. Pass null to skip shift attachment.
// Injecting the function keeps this module free of a shift-service dependency and
// makes the behaviour directly testable.
function createExpense(db, body, admin, auditFn, getShiftIdFn = null) {
    const err = validateExpense(body);
    if (err) return { status: 400, body: { error: err } };

    const desc            = typeof body.desc === 'string' ? body.desc : (body.description || '');
    const category        = body.category != null ? String(body.category).trim() : 'سایر';
    const payment_method  = body.payment_method || 'cash';
    const key = body.idempotency_key != null ? String(body.idempotency_key).trim() : null;
    if (key !== null) {
        if (key.length < 1 || key.length > 200)
            return { status: 400, body: { error: 'کلید idempotency باید ۱ تا ۲۰۰ کاراکتر باشد' } };
        const existing = db.prepare(`SELECT ${SELECT_COLS} FROM expenses WHERE idempotency_key = ?`).get(key);
        if (existing) return { status: 200, body: { expense: existing, duplicate: true } };
    }

    let newRow;
    db.transaction(() => {
        const shiftId = getShiftIdFn ? getShiftIdFn(db) : null;
        const r = db.prepare(
            `INSERT INTO expenses (date, category, description, amount, payment_method,
                                   admin_id, admin_username, idempotency_key, shift_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(body.date, category, desc, Number(body.amount), payment_method,
              admin.id, admin.username, key, shiftId || null);

        newRow = db.prepare(`SELECT ${SELECT_COLS} FROM expenses WHERE id = ?`).get(r.lastInsertRowid);
        auditFn('expense.create', 'expense', newRow.id,
                { date: body.date, category, amount: Number(body.amount), payment_method, shift_id: shiftId || null });
    })();

    return { status: 201, body: { expense: newRow } };
}

function updateExpense(db, id, body, admin, auditFn) {
    if (!Number.isInteger(id) || id <= 0)
        return { status: 400, body: { error: 'شناسه نامعتبر است' } };

    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!existing) return { status: 404, body: { error: 'هزینه یافت نشد' } };
    if (existing.is_void) return { status: 409, body: { error: 'هزینه ابطال شده است و قابل ویرایش نیست' } };

    const err = validateExpense(body);
    if (err) return { status: 400, body: { error: err } };

    const desc           = typeof body.desc === 'string' ? body.desc
                         : (typeof body.description === 'string' ? body.description : existing.description);
    const category       = body.category != null ? String(body.category).trim() : existing.category;
    const payment_method = body.payment_method || existing.payment_method;

    let updated;
    db.transaction(() => {
        db.prepare(
            `UPDATE expenses SET date = ?, category = ?, description = ?, amount = ?,
                                 payment_method = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
        ).run(body.date, category, desc, Number(body.amount), payment_method, id);

        updated = db.prepare(`SELECT ${SELECT_COLS} FROM expenses WHERE id = ?`).get(id);
        auditFn('expense.update', 'expense', id,
                { date: body.date, category, amount: Number(body.amount) });
    })();

    return { status: 200, body: { expense: updated } };
}

function voidExpense(db, id, reason, admin, auditFn) {
    if (!Number.isInteger(id) || id <= 0)
        return { status: 400, body: { error: 'شناسه نامعتبر است' } };

    const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
    if (!existing) return { status: 404, body: { error: 'هزینه یافت نشد' } };
    if (existing.is_void) return { status: 409, body: { error: 'هزینه قبلاً ابطال شده است' } };

    if (!reason || !String(reason).trim())
        return { status: 400, body: { error: 'دلیل ابطال الزامی است' } };
    const trimmedReason = String(reason).trim();
    if (trimmedReason.length > 500)
        return { status: 400, body: { error: 'دلیل ابطال حداکثر ۵۰۰ کاراکتر' } };

    db.transaction(() => {
        db.prepare(
            `UPDATE expenses SET is_void = 1, void_reason = ?, voided_by_admin = ?,
                                 voided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
        ).run(trimmedReason, admin.id, id);

        auditFn('expense.void', 'expense', id, { reason: String(reason).trim() });
    })();

    return { status: 200, body: { ok: true } };
}

function importExpenses(db, items, admin, auditFn) {
    if (!Array.isArray(items))
        return { status: 400, body: { error: 'آرایه هزینه‌ها الزامی است' } };
    if (items.length > MAX_IMPORT_BATCH)
        return { status: 400, body: { error: `حداکثر ${MAX_IMPORT_BATCH} مورد در هر درخواست مجاز است` } };

    // Validate the full batch before touching the DB.
    // Any invalid entry returns 400 with the 1-based Persian item index.
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const label = `ردیف ${i + 1}`;
        const key = item.idempotency_key != null ? String(item.idempotency_key).trim() : null;
        if (key === null || key.length < 1 || key.length > 200)
            return { status: 400, body: { error: `${label}: کلید idempotency نامعتبر است` } };
        if (!item.date || !ISO_DATE_RE.test(item.date) || !isValidGregorianDate(item.date))
            return { status: 400, body: { error: `${label}: تاریخ نامعتبر است` } };
        const amt = Number(item.amount);
        if (!Number.isInteger(amt) || amt <= 0 || !Number.isSafeInteger(amt))
            return { status: 400, body: { error: `${label}: مبلغ نامعتبر است` } };
        if (item.category != null) {
            const cat = String(item.category).trim();
            if (cat.length < 1 || cat.length > 50)
                return { status: 400, body: { error: `${label}: دسته‌بندی باید ۱ تا ۵۰ کاراکتر باشد` } };
        }
        const desc = typeof item.desc === 'string' ? item.desc : (item.description || '');
        if (String(desc).length > 500)
            return { status: 400, body: { error: `${label}: توضیحات حداکثر ۵۰۰ کاراکتر` } };
        if (item.payment_method !== undefined && !VALID_PAYMENT_METHODS.includes(item.payment_method))
            return { status: 400, body: { error: `${label}: روش پرداخت باید یکی از: cash، card، transfer باشد` } };
    }

    // All items valid — insert atomically. skipped means idempotency duplicate only.
    let imported = 0, skipped = 0;
    const insertStmt = db.prepare(
        `INSERT OR IGNORE INTO expenses
             (date, category, description, amount, payment_method,
              admin_id, admin_username, idempotency_key, migrated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    );

    db.transaction(() => {
        for (const item of items) {
            const key = String(item.idempotency_key).trim();
            const desc = typeof item.desc === 'string' ? item.desc : (item.description || '');
            const category = (item.category != null ? String(item.category).trim() : '') || 'سایر';
            const pm = item.payment_method || 'cash';
            const r = insertStmt.run(item.date, category, desc, Number(item.amount), pm,
                                     admin.id, admin.username, key);
            if (r.changes === 1) imported++; else skipped++;
        }
        if (imported > 0)
            auditFn('expense.import', 'expense', null, { imported, skipped, total: items.length });
    })();

    return { status: 200, body: { imported, skipped } };
}

module.exports = {
    validateExpense, isValidGregorianDate, getExpenses, createExpense,
    updateExpense, voidExpense, importExpenses,
    ISO_DATE_RE, VALID_PAYMENT_METHODS,
};

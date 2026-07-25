'use strict';

const express = require('express');
const { getDb }       = require('../database');
const { requireAdmin, audit } = require('../audit');
const svc             = require('../expense-service');

const router = express.Router();

function makeAuditFn(req) {
    return (action, entity, entityId, details) =>
        audit(req, action, entity, entityId, details);
}

// GET /api/expenses
router.get('/', requireAdmin('reports.view'), (req, res) => {
    const db = getDb();
    const { date_from, date_to, category, include_void } = req.query;

    if (date_from && !svc.ISO_DATE_RE.test(date_from))
        return res.status(400).json({ error: 'date_from باید به فرمت YYYY-MM-DD باشد' });
    if (date_to && !svc.ISO_DATE_RE.test(date_to))
        return res.status(400).json({ error: 'date_to باید به فرمت YYYY-MM-DD باشد' });
    if (date_from && !svc.isValidGregorianDate(date_from))
        return res.status(400).json({ error: 'date_from تاریخ نامعتبر است' });
    if (date_to && !svc.isValidGregorianDate(date_to))
        return res.status(400).json({ error: 'date_to تاریخ نامعتبر است' });
    if (date_from && date_to && date_from > date_to)
        return res.status(400).json({ error: 'date_from نمی‌تواند بعد از date_to باشد' });
    if (category !== undefined && category.length > 50)
        return res.status(400).json({ error: 'category حداکثر ۵۰ کاراکتر' });

    const result = svc.getExpenses(db, {
        dateFrom:    date_from,
        dateTo:      date_to,
        category:    category || null,
        includeVoid: include_void === '1',
    });
    res.json(result);
});

// POST /api/expenses/import  — must be before /:id
router.post('/import', requireAdmin('users.financial'), (req, res) => {
    const db = getDb();
    const items = req.body && req.body.expenses;
    try {
        const r = svc.importExpenses(db, items, req.admin, makeAuditFn(req));
        res.status(r.status).json(r.body);
    } catch (e) {
        console.error('[expenses] import:', e.message);
        res.status(500).json({ error: 'خطای سرور در import' });
    }
});

// POST /api/expenses
router.post('/', requireAdmin('users.financial'), (req, res) => {
    const db = getDb();
    try {
        const r = svc.createExpense(db, req.body, req.admin, makeAuditFn(req));
        res.status(r.status).json(r.body);
    } catch (e) {
        console.error('[expenses] create:', e.message);
        res.status(500).json({ error: 'خطای سرور' });
    }
});

// PUT /api/expenses/:id
router.put('/:id', requireAdmin('users.financial'), (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    try {
        const r = svc.updateExpense(db, id, req.body, req.admin, makeAuditFn(req));
        res.status(r.status).json(r.body);
    } catch (e) {
        console.error('[expenses] update:', e.message);
        res.status(500).json({ error: 'خطای سرور' });
    }
});

// DELETE /api/expenses/:id  (soft void, reason required in body)
router.delete('/:id', requireAdmin('users.financial'), (req, res) => {
    const db = getDb();
    const id = Number(req.params.id);
    const reason = req.body && req.body.reason;
    try {
        const r = svc.voidExpense(db, id, reason, req.admin, makeAuditFn(req));
        res.status(r.status).json(r.body);
    } catch (e) {
        console.error('[expenses] void:', e.message);
        res.status(500).json({ error: 'خطای سرور' });
    }
});

module.exports = router;

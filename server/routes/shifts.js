'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const { requireAdmin, audit } = require('../audit');
const svc = require('../shift-service');

function makeAuditFn(req) {
  return (action, entity, entityId, details) =>
    audit(req, action, entity, entityId, details);
}

function parseShiftId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

// GET /api/shifts — list recent shifts
router.get('/', requireAdmin('shifts.view'), (req, res) => {
  const db = getDb();
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const status = req.query.status || null;
  if (status && !['open', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'وضعیت باید open یا closed باشد' });
  }
  const r = svc.listShifts(db, { status, limit });
  res.status(r.status).json(r.body);
});

// GET /api/shifts/open — current open shift or 404
router.get('/open', requireAdmin('shifts.view'), (req, res) => {
  const db = getDb();
  const r = svc.getOpenShift(db);
  res.status(r.status).json(r.body);
});

// GET /api/shifts/:id
router.get('/:id', requireAdmin('shifts.view'), (req, res) => {
  const id = parseShiftId(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'شناسه شیفت نامعتبر است' });
  const db = getDb();
  const r = svc.getShift(db, id);
  res.status(r.status).json(r.body);
});

// GET /api/shifts/:id/preview — expected cash + totals breakdown
router.get('/:id/preview', requireAdmin('shifts.view'), (req, res) => {
  const id = parseShiftId(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'شناسه شیفت نامعتبر است' });
  const db = getDb();
  const r = svc.previewShift(db, id);
  res.status(r.status).json(r.body);
});

// POST /api/shifts — open a new shift
router.post('/', requireAdmin('shifts.manage'), (req, res) => {
  const db = getDb();
  const opening_cash = Number(req.body.opening_cash);
  if (!Number.isInteger(opening_cash) || opening_cash < 0) {
    return res.status(400).json({ error: 'مبلغ اول شیفت باید عدد صحیح غیر منفی باشد' });
  }
  const r = svc.openShift(db, {
    opening_cash,
    admin: req.admin,
    auditFn: makeAuditFn(req),
  });
  res.status(r.status).json(r.body);
});

// POST /api/shifts/:id/close — close shift with counted cash
router.post('/:id/close', requireAdmin('shifts.manage'), (req, res) => {
  const id = parseShiftId(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'شناسه شیفت نامعتبر است' });
  const db = getDb();
  const counted_cash = Number(req.body.counted_cash);
  const close_note   = req.body.close_note != null ? String(req.body.close_note) : null;
  if (!Number.isInteger(counted_cash) || counted_cash < 0) {
    return res.status(400).json({ error: 'موجودی شمارش‌شده باید عدد صحیح غیر منفی باشد' });
  }
  if (close_note && close_note.length > 500) {
    return res.status(400).json({ error: 'یادداشت بستن حداکثر ۵۰۰ کاراکتر' });
  }
  const r = svc.closeShift(db, {
    shiftId: id,
    counted_cash,
    close_note,
    admin: req.admin,
    auditFn: makeAuditFn(req),
  });
  res.status(r.status).json(r.body);
});

module.exports = router;

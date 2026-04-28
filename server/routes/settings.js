const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

function getAllSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

router.get('/', (req, res) => {
  const db = getDb();
  res.json(getAllSettings(db));
});

router.post('/', (req, res) => {
  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  const update = db.transaction((obj) => {
    for (const [k, v] of Object.entries(obj)) upsert.run(k, String(v));
  });
  update(req.body);
  res.json(getAllSettings(db));
});

module.exports = router;

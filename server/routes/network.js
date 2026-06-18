const express = require('express');
const { getDb } = require('../database');
const { requireAdmin, audit } = require('../audit');

const router = express.Router();

/* ─────────── DNS ─────────── */
router.get('/dns', (_req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM dns_servers ORDER BY is_default DESC, name ASC').all());
});

router.post('/dns', requireAdmin('network.edit'), (req, res) => {
  const { name, primary_dns, secondary_dns = '', country = 'IR', notes = '' } = req.body;
  if (!name || !primary_dns) return res.status(400).json({ error: 'نام و DNS اصلی الزامی است' });
  const db = getDb();
  let row;
  db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO dns_servers (name, primary_dns, secondary_dns, country, notes) VALUES (?, ?, ?, ?, ?)`
    ).run(name, primary_dns, secondary_dns, country, notes);
    audit(req, 'dns.create', 'dns', info.lastInsertRowid, { name, primary_dns });
    row = db.prepare('SELECT * FROM dns_servers WHERE id = ?').get(info.lastInsertRowid);
  })();
  // Broadcast so kiosk DnsDialogs that are already open refresh live.
  try { req.app.get('io')?.emit('dns:update'); } catch {}
  res.json(row);
});

router.put('/dns/:id', requireAdmin('network.edit'), (req, res) => {
  const db = getDb();
  const exists = db.prepare('SELECT id FROM dns_servers WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'DNS پیدا نشد' });
  const { name, primary_dns, secondary_dns, country, notes } = req.body;
  let row;
  db.transaction(() => {
    db.prepare(
      `UPDATE dns_servers SET name = COALESCE(?, name),
                              primary_dns = COALESCE(?, primary_dns),
                              secondary_dns = COALESCE(?, secondary_dns),
                              country = COALESCE(?, country),
                              notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(name, primary_dns, secondary_dns, country, notes, req.params.id);
    audit(req, 'dns.update', 'dns', req.params.id, req.body);
    row = db.prepare('SELECT * FROM dns_servers WHERE id = ?').get(req.params.id);
  })();
  try { req.app.get('io')?.emit('dns:update'); } catch {}
  res.json(row);
});

router.delete('/dns/:id', requireAdmin('network.edit'), (req, res) => {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM dns_servers WHERE id = ?').run(req.params.id);
    audit(req, 'dns.delete', 'dns', req.params.id);
  })();
  try { req.app.get('io')?.emit('dns:update'); } catch {}
  res.json({ success: true });
});

router.post('/dns/:id/default', requireAdmin('network.edit'), (req, res) => {
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE dns_servers SET is_default = 0").run();
    db.prepare("UPDATE dns_servers SET is_default = 1 WHERE id = ?").run(req.params.id);
    db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('default_dns_id', ?, CURRENT_TIMESTAMP)").run(String(req.params.id));
    audit(req, 'dns.default', 'dns', req.params.id);
  })();
  res.json({ success: true });
});

/* ─────────── Modems ─────────── */
router.get('/modems', (_req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM modems ORDER BY name ASC').all());
});

router.post('/modems', requireAdmin('network.edit'), (req, res) => {
  const { name, ip, gateway = '', notes = '' } = req.body;
  if (!name || !ip) return res.status(400).json({ error: 'نام و آی‌پی الزامی است' });
  const db = getDb();
  let row;
  db.transaction(() => {
    const info = db.prepare(`INSERT INTO modems (name, ip, gateway, notes) VALUES (?, ?, ?, ?)`).run(name, ip, gateway, notes);
    audit(req, 'modem.create', 'modem', info.lastInsertRowid, { name, ip });
    row = db.prepare('SELECT * FROM modems WHERE id = ?').get(info.lastInsertRowid);
  })();
  res.json(row);
});

router.put('/modems/:id', requireAdmin('network.edit'), (req, res) => {
  const db = getDb();
  const { name, ip, gateway, notes } = req.body;
  let row;
  db.transaction(() => {
    db.prepare(
      `UPDATE modems SET name = COALESCE(?, name),
                         ip = COALESCE(?, ip),
                         gateway = COALESCE(?, gateway),
                         notes = COALESCE(?, notes)
       WHERE id = ?`
    ).run(name, ip, gateway, notes, req.params.id);
    audit(req, 'modem.update', 'modem', req.params.id, req.body);
    row = db.prepare('SELECT * FROM modems WHERE id = ?').get(req.params.id);
  })();
  res.json(row);
});

router.delete('/modems/:id', requireAdmin('network.edit'), (req, res) => {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM modems WHERE id = ?').run(req.params.id);
    db.prepare('UPDATE client_assignments SET modem_id = NULL WHERE modem_id = ?').run(req.params.id);
    audit(req, 'modem.delete', 'modem', req.params.id);
  })();
  res.json({ success: true });
});

/* ─────────── Client assignments (per-PC: which modem + which DNS) ─────────── */
router.get('/assignments', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ca.*, m.name AS modem_name, m.ip AS modem_ip, m.gateway AS modem_gateway,
           d.name AS dns_name, d.primary_dns, d.secondary_dns
    FROM client_assignments ca
    LEFT JOIN modems m ON m.id = ca.modem_id
    LEFT JOIN dns_servers d ON d.id = ca.dns_id
    ORDER BY ca.computer_name
  `).all();
  res.json(rows);
});

router.post('/assignments', requireAdmin('network.edit'), (req, res) => {
  const { computer_name, modem_id, dns_id } = req.body;
  if (!computer_name) return res.status(400).json({ error: 'computer_name لازم است' });
  const db = getDb();
  let modem, dns;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO client_assignments (computer_name, modem_id, dns_id, last_seen)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(computer_name) DO UPDATE SET
        modem_id = excluded.modem_id,
        dns_id = excluded.dns_id,
        last_seen = CURRENT_TIMESTAMP
    `).run(computer_name, modem_id || null, dns_id || null);
    audit(req, 'client.assign', 'client', computer_name, { modem_id, dns_id });
    modem = modem_id ? db.prepare('SELECT * FROM modems WHERE id = ?').get(modem_id) : null;
    dns = dns_id ? db.prepare('SELECT * FROM dns_servers WHERE id = ?').get(dns_id) : null;
  })();

  // Push assignment to that client by computer_name (after commit)
  req.app.get('io').emit('client:assignment', { computer_name, modem, dns });
  res.json({ success: true });
});

module.exports = router;

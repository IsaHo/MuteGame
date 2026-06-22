const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { initDatabase, getDb } = require('./database');
const billing = require('./billing');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const shopRoutes = require('./routes/shop');
const settingsRoutes = require('./routes/settings');
const gamesRoutes = require('./routes/games');
const networkRoutes = require('./routes/network');
const adminsRoutes = require('./routes/admins');
const auditRoutes = require('./routes/audit');
const { attachAdmin, audit } = require('./audit');

// Shared secret loader: validates the env var and refuses to boot if missing
// or too short. The previous fallback literal made every issued token forgeable
// by anyone who could read the source.
const JWT_SECRET = require('./jwt-secret');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

// Loopback-only — server runs without a real proxy; broader `true` would let
// any LAN client spoof req.ip via X-Forwarded-For and bypass requireAdminIp.
app.set('trust proxy', 'loopback');
app.use(cors());
app.use(express.json());

initDatabase();

const connectedClients = new Map();

app.set('io', io);
app.set('connectedClients', connectedClients);

// ─── IP whitelist: only the admin computer can run sensitive admin commands ───
function normalizeIp(ip) {
  if (!ip) return '';
  return String(ip).replace(/^::ffff:/, '').replace(/^::1$/, '127.0.0.1');
}
function getAdminIp() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'admin_ip'").get();
  return row?.value || '';
}
function requireAdminIp(req, res, next) {
  const adminIp = getAdminIp();
  const reqIp = normalizeIp(req.ip);
  // Always allow loopback (admin panel on the same machine as the server)
  if (reqIp === '127.0.0.1' || reqIp === 'localhost') return next();
  if (!adminIp) return res.status(403).json({ error: 'IP ادمین هنوز ثبت نشده است' });
  if (reqIp !== adminIp) return res.status(403).json({ error: 'این درخواست فقط از سیستم ادمین مجاز است' });
  next();
}
// Primary auth — req.admin is populated by attachAdmin from a verified JWT.
// IP pinning stays as defense-in-depth; JWT presence is now mandatory.
function requireAdmin(req, res, next) {
  if (!req.admin || (req.admin.role !== 'admin' && req.admin.role !== 'super')) {
    return res.status(401).json({ error: 'احراز هویت ادمین لازم است' });
  }
  next();
}
app.set('requireAdminIp', requireAdminIp);
app.set('requireAdmin', requireAdmin);
app.set('normalizeIp', normalizeIp);

// Attach admin (decoded from JWT) on every API request
app.use('/api', attachAdmin);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/admins', adminsRoutes);
app.use('/api/audit', auditRoutes);

app.get('/api/admin-ip', (req, res) => {
  res.json({ adminIp: getAdminIp(), yourIp: normalizeIp(req.ip) });
});

app.get('/api/clients', (req, res) => {
  res.json(Array.from(connectedClients.values()));
});

app.post('/api/clients/:socketId/kick', requireAdmin, requireAdminIp, (req, res) => {
  const client = connectedClients.get(req.params.socketId);
  const db = getDb();
  const targetUserId = client?.userId || null;
  const targetSessionId = client?.sessionId || null;
  db.transaction(() => {
    if (targetSessionId) {
      billing.closeSession(db, {
        session_id: targetSessionId,
        end_reason: 'admin_force_logout',
        ctx: { admin_id: req.admin && req.admin.id },
      });
    }
    audit(req, 'client.kick', 'client', req.params.socketId, { userId: targetUserId, computerName: client?.computerName });
  })();
  if (client) {
    client.userId = null;
    client.username = null;
    client.credits = 0;
    client.status = 'idle';
    client.sessionStart = null;
    client.sessionId = null;
    client.sessionUuid = null;
    io.to(req.params.socketId).emit('session:end', { reason: 'admin_kick' });
    io.emit('clients:update', Array.from(connectedClients.values()));
  }
  res.json({ success: true });
});

app.post('/api/clients/:socketId/message', requireAdmin, requireAdminIp, (req, res) => {
  const db = getDb();
  db.transaction(() => {
    audit(req, 'client.message', 'client', req.params.socketId, { text: String(req.body.text || '').slice(0, 500) });
  })();
  io.to(req.params.socketId).emit('admin:message', { text: req.body.text });
  res.json({ success: true });
});

app.post('/api/clients/:socketId/extend', requireAdmin, requireAdminIp, (req, res) => {
  const amount = Number(req.body.minutes);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'مقدار نامعتبر' });
  const client = Array.from(connectedClients.values()).find(c => c.socketId === req.params.socketId);
  if (client && client.userId) {
    const db = getDb();
    let result;
    db.transaction(() => {
      // creditUser is the ONLY allowed balance-write path. 'manual_credit'
      // semantics: credits += amount; no debt adjustment. Admin-extending
      // an active session is a gift, not a debt payment.
      result = billing.creditUser(db, {
        user_id: client.userId,
        amount,
        event_type: 'manual_credit',
        description: 'admin extend (' + amount + ' units) socket=' + req.params.socketId,
        ctx: { admin_id: req.admin && req.admin.id },
      });
      audit(req, 'client.extend', 'user', client.userId, { socketId: req.params.socketId, computerName: client.computerName, minutes: amount });
    })();
    client.credits = result.credits_after;
    client.debt = result.debt_after;
    io.to(req.params.socketId).emit('credits:update', { credits: result.credits_after, debt: result.debt_after });
    io.emit('clients:update', Array.from(connectedClients.values()));
  }
  res.json({ success: true });
});

// ─── Force-login a user on a specific PC (admin context-menu) ───────
app.post('/api/clients/:socketId/force-login', requireAdmin, requireAdminIp, (req, res) => {
  const { userId, username } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId لازم است' });
  const client = connectedClients.get(req.params.socketId);
  if (!client) return res.status(404).json({ error: 'PC پیدا نشد' });
  const db = getDb();
  let user, opened;
  const adminCtx = { admin_id: req.admin && req.admin.id };
  try {
    db.transaction(() => {
      // 1. Close any session currently open on this seat (regardless of user)
      //    so openSession's partial UNIQUE INDEX won't reject the new one.
      const seatHolders = db.prepare(
        "SELECT id FROM sessions WHERE computer_name = ? AND seat_slot = 0 AND end_time IS NULL"
      ).all(client.computerName);
      for (const r of seatHolders) {
        billing.closeSession(db, { session_id: r.id, end_reason: 'force_login_displace', ctx: adminCtx });
      }
      // 2. Close any session this user has on OTHER PCs (user displaced from elsewhere).
      const userElsewhere = db.prepare(
        "SELECT id FROM sessions WHERE user_id = ? AND end_time IS NULL"
      ).all(userId);
      for (const r of userElsewhere) {
        billing.closeSession(db, { session_id: r.id, end_reason: 'force_login_displace', ctx: adminCtx });
      }
      // 3. Open the new session on this seat for the target user.
      opened = billing.openSession(db, {
        user_id: Number(userId), computer_name: client.computerName, seat_slot: 0, ctx: adminCtx,
      });
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
      audit(req, 'client.force-login', 'user', userId, { socketId: req.params.socketId, computerName: client.computerName, username, session_id: opened.session_id });
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }).immediate();
  } catch (e) {
    console.error('[force-login]', e.stack || e.message);
    return res.status(500).json({ error: e.code === 'SEAT_BUSY' ? 'صندلی قابل آزاد شدن نیست' : 'خطا در شروع نشست' });
  }
  client.userId = Number(userId);
  client.username = username || user.username;
  client.credits = user.credits;
  client.debt    = user.debt;
  client.postPay = user.post_pay ? 1 : 0;
  client.status = 'active';
  client.sessionStart = new Date().toISOString();
  client.sessionId = opened.session_id;
  client.sessionUuid = opened.session_uuid;
  // Tell the client to log in this user
  io.to(req.params.socketId).emit('admin:force-login', {
    user: { id: user.id, username: user.username, name: user.name, family: user.family, credits: user.credits, debt: user.debt },
  });
  io.emit('clients:update', Array.from(connectedClients.values()));
  res.json({ success: true });
});

// ─── Mute/unmute incoming voice for a specific client (admin toggle) ─
app.post('/api/clients/:socketId/voice-mute', requireAdmin, requireAdminIp, (req, res) => {
  const c = connectedClients.get(req.params.socketId);
  if (!c) return res.status(404).json({ error: 'PC پیدا نشد' });
  const db = getDb();
  db.transaction(() => {
    audit(req, 'client.voice-mute', 'client', req.params.socketId, { muted: !!req.body.muted, computerName: c.computerName });
  })();
  c.voiceMuted = !!req.body.muted;
  io.to(req.params.socketId).emit('voice:mute-toggle', { muted: c.voiceMuted });
  io.emit('clients:update', Array.from(connectedClients.values()));
  res.json({ success: true, muted: c.voiceMuted });
});

// ─── Power actions on a PC (lock/restart/shutdown) ──────────────────
app.post('/api/clients/:socketId/power', requireAdmin, requireAdminIp, (req, res) => {
  const { action } = req.body;
  if (!['lock', 'restart', 'shutdown'].includes(action))
    return res.status(400).json({ error: 'action نامعتبر' });
  const db = getDb();
  const client = connectedClients.get(req.params.socketId);
  db.transaction(() => {
    audit(req, 'client.power', 'client', req.params.socketId, { action, computerName: client?.computerName });
  })();
  io.to(req.params.socketId).emit('admin:power', { action });
  res.json({ success: true });
});

// Reports
function dateFilter(days) {
  if (days === 0) return "DATE(created_at, 'localtime') = DATE('now', 'localtime')";
  return `created_at >= datetime('now', 'localtime', '-${days} days')`;
}

app.get('/api/reports/revenue', (req, res) => {
  // Cash-basis revenue: includes both fresh charges (`type='charge'`, positive
  // amount) AND debt collections (`type='debt_pay'`, negative amount → ABS).
  // We surface them as separate columns so legacy callers (Dashboard, Reports)
  // that only read `charged` keep working untouched, while AccountingPage can
  // sum charged + debtPaid for true cash income. debt_add is intentionally
  // excluded — it represents service rendered on credit, not cash received.
  const db = getDb();
  const days = parseInt(req.query.days);
  const where = isNaN(days) ? dateFilter(7) : dateFilter(days);
  const revenue = db.prepare(`
    SELECT DATE(created_at, 'localtime') as date,
           SUM(CASE WHEN type = 'charge'   AND amount > 0 THEN amount        ELSE 0 END) as charged,
           SUM(CASE WHEN type = 'debt_pay'                THEN ABS(amount)   ELSE 0 END) as debtPaid,
           COUNT(*) as transactions
    FROM credit_transactions
    WHERE type IN ('charge', 'debt_pay') AND ${where}
    GROUP BY DATE(created_at, 'localtime')
    ORDER BY date ASC
  `).all();
  res.json(revenue);
});

app.get('/api/reports/shop', (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days);
  const where = isNaN(days) ? dateFilter(7) : dateFilter(days);
  const sales = db.prepare(`
    SELECT DATE(created_at, 'localtime') as date,
           SUM(total) as revenue,
           COUNT(*) as orders
    FROM shop_orders
    WHERE status = 'completed' AND ${where}
    GROUP BY DATE(created_at, 'localtime')
    ORDER BY date ASC
  `).all();
  res.json(sales);
});

app.get('/api/reports/shop-profit', (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days);
  const where = isNaN(days) ? dateFilter(7) : dateFilter(days);
  const orders = db.prepare(`SELECT items, total FROM shop_orders WHERE status = 'completed' AND ${where}`).all();
  let totalRevenue = 0, totalCost = 0, totalItems = 0;
  orders.forEach(o => {
    try {
      const items = JSON.parse(o.items);
      items.forEach(it => {
        totalRevenue += (it.price || 0) * (it.qty || 1);
        totalCost += (it.buy_price || 0) * (it.qty || 1);
        totalItems += (it.qty || 1);
      });
    } catch {}
  });
  res.json({ totalRevenue, totalCost, grossProfit: totalRevenue - totalCost, totalItems, ordersCount: orders.length });
});

app.get('/api/reports/stats', (req, res) => {
  // KPI snapshot. Cash flowing into the cafe has three components:
  //   • totalRevenue       — fresh charges (type='charge', amount > 0)
  //   • totalShopRevenue   — completed shop orders
  //   • totalDebtPaid      — debt collections (type='debt_pay', stored as
  //                          negative amount → ABS for display)
  // Older callers only read the first two; AccountingPage / ReportsPage now
  // read totalDebtPaid as a third stream so cash income is reported in full.
  const db = getDb();
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalRevenue = db.prepare("SELECT SUM(amount) as s FROM credit_transactions WHERE amount > 0 AND type='charge'").get().s || 0;
  const totalShopRevenue = db.prepare("SELECT SUM(total) as s FROM shop_orders WHERE status='completed'").get().s || 0;
  const totalDebtPaid = db.prepare("SELECT SUM(ABS(amount)) as s FROM credit_transactions WHERE type='debt_pay'").get().s || 0;
  const todayRevenue = db.prepare("SELECT SUM(amount) as s FROM credit_transactions WHERE amount > 0 AND type='charge' AND DATE(created_at,'localtime')=DATE('now','localtime')").get().s || 0;
  const todayShop = db.prepare("SELECT SUM(total) as s FROM shop_orders WHERE status='completed' AND DATE(created_at,'localtime')=DATE('now','localtime')").get().s || 0;
  const todayDebtPaid = db.prepare("SELECT SUM(ABS(amount)) as s FROM credit_transactions WHERE type='debt_pay' AND DATE(created_at,'localtime')=DATE('now','localtime')").get().s || 0;
  const todayUsers = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM sessions WHERE DATE(start_time,'localtime')=DATE('now','localtime')").get().c;
  const activeNow = Array.from(connectedClients.values()).filter(c => c.status === 'active').length;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM shop_orders WHERE status='pending'").get().c;
  res.json({ totalUsers, totalRevenue, totalShopRevenue, totalDebtPaid, todayRevenue, todayShop, todayDebtPaid, todayUsers, activeNow, pendingOrders });
});

app.get('/api/sessions', (req, res) => {
  const db = getDb();
  const sessions = db.prepare(`
    SELECT s.*, u.username FROM sessions s
    JOIN users u ON s.user_id = u.id
    ORDER BY s.start_time DESC LIMIT 200
  `).all();
  res.json(sessions);
});

// ─── Socket.IO handshake auth ─────────────────────────────────────
// Tags admin sockets with `socket.data.isAdmin = true` when a valid admin JWT
// is presented. Never rejects — kiosk clients connect without tokens. Admin-
// only events (voice:*, admin:* relays) gate on socket.data.isAdmin.
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (token) {
    try {
      const p = jwt.verify(token, JWT_SECRET);
      if (p && (p.role === 'admin' || p.role === 'super')) {
        socket.data.isAdmin = true;
        socket.data.adminId = p.id;
      }
    } catch {}
  }
  next();
});

// Socket.IO
io.on('connection', (socket) => {
  // Drop any admin-emitted event from a non-admin socket.
  const adminOnly = (handler) => (...args) => {
    if (!socket.data.isAdmin) return;
    return handler(...args);
  };
  console.log('🔌 Socket connected:', socket.id);

  socket.on('client:register', (data) => {
    const computerName = data.computerName || `PC-${socket.id.slice(0, 4)}`;
    connectedClients.set(socket.id, {
      socketId: socket.id,
      computerId: data.computerId,
      computerName,
      status: 'idle',
      userId: null,
      username: null,
      sessionStart: null,
      sessionId: null,
      sessionUuid: null,
      credits: 0,
      debt: 0,
      postPay: 0,
    });
    io.emit('clients:update', Array.from(connectedClients.values()));
    console.log(`💻 Registered: ${computerName}`);

    // Push initial state to this client: games + assignment + warning settings
    try {
      const db = getDb();
      const games = db.prepare('SELECT * FROM games WHERE active = 1 ORDER BY sort_order, name').all();
      socket.emit('games:update', games);

      // Update last_seen and fetch assignment
      db.prepare(`
        INSERT INTO client_assignments (computer_name, last_seen)
        VALUES (?, CURRENT_TIMESTAMP)
        ON CONFLICT(computer_name) DO UPDATE SET last_seen = CURRENT_TIMESTAMP
      `).run(computerName);

      const assignment = db.prepare(`
        SELECT ca.*, m.name AS modem_name, m.ip AS modem_ip, m.gateway AS modem_gateway,
               d.name AS dns_name, d.primary_dns, d.secondary_dns
        FROM client_assignments ca
        LEFT JOIN modems m ON m.id = ca.modem_id
        LEFT JOIN dns_servers d ON d.id = ca.dns_id
        WHERE ca.computer_name = ?
      `).get(computerName);

      if (assignment) {
        socket.emit('client:assignment', {
          computer_name: computerName,
          modem: assignment.modem_id ? {
            id: assignment.modem_id, name: assignment.modem_name,
            ip: assignment.modem_ip, gateway: assignment.modem_gateway,
          } : null,
          dns: assignment.dns_id ? {
            id: assignment.dns_id, name: assignment.dns_name,
            primary_dns: assignment.primary_dns, secondary_dns: assignment.secondary_dns,
          } : null,
        });
      }

      // Warning settings
      const warnRows = db.prepare("SELECT key, value FROM settings WHERE key IN ('warn_at_minutes','warn_sound','warn_volume')").all();
      const warn = {};
      warnRows.forEach(r => warn[r.key] = r.value);
      socket.emit('warn:settings', warn);
    } catch (e) { console.error('initial-push error:', e.message); }
  });

  socket.on('client:login', (data) => {
    const client = connectedClients.get(socket.id);
    if (!client) return;
    if (!Number.isInteger(Number(data.userId))) {
      socket.emit('login:error', { message: 'userId نامعتبر' });
      return;
    }
    const userId = Number(data.userId);
    const db = getDb();

    let opened;
    try {
      db.transaction(() => {
        // Displace any prior session this user has open elsewhere (kiosk
        // crash recovery: user re-logs on a different PC). Same user on
        // same seat would also be caught by openSession's SeatBusyError;
        // closing upstream gives a clean ledger transition.
        const userElsewhere = db.prepare(
          "SELECT id FROM sessions WHERE user_id = ? AND end_time IS NULL"
        ).all(userId);
        for (const r of userElsewhere) {
          billing.closeSession(db, { session_id: r.id, end_reason: 'force_login_displace' });
        }
        opened = billing.openSession(db, {
          user_id: userId, computer_name: client.computerName, seat_slot: 0,
        });
        db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
      }).immediate();
    } catch (e) {
      console.error('[client:login]', e.stack || e.message);
      socket.emit('login:error', {
        message: e.code === 'SEAT_BUSY' ? 'این صندلی در حال استفاده است' : 'خطا در شروع نشست',
        code: e.code || null,
      });
      return;
    }

    // Always read credits + debt + post_pay from DB — the kiosk's `data`
    // payload is just what the login screen saw, not authoritative.
    const u = db.prepare('SELECT credits, debt, post_pay FROM users WHERE id = ?').get(userId) || {};

    client.userId = userId;
    client.username = data.username;
    client.credits = Number(u.credits || 0);
    client.debt = Number(u.debt || 0);
    client.postPay = u.post_pay ? 1 : 0;
    client.status = 'active';
    client.sessionStart = new Date().toISOString();
    client.sessionId = opened.session_id;
    client.sessionUuid = opened.session_uuid;
    socket.emit('session:started', {
      session_uuid: opened.session_uuid,
      locked_rate_per_hour: opened.locked_rate_per_hour,
    });
    io.emit('clients:update', Array.from(connectedClients.values()));
  });

  socket.on('client:logout', () => {
    const client = connectedClients.get(socket.id);
    if (!client) return;
    if (client.sessionId) {
      const db = getDb();
      try {
        billing.closeSession(db, { session_id: client.sessionId, end_reason: 'user_logout' });
      } catch (e) {
        console.error('[client:logout]', e.stack || e.message);
      }
    }
    client.userId = null;
    client.username = null;
    client.credits = 0;
    client.status = 'idle';
    client.sessionStart = null;
    client.sessionId = null;
    client.sessionUuid = null;
    io.emit('clients:update', Array.from(connectedClients.values()));
  });

  /* ─── Voice relay (admin push-to-talk → client speaker) ─────────────
   * The admin holds a button, captures mic audio (MediaRecorder, webm/opus),
   * and emits `voice:chunk` events targeted at a specific client socketId.
   * The server forwards them to that client. The client plays each blob.
   * Client can opt-out by emitting `voice:mute` (server stores the flag and
   * blocks further chunks until `voice:unmute`).
   */
  socket.on('voice:start', adminOnly(({ targetSocketId }) => {
    if (!targetSocketId) return;
    const target = connectedClients.get(targetSocketId);
    if (target?.voiceMuted) return; // client muted incoming voice
    io.to(targetSocketId).emit('voice:incoming-start', { from: socket.id });
  }));
  socket.on('voice:chunk', adminOnly(({ targetSocketId, audio, mime }) => {
    if (!targetSocketId || !audio) return;
    const target = connectedClients.get(targetSocketId);
    if (target?.voiceMuted) return;
    io.to(targetSocketId).emit('voice:incoming-chunk', { from: socket.id, audio, mime });
  }));
  socket.on('voice:stop', adminOnly(({ targetSocketId }) => {
    if (!targetSocketId) return;
    io.to(targetSocketId).emit('voice:incoming-stop', { from: socket.id });
  }));
  socket.on('voice:mute', () => {
    const c = connectedClients.get(socket.id);
    if (c) { c.voiceMuted = true; io.emit('clients:update', Array.from(connectedClients.values())); }
  });
  socket.on('voice:unmute', () => {
    const c = connectedClients.get(socket.id);
    if (c) { c.voiceMuted = false; io.emit('clients:update', Array.from(connectedClients.values())); }
  });

  /*
   * Phase 4 — kiosk-recovery handshake. After a transient network
   * outage the kiosk's new socket.id emits client:resume with the
   * session_uuid it stored before disconnect, plus the computer_name
   * and user_id from its in-memory state. Server validates and
   * atomically transitions state='recovering' → 'active' via
   * billing.resumeSession.
   *
   * Duplicate-client policy (preflight Q4): if a different socket
   * already owns the session_id, reject with 'duplicate_client' and
   * audit. The legitimate-retry case (same socket re-emitting after a
   * lost ack) is short-circuited at the connectedClients-map check
   * before the helper runs.
   */
  socket.on('client:resume', (data) => {
    const client = connectedClients.get(socket.id);
    if (!client) return;
    if (!data || typeof data.session_uuid !== 'string') {
      socket.emit('resume:rejected', { reason: 'invalid_payload' });
      return;
    }
    const claimedUuid = data.session_uuid;
    const claimedUserId = Number(data.user_id);
    const claimedComputer = client.computerName;
    const syntheticReq = { admin: null, ip: socket.handshake.address || '' };

    // Duplicate-client pre-check. If any OTHER socket in connectedClients
    // already holds a session whose uuid matches, this is a duplicate.
    for (const [otherId, other] of connectedClients) {
      if (otherId === socket.id) continue;
      if (other.sessionUuid && other.sessionUuid === claimedUuid) {
        try {
          audit(syntheticReq, 'session.duplicate_resume_attempt', 'session', other.sessionId, {
            uuid_suffix: claimedUuid.slice(-4),
            existing_socket_id: otherId,
            new_socket_id: socket.id,
            computer_name: claimedComputer,
          });
        } catch (e) { console.error('[resume:dup-audit]', e.message); }
        socket.emit('resume:rejected', { reason: 'duplicate_client' });
        return;
      }
    }

    const db = getDb();
    let resumed;
    try {
      resumed = billing.resumeSession(db, {
        session_uuid: claimedUuid,
        computer_name: claimedComputer,
        user_id: claimedUserId,
      });
    } catch (e) {
      if (e.code === 'RESUME_REJECTED') {
        try {
          audit(syntheticReq, 'session.resume.rejected', 'session', null, {
            uuid_suffix: claimedUuid.slice(-4),
            reason: e.reason,
            claimed_computer: claimedComputer,
            claimed_user_id: claimedUserId,
            details: e.details || {},
          });
        } catch (ae) { console.error('[resume:rej-audit]', ae.message); }
        socket.emit('resume:rejected', { reason: e.reason });
        return;
      }
      console.error('[client:resume]', e.stack || e.message);
      socket.emit('resume:rejected', { reason: 'internal_error' });
      return;
    }

    // Restore connectedClients entry.
    client.userId = resumed.user_id;
    client.username = resumed.username;
    client.credits = resumed.credits;
    client.debt = resumed.debt;
    client.postPay = resumed.post_pay ? 1 : 0;
    client.status = 'active';
    client.sessionStart = resumed.start_time;
    client.sessionId = resumed.session_id;
    client.sessionUuid = claimedUuid;

    try {
      audit(syntheticReq, 'session.resume.ok', 'session', resumed.session_id, {
        uuid_suffix: claimedUuid.slice(-4),
        was_recovering: resumed.was_recovering,
        computer_name: claimedComputer,
        user_id: claimedUserId,
      });
    } catch (ae) { console.error('[resume:ok-audit]', ae.message); }

    socket.emit('resume:ok', {
      session_id: resumed.session_id,
      locked_rate_per_hour: resumed.locked_rate_per_hour,
      credits: resumed.credits,
      debt: resumed.debt,
      post_pay: resumed.post_pay,
      last_billed_at: resumed.last_billed_at,
      computer_name: resumed.computer_name,
      was_recovering: resumed.was_recovering,
    });
    io.emit('clients:update', Array.from(connectedClients.values()));
  });

  socket.on('disconnect', () => {
    const client = connectedClients.get(socket.id);
    if (client?.sessionId) {
      // Transition active → recovering. Pauses billing for this session
      // until either (a) Phase 4 client:resume restores the same session
      // (preferred), or (b) periodic recovery sweep closes it after
      // billing_recovery_grace_seconds.
      const db = getDb();
      try {
        db.prepare("UPDATE sessions SET state = 'recovering' WHERE id = ? AND state = 'active'").run(client.sessionId);
      } catch (e) { console.error('[disconnect] mark-recovering error:', e.message); }
    }
    connectedClients.delete(socket.id);
    io.emit('clients:update', Array.from(connectedClients.values()));
    console.log('❌ Disconnected:', socket.id);
  });
});

// ─── Timestamp-driven billing ticker (Phase 3) ──────────────────────
// Replaces the ceil-per-minute deduction with the freeze v1 model:
//   • Each active session has its own last_billed_at + unpaid_micros.
//   • Every tick advances the timestamp, accumulates micro-currency owed
//     at the session's locked_rate_per_hour, flushes whole units to the
//     user, and persists the fractional remainder.
//   • All mutation goes through billing.billSessionUntilLocked inside a
//     BEGIN IMMEDIATE transaction. The ticker never touches users.credits
//     or sessions.* directly — the forbidden-direct-writes rule applies.
//   • shortfall>0 + !post_pay → close with end_reason='no_funds' + evict.
//   • limit_time = unlimited free play: advance last_billed_at without
//     charge or ledger row (no billing happens).
//   • limit_minutes (per-session cap): when sessions.duration >= cap,
//     close with end_reason='session_expired'.
function evictClient(client, socketId, reason, extra = {}) {
  io.to(socketId).emit('session:end', { reason, ...extra });
  client.status = 'idle';
  client.userId = null;
  client.username = null;
  client.credits = 0;
  client.sessionStart = null;
  client.sessionId = null;
  client.sessionUuid = null;
}

setInterval(() => {
  const db = getDb();
  const lowThreshold = (() => {
    const r = db.prepare("SELECT value FROM settings WHERE key = 'gaming_price_per_hour'").get();
    return Number((r && r.value) || 30000);
  })();
  const now = new Date();

  connectedClients.forEach((client, socketId) => {
    if (client.status !== 'active' || !client.userId || !client.sessionId) return;

    const user = db.prepare(
      'SELECT id, credits, debt, limit_minutes, post_pay, limit_time FROM users WHERE id = ?'
    ).get(client.userId);
    if (!user) return;
    const sess = db.prepare('SELECT * FROM sessions WHERE id = ?').get(client.sessionId);
    if (!sess || sess.state === 'closed') {
      // Out-of-band close: the cached session row was either deleted
      // (shouldn't happen — append-only enforced elsewhere) or was
      // closed by force-login / kick / boot-recovery / recovery-sweep
      // while this kiosk was still showing the logged-in UI. Surface
      // the eviction so the kiosk locks instead of sitting un-billed
      // with stale UI. The DB session is already closed; nothing
      // further to charge.
      evictClient(client, socketId, 'session_gone');
      io.emit('clients:update', Array.from(connectedClients.values()));
      return;
    }
    if (sess.state !== 'active') return;  // recovering / starting → skip (intentional)

    // limit_time = unlimited free play. Bump last_billed_at + duration so
    // the recovery sweep doesn't see this row as stale and aggregate
    // reports still show wall-clock time, but emit no ledger row and
    // touch no balance.
    if (user.limit_time) {
      try {
        const lastMs = billing.parseDbTimestampMs(sess.last_billed_at);
        const deltaSec = Math.max(0, Math.floor((now.getTime() - lastMs) / 1000));
        if (deltaSec > 0) {
          db.transaction(() => {
            db.prepare(
              'UPDATE sessions SET last_billed_at = ?, duration = duration + ? WHERE id = ? AND state = \'active\''
            ).run(billing.isoNow(now), deltaSec, sess.id);
            db.prepare('UPDATE users SET total_minutes = total_minutes + ? WHERE id = ?')
              .run(Math.floor(deltaSec / 60), user.id);
          }).immediate();
        }
      } catch (e) { console.error('[ticker:limit_time] error session', sess.id, ':', e.message); }
      io.to(socketId).emit('credits:update', { credits: 0, debt: user.debt, limit_time: 1 });
      return;
    }

    // Per-session minute cap. Convert to seconds — sessions.duration is
    // tracked in seconds since Phase 3 (was per-minute increments before).
    if (user.limit_minutes > 0 && sess.duration >= user.limit_minutes * 60) {
      try {
        billing.closeSession(db, { session_id: sess.id, end_reason: 'session_expired', now });
      } catch (e) { console.error('[ticker:limit_minutes] close error session', sess.id, ':', e.message); }
      evictClient(client, socketId, 'limit_reached', { limit: user.limit_minutes });
      io.emit('clients:update', Array.from(connectedClients.values()));
      return;
    }

    // Standard timestamp-driven tick.
    let result;
    try {
      result = db.transaction(() => billing.billSessionUntilLocked(db, sess, now, {})).immediate();
    } catch (e) {
      // Drift, clock warp, or unexpected schema/constraint error. Skip
      // this tick — next tick retries. Loud log for ops.
      console.error('[ticker:bill] error session', sess.id, ':', e.message);
      return;
    }

    // Refresh user state for the connectedClients cache + admin UI.
    const refreshed = db.prepare('SELECT credits, debt, post_pay FROM users WHERE id = ?').get(user.id);
    if (refreshed) {
      client.credits = refreshed.credits;
      client.debt = refreshed.debt;
      client.postPay = refreshed.post_pay ? 1 : 0;
    }

    // Insufficient funds + no post_pay → close + evict. The partial-mode
    // tick already drained any remaining credits before reporting the
    // shortfall, so closeSession's final flush is a no-op here.
    if (result.shortfall > 0 && !user.post_pay) {
      try {
        billing.closeSession(db, { session_id: sess.id, end_reason: 'no_funds', now });
      } catch (e) { console.error('[ticker:no_funds] close error session', sess.id, ':', e.message); }
      evictClient(client, socketId, 'no_credits');
      io.emit('clients:update', Array.from(connectedClients.values()));
      return;
    }

    io.to(socketId).emit('credits:update', {
      credits: refreshed ? refreshed.credits : 0,
      debt: refreshed ? refreshed.debt : 0,
    });
    if (refreshed && refreshed.credits > 0 && refreshed.credits <= lowThreshold) {
      io.to(socketId).emit('credits:low', { credits: refreshed.credits });
    }
  });
  io.emit('clients:update', Array.from(connectedClients.values()));
}, 60000);

// ─── Boot recovery sweep (Phase 3) ──────────────────────────────────
// On boot, every session with end_time IS NULL is from the previous
// boot — the process either crashed or was shut down without logout.
// Mark each as 'recovering' first so closeSession's final flush sees
// state='recovering' and SKIPS billing (the crash → boot gap is
// un-billable: the customer wasn't playing during downtime). Then
// close with end_reason='boot_recovery'. Idempotent: on a clean DB
// the sweep finds zero rows and is a no-op.
function bootRecoverySweep() {
  const db = getDb();
  const stale = db.prepare("SELECT id, last_billed_at FROM sessions WHERE end_time IS NULL").all();
  if (!stale.length) {
    console.log('🔄 [boot-recovery] no stale sessions');
    return;
  }
  // Split by age (Phase 4 preflight Q2). Sessions whose last_billed_at
  // is within billing_resume_max_age_seconds of NOW are eligible for
  // kiosk client:resume — transition to 'recovering' with last_billed_at
  // reset to now (skipping the un-billable server-downtime gap). Older
  // sessions close as 'boot_recovery_age' — customer is long gone.
  const maxAgeRow = db.prepare("SELECT value FROM settings WHERE key = 'billing_resume_max_age_seconds'").get();
  const maxAgeS = Number((maxAgeRow && maxAgeRow.value) || 600);
  const cutoffMs = Date.now() - maxAgeS * 1000;
  const cutoffIso = billing.isoNow(new Date(cutoffMs));
  const nowIso = billing.isoNow(new Date());

  let young = 0, oldClosed = 0, invalidClosed = 0;
  for (const s of stale) {
    // Parse last_billed_at defensively. parseDbTimestampMs throws on
    // NULL or malformed input. Pre-Phase-2 closed rows can't reach
    // here (WHERE end_time IS NULL excludes them) but a corrupted
    // import or hand-edit could leave a NULL last_billed_at on an open
    // session. Treat unparseable as "old": close defensively so the
    // seat is freed. Operator can audit the closure via end_reason.
    let lastMs;
    try {
      lastMs = billing.parseDbTimestampMs(s.last_billed_at);
    } catch (parseErr) {
      console.error('[boot-recovery] unparseable last_billed_at on session', s.id, '=', s.last_billed_at, '— closing as boot_recovery_age');
      try {
        db.prepare(
          "UPDATE sessions SET state='recovering' WHERE id=? AND end_time IS NULL AND state='active'"
        ).run(s.id);
        billing.closeSession(db, { session_id: s.id, end_reason: 'boot_recovery_age' });
        invalidClosed++;
      } catch (closeErr) {
        console.error('[boot-recovery] invalid-row close error session', s.id, ':', closeErr.message);
      }
      continue;
    }

    try {
      if (lastMs >= cutoffMs) {
        // Young: eligible for resume. Transition to recovering + skip gap.
        db.prepare(
          "UPDATE sessions SET state='recovering', last_billed_at=? WHERE id=? AND end_time IS NULL"
        ).run(nowIso, s.id);
        young++;
      } else {
        // Old: close. Mark recovering first so closeSession's final flush
        // skips (we don't want to bill the server-down gap).
        db.prepare(
          "UPDATE sessions SET state='recovering' WHERE id=? AND end_time IS NULL AND state='active'"
        ).run(s.id);
        billing.closeSession(db, { session_id: s.id, end_reason: 'boot_recovery_age' });
        oldClosed++;
      }
    } catch (e) {
      console.error('[boot-recovery] error session', s.id, ':', e.message);
    }
  }
  console.log(
    '🔄 [boot-recovery] young→recovering=' + young
    + ' old→closed=' + oldClosed
    + ' invalid→closed=' + invalidClosed
    + ' (cutoff=' + maxAgeS + 's, total=' + stale.length + ')'
  );
}

// ─── Periodic recovery sweep (Phase 3) ──────────────────────────────
// Every 30s: find sessions in state='recovering' whose last_billed_at
// is older than billing_recovery_grace_seconds. These represent kiosks
// that disconnected and never came back. Close with end_reason=
// 'recovery_timeout' so the seat is freed (the partial UNIQUE INDEX
// would otherwise block a new login on the same seat forever).
function periodicRecoverySweep() {
  const db = getDb();
  const graceRow = db.prepare("SELECT value FROM settings WHERE key = 'billing_recovery_grace_seconds'").get();
  const graceS = Number((graceRow && graceRow.value) || 120);
  const cutoffIso = billing.isoNow(new Date(Date.now() - graceS * 1000));
  const stale = db.prepare(
    "SELECT id FROM sessions WHERE state = 'recovering' AND last_billed_at < ?"
  ).all(cutoffIso);
  for (const s of stale) {
    try {
      billing.closeSession(db, { session_id: s.id, end_reason: 'recovery_timeout' });
    } catch (e) { console.error('[recovery-sweep] close error session', s.id, ':', e.message); }
  }
  if (stale.length) console.log('🔄 [recovery-sweep] closed', stale.length, 'recovering sessions older than', graceS + 's');
}

bootRecoverySweep();
setInterval(periodicRecoverySweep, 30_000);

const adminDistPath = process.env.ADMIN_DIST || require('path').join(__dirname, '..', 'admin', 'dist');
const fs = require('fs');
if (fs.existsSync(adminDistPath)) {
  app.use('/admin', require('express').static(adminDistPath));
  app.get('/admin/*', (req, res) => res.sendFile(require('path').join(adminDistPath, 'index.html')));
}

// Global error middleware — must be LAST. A thrown handler (e.g. an audit
// INSERT that rolled back the surrounding `db.transaction`) lands here and
// is surfaced as a JSON 500 so the admin SPA can render a real message
// rather than an HTML stack trace. Audit failures used to be silently
// swallowed; with the new throw-instead-of-swallow semantics they now
// reach this handler and become visible.
app.use((err, _req, res, _next) => {
  console.error('[express]', err && (err.stack || err.message || err));
  if (res.headersSent) return;
  res.status(500).json({ error: (err && err.message) || 'خطای داخلی سرور' });
});

function startServer(port) {
  const PORT = port || process.env.PORT || 3001;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎮 MuteGame Server running on port ${PORT}`);
    console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
    console.log(`🔗 API: http://localhost:${PORT}/api\n`);
  });
  return server;
}

module.exports = { app, server, io, startServer };

if (require.main === module) {
  startServer();
}

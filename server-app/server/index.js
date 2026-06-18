const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { initDatabase, getDb } = require('./database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const shopRoutes = require('./routes/shop');
const settingsRoutes = require('./routes/settings');
const gamesRoutes = require('./routes/games');
const networkRoutes = require('./routes/network');
const adminsRoutes = require('./routes/admins');
const auditRoutes = require('./routes/audit');
const { attachAdmin } = require('./audit');

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
  if (client) {
    if (client.userId) {
      const db = getDb();
      db.prepare('UPDATE sessions SET end_time = CURRENT_TIMESTAMP WHERE user_id = ? AND end_time IS NULL').run(client.userId);
    }
    client.userId = null;
    client.username = null;
    client.credits = 0;
    client.status = 'idle';
    client.sessionStart = null;
    io.to(req.params.socketId).emit('session:end', { reason: 'admin_kick' });
    io.emit('clients:update', Array.from(connectedClients.values()));
  }
  res.json({ success: true });
});

app.post('/api/clients/:socketId/message', requireAdmin, requireAdminIp, (req, res) => {
  io.to(req.params.socketId).emit('admin:message', { text: req.body.text });
  res.json({ success: true });
});

app.post('/api/clients/:socketId/extend', requireAdmin, requireAdminIp, (req, res) => {
  const { minutes } = req.body;
  const client = Array.from(connectedClients.values()).find(c => c.socketId === req.params.socketId);
  if (client && client.userId) {
    const db = getDb();
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(minutes, client.userId);
    const user = db.prepare('SELECT credits, debt FROM users WHERE id = ?').get(client.userId);
    client.credits = user.credits;
    io.to(req.params.socketId).emit('credits:update', { credits: user.credits, debt: user.debt });
    io.emit('clients:update', Array.from(connectedClients.values()));
  }
  res.json({ success: true });
});

// ─── Force-login a user on a specific PC (admin context-menu) ───────
app.post('/api/clients/:socketId/force-login', requireAdmin, requireAdminIp, (req, res) => {
  const { userId, username, credits } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId لازم است' });
  const client = connectedClients.get(req.params.socketId);
  if (!client) return res.status(404).json({ error: 'PC پیدا نشد' });
  const db = getDb();
  // Close any open session for this user, then start a new one on this PC
  db.prepare('UPDATE sessions SET end_time = CURRENT_TIMESTAMP WHERE user_id = ? AND end_time IS NULL').run(userId);
  db.prepare('INSERT INTO sessions (user_id, computer_name) VALUES (?, ?)').run(userId, client.computerName);
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  client.userId = userId;
  client.username = username || user.username;
  client.credits = user.credits;
  client.status = 'active';
  client.sessionStart = new Date().toISOString();
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
  io.to(req.params.socketId).emit('admin:power', { action });
  res.json({ success: true });
});

// Reports
function dateFilter(days) {
  if (days === 0) return "DATE(created_at, 'localtime') = DATE('now', 'localtime')";
  return `created_at >= datetime('now', 'localtime', '-${days} days')`;
}

app.get('/api/reports/revenue', (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days);
  const where = isNaN(days) ? dateFilter(7) : dateFilter(days);
  const revenue = db.prepare(`
    SELECT DATE(created_at, 'localtime') as date,
           SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as charged,
           COUNT(*) as transactions
    FROM credit_transactions
    WHERE type = 'charge' AND ${where}
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
  const db = getDb();
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalRevenue = db.prepare("SELECT SUM(amount) as s FROM credit_transactions WHERE amount > 0 AND type='charge'").get().s || 0;
  const totalShopRevenue = db.prepare("SELECT SUM(total) as s FROM shop_orders WHERE status='completed'").get().s || 0;
  const todayRevenue = db.prepare("SELECT SUM(amount) as s FROM credit_transactions WHERE amount > 0 AND type='charge' AND DATE(created_at,'localtime')=DATE('now','localtime')").get().s || 0;
  const todayShop = db.prepare("SELECT SUM(total) as s FROM shop_orders WHERE status='completed' AND DATE(created_at,'localtime')=DATE('now','localtime')").get().s || 0;
  const todayUsers = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM sessions WHERE DATE(start_time,'localtime')=DATE('now','localtime')").get().c;
  const activeNow = Array.from(connectedClients.values()).filter(c => c.status === 'active').length;
  const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM shop_orders WHERE status='pending'").get().c;
  res.json({ totalUsers, totalRevenue, totalShopRevenue, todayRevenue, todayShop, todayUsers, activeNow, pendingOrders });
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
      credits: 0,
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
    const db = getDb();

    db.prepare('UPDATE sessions SET end_time = CURRENT_TIMESTAMP WHERE user_id = ? AND end_time IS NULL').run(data.userId);
    db.prepare('INSERT INTO sessions (user_id, computer_name) VALUES (?, ?)').run(data.userId, client.computerName);
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(data.userId);

    client.userId = data.userId;
    client.username = data.username;
    client.credits = data.credits;
    client.status = 'active';
    client.sessionStart = new Date().toISOString();
    io.emit('clients:update', Array.from(connectedClients.values()));
  });

  socket.on('client:logout', () => {
    const client = connectedClients.get(socket.id);
    if (!client) return;
    if (client.userId) {
      const db = getDb();
      db.prepare('UPDATE sessions SET end_time = CURRENT_TIMESTAMP WHERE user_id = ? AND end_time IS NULL').run(client.userId);
    }
    client.userId = null;
    client.username = null;
    client.credits = 0;
    client.status = 'idle';
    client.sessionStart = null;
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

  socket.on('disconnect', () => {
    const client = connectedClients.get(socket.id);
    if (client?.userId) {
      const db = getDb();
      db.prepare('UPDATE sessions SET end_time = CURRENT_TIMESTAMP WHERE user_id = ? AND end_time IS NULL').run(client.userId);
    }
    connectedClients.delete(socket.id);
    io.emit('clients:update', Array.from(connectedClients.values()));
    console.log('❌ Disconnected:', socket.id);
  });
});

// Credit deduction: Rial-based per minute
setInterval(() => {
  const db = getDb();
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]));
  const pricePerHour = Number(settings.gaming_price_per_hour || 30000);
  const peakStart = Number(settings.gaming_peak_start || 16);
  const peakEnd = Number(settings.gaming_peak_end || 24);
  const offStart = Number(settings.gaming_offpeak_start || 0);
  const offEnd = Number(settings.gaming_offpeak_end || 12);
  const multiplier = (() => {
    const h = new Date().getHours();
    if (h >= peakStart && h < peakEnd) return Number(settings.gaming_peak_multiplier || 1);
    if (h >= offStart && h < offEnd) return Number(settings.gaming_offpeak_multiplier || 1);
    return 1;
  })();
  const deductAmount = Math.ceil(pricePerHour * multiplier / 60);
  const lowThreshold = pricePerHour; // warn when < 1 hour remaining

  connectedClients.forEach((client, socketId) => {
    if (client.status !== 'active' || !client.userId) return;

    const user = db.prepare('SELECT credits, debt, limit_minutes, allowed_seats, post_pay FROM users WHERE id = ?').get(client.userId);
    if (!user) return;

    // Enforce per-session time limit (limit_minutes = 0 → unlimited)
    const sess = db.prepare('SELECT duration FROM sessions WHERE user_id = ? AND end_time IS NULL').get(client.userId);
    if (user.limit_minutes > 0 && sess && sess.duration >= user.limit_minutes) {
      db.prepare('UPDATE sessions SET end_time = CURRENT_TIMESTAMP WHERE user_id = ? AND end_time IS NULL').run(client.userId);
      io.to(socketId).emit('session:end', { reason: 'limit_reached', limit: user.limit_minutes });
      client.status = 'idle'; client.userId = null; client.username = null;
      client.credits = 0; client.sessionStart = null;
      io.emit('clients:update', Array.from(connectedClients.values()));
      return;
    }

    // Split credit consumption equally if multi-seat (allowed_seats > 1):
    // count concurrent active sessions for this user, divide deduction.
    let activeSeatCount = 1;
    if ((user.allowed_seats || 1) > 1) {
      activeSeatCount = Array.from(connectedClients.values())
        .filter(c => c.status === 'active' && c.userId === client.userId).length || 1;
    }
    const perPcDeduct = Math.ceil(deductAmount / activeSeatCount);

    const canPay = user.credits >= perPcDeduct;
    if (canPay || user.post_pay) {
      db.prepare('UPDATE users SET credits = credits - ?, total_minutes = total_minutes + 1 WHERE id = ?')
        .run(perPcDeduct, client.userId);
      // If post-pay and credits went negative, accumulate debt
      if (!canPay && user.post_pay) {
        const overdraft = perPcDeduct - Math.max(0, user.credits);
        db.prepare(`UPDATE users SET debt = debt + ?,
          debt_since = COALESCE(debt_since, CURRENT_TIMESTAMP) WHERE id = ?`)
          .run(overdraft, client.userId);
      }
      db.prepare('UPDATE sessions SET duration = duration + 1 WHERE user_id = ? AND end_time IS NULL')
        .run(client.userId);
      const refreshed = db.prepare('SELECT credits, debt FROM users WHERE id = ?').get(client.userId);
      client.credits = refreshed.credits;
      io.to(socketId).emit('credits:update', { credits: refreshed.credits, debt: refreshed.debt });

      if (refreshed.credits <= lowThreshold && refreshed.credits > 0) {
        io.to(socketId).emit('credits:low', { credits: refreshed.credits });
      }

      io.emit('clients:update', Array.from(connectedClients.values()));
    } else {
      db.prepare('UPDATE sessions SET end_time = CURRENT_TIMESTAMP WHERE user_id = ? AND end_time IS NULL')
        .run(client.userId);
      io.to(socketId).emit('session:end', { reason: 'no_credits' });
      client.status = 'idle';
      client.userId = null;
      client.username = null;
      client.credits = 0;
      client.sessionStart = null;
      io.emit('clients:update', Array.from(connectedClients.values()));
    }
  });
}, 60000);

// Global error middleware — must be LAST. A thrown handler (e.g. an audit
// INSERT that rolled back the surrounding `db.transaction`) lands here and
// is surfaced as a JSON 500 so the admin SPA can render a real message
// rather than an HTML stack trace.
app.use((err, _req, res, _next) => {
  console.error('[express]', err && (err.stack || err.message || err));
  if (res.headersSent) return;
  res.status(500).json({ error: (err && err.message) || 'خطای داخلی سرور' });
});

const adminDistPath = process.env.ADMIN_DIST || require('path').join(__dirname, '..', 'admin', 'dist');
const fs = require('fs');
if (fs.existsSync(adminDistPath)) {
  app.use('/admin', require('express').static(adminDistPath));
  app.get('/admin/*', (req, res) => res.sendFile(require('path').join(adminDistPath, 'index.html')));
}

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

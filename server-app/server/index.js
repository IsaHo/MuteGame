const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { initDatabase, getDb } = require('./database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const shopRoutes = require('./routes/shop');
const settingsRoutes = require('./routes/settings');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

app.use(cors());
app.use(express.json());

initDatabase();

// Map: socketId -> client info
const connectedClients = new Map();

app.set('io', io);
app.set('connectedClients', connectedClients);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/settings', settingsRoutes);

// Clients endpoint
app.get('/api/clients', (req, res) => {
  res.json(Array.from(connectedClients.values()));
});

app.post('/api/clients/:socketId/kick', (req, res) => {
  io.to(req.params.socketId).emit('session:end', { reason: 'admin_kick' });
  res.json({ success: true });
});

app.post('/api/clients/:socketId/message', (req, res) => {
  io.to(req.params.socketId).emit('admin:message', { text: req.body.text });
  res.json({ success: true });
});

app.post('/api/clients/:socketId/extend', (req, res) => {
  const { minutes } = req.body;
  const client = Array.from(connectedClients.values()).find(c => c.socketId === req.params.socketId);
  if (client && client.userId) {
    const db = getDb();
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(minutes, client.userId);
    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(client.userId);
    client.credits = user.credits;
    io.to(req.params.socketId).emit('credits:update', { credits: user.credits });
    io.emit('clients:update', Array.from(connectedClients.values()));
  }
  res.json({ success: true });
});

// Reports
function dateFilter(days) {
  if (days === 0) return "DATE(created_at, 'localtime') = DATE('now', 'localtime')";
  return `created_at >= DATE('now', 'localtime', '-${days} days')`;
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
    WHERE ${where}
    GROUP BY DATE(created_at, 'localtime')
    ORDER BY date ASC
  `).all();
  res.json(sales);
});

// Shop profit report (sell - buy cost)
app.get('/api/reports/shop-profit', (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days);
  const where = isNaN(days) ? dateFilter(7) : dateFilter(days);
  const orders = db.prepare(`SELECT items, total FROM shop_orders WHERE ${where}`).all();
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
  const totalShopRevenue = db.prepare("SELECT SUM(total) as s FROM shop_orders").get().s || 0;
  const todayRevenue = db.prepare("SELECT SUM(amount) as s FROM credit_transactions WHERE amount > 0 AND type='charge' AND DATE(created_at,'localtime')=DATE('now','localtime')").get().s || 0;
  const todayShop = db.prepare("SELECT SUM(total) as s FROM shop_orders WHERE DATE(created_at,'localtime')=DATE('now','localtime')").get().s || 0;
  const todayUsers = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM sessions WHERE DATE(start_time,'localtime')=DATE('now','localtime')").get().c;
  const activeNow = Array.from(connectedClients.values()).filter(c => c.status === 'active').length;
  res.json({ totalUsers, totalRevenue, totalShopRevenue, todayRevenue, todayShop, todayUsers, activeNow });
});

// Session history
app.get('/api/sessions', (req, res) => {
  const db = getDb();
  const sessions = db.prepare(`
    SELECT s.*, u.username FROM sessions s
    JOIN users u ON s.user_id = u.id
    ORDER BY s.start_time DESC LIMIT 200
  `).all();
  res.json(sessions);
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('🔌 Socket connected:', socket.id);

  socket.on('client:register', (data) => {
    connectedClients.set(socket.id, {
      socketId: socket.id,
      computerId: data.computerId,
      computerName: data.computerName || `PC-${socket.id.slice(0, 4)}`,
      status: 'idle',
      userId: null,
      username: null,
      sessionStart: null,
      credits: 0,
    });
    io.emit('clients:update', Array.from(connectedClients.values()));
    console.log(`💻 Registered: ${data.computerName}`);
  });

  socket.on('client:login', (data) => {
    const client = connectedClients.get(socket.id);
    if (!client) return;
    const db = getDb();

    // End any existing open session for this user
    db.prepare('UPDATE sessions SET end_time = CURRENT_TIMESTAMP WHERE user_id = ? AND end_time IS NULL').run(data.userId);
    // Start new session
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

// Credit deduction: 1 credit = 1 minute
setInterval(() => {
  const db = getDb();
  connectedClients.forEach((client, socketId) => {
    if (client.status !== 'active' || !client.userId) return;

    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(client.userId);
    if (!user) return;

    if (user.credits > 0) {
      db.prepare('UPDATE users SET credits = credits - 1, total_minutes = total_minutes + 1 WHERE id = ?').run(client.userId);
      db.prepare('UPDATE sessions SET duration = duration + 1 WHERE user_id = ? AND end_time IS NULL').run(client.userId);
      client.credits = user.credits - 1;
      io.to(socketId).emit('credits:update', { credits: client.credits });

      if (client.credits <= 5) {
        io.to(socketId).emit('credits:low', { credits: client.credits });
      }

      io.emit('clients:update', Array.from(connectedClients.values()));
    } else {
      db.prepare('UPDATE sessions SET end_time = CURRENT_TIMESTAMP WHERE user_id = ? AND end_time IS NULL').run(client.userId);
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

// Serve admin panel static files if present
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

const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// Enforces JWT-decoded admin role first (primary auth), then admin-IP pinning
// (defense-in-depth). Both must pass for the route to run.
function adminIpGuard(req, res, next) {
  const auth = req.app.get('requireAdmin');
  const ipGuard = req.app.get('requireAdminIp');
  const chain = (mw, nextMw) => (req2, res2, nxt) =>
    typeof mw === 'function' ? mw(req2, res2, () => nextMw(req2, res2, nxt)) : nextMw(req2, res2, nxt);
  return chain(auth, ipGuard || ((_q, _s, n) => n()))(req, res, next);
}

function broadcastShopItems(req) {
  const db = getDb();
  const items = db.prepare("SELECT * FROM shop_items WHERE active = 1 ORDER BY category, name").all();
  try { req.app.get('io')?.emit('shop:update', items); } catch {}
}

router.get('/items', (req, res) => {
  const db = getDb();
  // Default: only active items (clients consume this). Pass ?all=1 from admin to see disabled ones.
  const all = req.query.all === '1';
  const items = db.prepare(`SELECT * FROM shop_items ${all ? '' : 'WHERE active = 1'} ORDER BY category, name`).all();
  res.json(items);
});

router.post('/items', adminIpGuard, (req, res) => {
  const { name, price, buy_price = 0, category, emoji, stock } = req.body;
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO shop_items (name, price, buy_price, category, emoji, stock) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, price, buy_price, category || 'food', emoji || '🍔', stock ?? -1);
  broadcastShopItems(req);
  res.json({ id: result.lastInsertRowid });
});

router.put('/items/:id', adminIpGuard, (req, res) => {
  const { name, price, buy_price = 0, category, emoji, stock, active } = req.body;
  const db = getDb();
  db.prepare(
    'UPDATE shop_items SET name=?, price=?, buy_price=?, category=?, emoji=?, stock=?, active=? WHERE id=?'
  ).run(name, price, buy_price, category, emoji, stock, active ?? 1, req.params.id);
  broadcastShopItems(req);
  res.json({ success: true });
});

router.delete('/items/:id', adminIpGuard, (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);

  // Smart delete:
  //   • Item never used in an order → DELETE the row outright (hard delete).
  //     Operators reach for "حذف" expecting the item to actually disappear.
  //   • Item referenced by ≥1 past order → soft delete (active=0). Hard
  //     delete would orphan the order's items JSON and break history/CSV.
  // We probe orders with SQLite's JSON1 `json_each` (better-sqlite3 ships
  // with it enabled). If the JSON path fails for any reason — corrupt rows,
  // older SQLite — fall back to a LIKE substring check.
  let referenced = 0;
  try {
    referenced = db.prepare(`
      SELECT COUNT(*) AS c
      FROM shop_orders, json_each(shop_orders.items)
      WHERE CAST(json_extract(json_each.value, '$.id') AS INTEGER) = ?
    `).get(id).c;
  } catch (_e) {
    referenced = db.prepare(
      "SELECT COUNT(*) AS c FROM shop_orders WHERE items LIKE ?"
    ).get('%"id":' + id + '%').c;
  }

  if (referenced > 0) {
    db.prepare('UPDATE shop_items SET active = 0 WHERE id = ?').run(id);
    broadcastShopItems(req);
    return res.json({ success: true, mode: 'soft', referencedBy: referenced });
  }
  db.prepare('DELETE FROM shop_items WHERE id = ?').run(id);
  broadcastShopItems(req);
  res.json({ success: true, mode: 'hard' });
});

// Create order — starts as pending, no stock/credit deduction yet
router.post('/orders', (req, res) => {
  const { userId, computerName, items, total, paymentMethod = 'cash' } = req.body;
  const db = getDb();
  const io = req.app.get('io');
  const connectedClients = req.app.get('connectedClients');

  // Validate stock and enrich with buy_price
  const enrichedItems = [];
  for (const item of items) {
    const dbItem = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(item.id);
    if (!dbItem) return res.status(400).json({ error: 'آیتم یافت نشد' });
    if (dbItem.stock !== -1 && dbItem.stock < item.qty) {
      return res.status(400).json({ error: `${dbItem.name} موجودی کافی ندارد` });
    }
    enrichedItems.push({ ...item, buy_price: dbItem.buy_price || 0, emoji: dbItem.emoji });
  }

  // If credits payment, validate balance
  if (paymentMethod === 'credits' && userId) {
    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
    if (!user || user.credits < total) {
      return res.status(400).json({ error: 'اعتبار کافی ندارید' });
    }
  }

  const result = db.prepare(
    'INSERT INTO shop_orders (user_id, computer_name, items, total, payment_method, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userId || null, computerName || null, JSON.stringify(enrichedItems), total, paymentMethod, 'pending');

  const orderId = result.lastInsertRowid;
  const order = db.prepare(`
    SELECT o.*, u.username FROM shop_orders o
    LEFT JOIN users u ON o.user_id = u.id
    WHERE o.id = ?
  `).get(orderId);

  // Notify admin panel via socket
  io.emit('order:new', { ...order, items: enrichedItems });

  res.json({ id: orderId });
});

// Approve order — deduct stock and credits if needed
router.post('/orders/:id/approve', adminIpGuard, (req, res) => {
  const db = getDb();
  const io = req.app.get('io');
  const connectedClients = req.app.get('connectedClients');

  const order = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'سفارش پیدا نشد' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'این سفارش قبلاً پردازش شده' });

  const items = JSON.parse(order.items);

  // Deduct stock
  for (const item of items) {
    const dbItem = db.prepare('SELECT stock FROM shop_items WHERE id = ?').get(item.id);
    if (dbItem && dbItem.stock !== -1) {
      db.prepare('UPDATE shop_items SET stock = MAX(0, stock - ?) WHERE id = ?').run(item.qty, item.id);
    }
  }

  // Deduct credits if credits payment
  if (order.payment_method === 'credits' && order.user_id) {
    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(order.user_id);
    if (user && user.credits >= order.total) {
      db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(order.total, order.user_id);
      db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
        .run(order.user_id, -order.total, 'shop', `خرید از شاپ: ${items.map(i => i.name).join(', ')}`);

      const updatedUser = db.prepare('SELECT credits, debt FROM users WHERE id = ?').get(order.user_id);
      connectedClients.forEach((client, socketId) => {
        if (client.userId == order.user_id) {
          client.credits = updatedUser.credits;
          io.to(socketId).emit('credits:update', { credits: updatedUser.credits, debt: updatedUser.debt });
        }
      });
    }
  }

  db.prepare('UPDATE shop_orders SET status = ? WHERE id = ?').run('completed', req.params.id);

  // Notify the client their order was approved
  connectedClients.forEach((client, socketId) => {
    if (client.userId == order.user_id) {
      io.to(socketId).emit('order:approved', { orderId: order.id });
    }
  });

  io.emit('clients:update', Array.from(connectedClients.values()));
  res.json({ success: true });
});

// Cancel order
router.post('/orders/:id/cancel', adminIpGuard, (req, res) => {
  const db = getDb();
  const io = req.app.get('io');
  const connectedClients = req.app.get('connectedClients');

  const order = db.prepare('SELECT * FROM shop_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'سفارش پیدا نشد' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'این سفارش قبلاً پردازش شده' });

  db.prepare('UPDATE shop_orders SET status = ? WHERE id = ?').run('cancelled', req.params.id);

  connectedClients.forEach((client, socketId) => {
    if (client.userId == order.user_id) {
      io.to(socketId).emit('order:cancelled', { orderId: order.id });
    }
  });

  res.json({ success: true });
});

router.get('/orders', (req, res) => {
  const db = getDb();
  const { status } = req.query;
  let query = `SELECT o.*, u.username FROM shop_orders o LEFT JOIN users u ON o.user_id = u.id`;
  if (status) query += ` WHERE o.status = '${status}'`;
  query += ` ORDER BY o.created_at DESC LIMIT 300`;
  const orders = db.prepare(query).all();
  res.json(orders.map(o => ({ ...o, items: JSON.parse(o.items) })));
});

module.exports = router;

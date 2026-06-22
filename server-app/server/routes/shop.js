const express = require('express');
const router = express.Router();
const { getDb } = require('../database');
const billing = require('../billing');
const { audit } = require('../audit');

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
  let result;
  db.transaction(() => {
    result = db.prepare(
      'INSERT INTO shop_items (name, price, buy_price, category, emoji, stock) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, price, buy_price, category || 'food', emoji || '🍔', stock ?? -1);
    audit(req, 'shop.item.create', 'shop_item', result.lastInsertRowid, { name, price, buy_price, category, stock });
  })();
  broadcastShopItems(req);
  res.json({ id: result.lastInsertRowid });
});

router.put('/items/:id', adminIpGuard, (req, res) => {
  const { name, price, buy_price = 0, category, emoji, stock, active } = req.body;
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      'UPDATE shop_items SET name=?, price=?, buy_price=?, category=?, emoji=?, stock=?, active=? WHERE id=?'
    ).run(name, price, buy_price, category, emoji, stock, active ?? 1, req.params.id);
    audit(req, 'shop.item.update', 'shop_item', req.params.id, { name, price, buy_price, category, stock, active });
  })();
  broadcastShopItems(req);
  res.json({ success: true });
});

router.delete('/items/:id', adminIpGuard, (req, res) => {
  const db = getDb();
  // Soft-delete (preserves history for past orders) but the broadcast list
  // filters active=1 so the client immediately sees it disappear.
  db.transaction(() => {
    db.prepare('UPDATE shop_items SET active = 0 WHERE id = ?').run(req.params.id);
    audit(req, 'shop.item.delete', 'shop_item', req.params.id, { mode: 'soft' });
  })();
  broadcastShopItems(req);
  res.json({ success: true });
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
  let chargeResult = null;
  const adminCtx = { admin_id: req.admin && req.admin.id };

  try {
    db.transaction(() => {
      for (const item of items) {
        const dbItem = db.prepare('SELECT stock FROM shop_items WHERE id = ?').get(item.id);
        if (dbItem && dbItem.stock !== -1) {
          db.prepare('UPDATE shop_items SET stock = MAX(0, stock - ?) WHERE id = ?').run(item.qty, item.id);
        }
      }

      if (order.payment_method === 'credits' && order.user_id) {
        chargeResult = billing.chargeUser(db, {
          user_id: order.user_id,
          amount: order.total,
          event_type: 'shop',
          mode: 'strict',
          description: 'خرید از شاپ: ' + items.map(i => i.name).join(', '),
          ctx: adminCtx,
        });
      }

      db.prepare('UPDATE shop_orders SET status = ? WHERE id = ?').run('completed', req.params.id);
      audit(req, 'shop.order.approve', 'shop_order', req.params.id, {
        total: order.total,
        payment_method: order.payment_method,
        user_id: order.user_id,
        items: items.map(i => ({ id: i.id, name: i.name, qty: i.qty, price: i.price })),
        credits_deducted: chargeResult ? order.total : 0,
      });
    })();
  } catch (e) {
    if (e.code === 'INSUFFICIENT_FUNDS') {
      return res.status(400).json({
        error: 'اعتبار کافی نیست',
        shortfall: e.shortfall,
        user_id: e.user_id,
      });
    }
    console.error('[shop.approve]', e.stack || e.message);
    return res.status(500).json({ error: e.message || 'خطای داخلی' });
  }

  if (chargeResult) {
    connectedClients.forEach((client, socketId) => {
      if (client.userId == order.user_id) {
        client.credits = chargeResult.c_after;
        client.debt = chargeResult.d_after;
        io.to(socketId).emit('credits:update', { credits: chargeResult.c_after, debt: chargeResult.d_after });
      }
    });
  }
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

  db.transaction(() => {
    db.prepare('UPDATE shop_orders SET status = ? WHERE id = ?').run('cancelled', req.params.id);
    audit(req, 'shop.order.cancel', 'shop_order', req.params.id, { total: order.total, user_id: order.user_id });
  })();

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

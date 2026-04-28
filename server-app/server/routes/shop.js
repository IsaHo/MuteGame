const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

router.get('/items', (req, res) => {
  const db = getDb();
  const items = db.prepare('SELECT * FROM shop_items ORDER BY category, name').all();
  res.json(items);
});

router.post('/items', (req, res) => {
  const { name, price, buy_price = 0, category, emoji, stock } = req.body;
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO shop_items (name, price, buy_price, category, emoji, stock) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, price, buy_price, category || 'food', emoji || '🍔', stock ?? -1);
  res.json({ id: result.lastInsertRowid });
});

router.put('/items/:id', (req, res) => {
  const { name, price, buy_price = 0, category, emoji, stock, active } = req.body;
  const db = getDb();
  db.prepare(
    'UPDATE shop_items SET name=?, price=?, buy_price=?, category=?, emoji=?, stock=?, active=? WHERE id=?'
  ).run(name, price, buy_price, category, emoji, stock, active ?? 1, req.params.id);
  res.json({ success: true });
});

router.delete('/items/:id', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE shop_items SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

router.post('/orders', (req, res) => {
  const { userId, computerName, items, total, paymentMethod = 'cash' } = req.body;
  const db = getDb();
  const io = req.app.get('io');
  const connectedClients = req.app.get('connectedClients');

  // Validate stock + enrich items with buy_price
  const enrichedItems = [];
  for (const item of items) {
    const dbItem = db.prepare('SELECT * FROM shop_items WHERE id = ?').get(item.id);
    if (!dbItem) return res.status(400).json({ error: 'آیتم یافت نشد' });
    if (dbItem.stock !== -1 && dbItem.stock < item.qty) {
      return res.status(400).json({ error: `${dbItem.name} موجودی کافی ندارد` });
    }
    if (dbItem.stock !== -1) {
      db.prepare('UPDATE shop_items SET stock = stock - ? WHERE id = ?').run(item.qty, item.id);
    }
    enrichedItems.push({ ...item, buy_price: dbItem.buy_price || 0 });
  }

  if (paymentMethod === 'credits' && userId) {
    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
    if (!user || user.credits < total) {
      return res.status(400).json({ error: 'اعتبار کافی ندارید' });
    }
    db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(total, userId);
    db.prepare('INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)')
      .run(userId, -total, 'shop', `خرید از شاپ: ${items.map(i => i.name).join(', ')}`);

    const updatedUser = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
    connectedClients.forEach((client, socketId) => {
      if (client.userId == userId) {
        client.credits = updatedUser.credits;
        io.to(socketId).emit('credits:update', { credits: updatedUser.credits });
      }
    });
  }

  const result = db.prepare(
    'INSERT INTO shop_orders (user_id, computer_name, items, total, payment_method) VALUES (?, ?, ?, ?, ?)'
  ).run(userId || null, computerName || null, JSON.stringify(enrichedItems), total, paymentMethod);
  res.json({ id: result.lastInsertRowid });
});

router.get('/orders', (req, res) => {
  const db = getDb();
  const orders = db.prepare(`
    SELECT o.*, u.username FROM shop_orders o
    LEFT JOIN users u ON o.user_id = u.id
    ORDER BY o.created_at DESC LIMIT 200
  `).all();
  res.json(orders.map(o => ({ ...o, items: JSON.parse(o.items) })));
});

module.exports = router;

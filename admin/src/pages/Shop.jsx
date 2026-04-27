import { useEffect, useState } from 'react';
import { api, formatRial, formatDate } from '../api';

const CATS = { all: 'همه', food: '🍔 غذا', drink: '🥤 نوشیدنی', snack: '🍟 اسنک' };
const emptyItem = { name: '', price: '', category: 'food', emoji: '🍔', stock: -1, active: 1 };

export default function Shop({ addToast }) {
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [catFilter, setCatFilter] = useState('all');
  const [tab, setTab] = useState('pos'); // pos | items | orders
  const [itemModal, setItemModal] = useState(null);
  const [form, setForm] = useState(emptyItem);
  const [payMethod, setPayMethod] = useState('cash');
  const [pcName, setPcName] = useState('');
  const [loading, setLoading] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');

  const load = async () => {
    const [its, ords] = await Promise.all([api.getShopItems(), api.getOrders()]);
    setItems(its);
    setOrders(ords);
  };

  useEffect(() => { load(); }, []);

  const filtered = items.filter(it => it.active && (catFilter === 'all' || it.category === catFilter));

  const addToCart = (item) => {
    setCart(c => {
      const ex = c.find(x => x.id === item.id);
      if (ex) return c.map(x => x.id === item.id ? { ...x, qty: x.qty + 1 } : x);
      return [...c, { ...item, qty: 1 }];
    });
  };

  const removeFromCart = (id) => setCart(c => c.filter(x => x.id !== id));
  const changeQty = (id, delta) => {
    setCart(c => c.map(x => x.id === id ? { ...x, qty: Math.max(1, x.qty + delta) } : x).filter(x => x.qty > 0));
  };

  const total = cart.reduce((s, x) => s + x.price * x.qty, 0);

  const checkout = async () => {
    if (!cart.length) return addToast('سبد خرید خالی است', 'error');
    setLoading(true);
    try {
      await api.createOrder({ computerName: pcName || null, items: cart.map(x => ({ id: x.id, name: x.name, qty: x.qty, price: x.price })), total, paymentMethod: payMethod });
      await load();
      setCart([]);
      setPcName('');
      addToast(`سفارش ثبت شد - ${formatRial(total)} ✅`, 'success');
    } catch (e) { addToast(e.message, 'error'); }
    setLoading(false);
  };

  const openAddItem = () => { setForm(emptyItem); setItemModal('create'); };
  const openEditItem = (it) => { setForm({ ...it }); setItemModal(it.id); };

  const saveItem = async () => {
    if (!form.name || !form.price) return addToast('نام و قیمت الزامی است', 'error');
    setLoading(true);
    try {
      if (itemModal === 'create') {
        await api.createShopItem(form);
        addToast('آیتم اضافه شد ✅', 'success');
      } else {
        await api.updateShopItem(itemModal, form);
        addToast('آیتم ویرایش شد ✅', 'success');
      }
      await load();
      setItemModal(null);
    } catch (e) { addToast(e.message, 'error'); }
    setLoading(false);
  };

  const deleteItem = async (id) => {
    if (!confirm('این آیتم غیرفعال بشه?')) return;
    try { await api.deleteShopItem(id); await load(); addToast('حذف شد', 'success'); } catch (e) { addToast(e.message, 'error'); }
  };

  const todaySales = orders.filter(o => new Date(o.created_at).toDateString() === new Date().toDateString()).reduce((s, o) => s + o.total, 0);
  const totalSales = orders.reduce((s, o) => s + o.total, 0);

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">🛒 شاپ گیم‌نت</span>
        <div className="topbar-right">
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>فروش امروز: <strong style={{ color: 'var(--green)' }}>{formatRial(todaySales)}</strong></span>
          <div style={{ display: 'flex', gap: 4 }}>
            {['pos', 'items', 'orders'].map(t => (
              <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t)}>
                {t === 'pos' ? '🛒 فروش' : t === 'items' ? '📦 موجودی' : '📋 سفارشات'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24 }}>
        {/* POS */}
        {tab === 'pos' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
            {/* Items */}
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {Object.entries(CATS).map(([k, v]) => (
                  <button key={k} className={`btn btn-sm ${catFilter === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCatFilter(k)}>{v}</button>
                ))}
              </div>
              <div className="shop-grid">
                {filtered.map(it => {
                  const inCart = cart.find(x => x.id === it.id);
                  return (
                    <div key={it.id} className={`shop-item ${inCart ? 'selected' : ''}`} onClick={() => addToCart(it)}>
                      {inCart && <div className="cart-badge">{inCart.qty}</div>}
                      <span className="shop-emoji">{it.emoji}</span>
                      <div className="shop-name">{it.name}</div>
                      <div className="shop-price">{formatRial(it.price)}</div>
                      {it.stock !== -1 && <div className="shop-stock">موجودی: {it.stock}</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Cart */}
            <div className="card" style={{ position: 'sticky', top: 80 }}>
              <div className="flex-between mb-16">
                <h3 style={{ fontWeight: 700, fontSize: 15 }}>🧾 سبد خرید</h3>
                {cart.length > 0 && <button className="btn btn-red btn-sm" onClick={() => setCart([])}>🗑 پاک</button>}
              </div>

              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text3)', fontSize: 13 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🛒</div>
                  آیتمی انتخاب نشده
                </div>
              ) : (
                <div style={{ marginBottom: 16 }}>
                  {cart.map(item => (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 20 }}>{item.emoji}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{item.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{formatRial(item.price)} × {item.qty}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }} onClick={() => changeQty(item.id, -1)}>-</button>
                        <span style={{ fontWeight: 700, minWidth: 20, textAlign: 'center', fontSize: 13 }}>{item.qty}</span>
                        <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }} onClick={() => changeQty(item.id, 1)}>+</button>
                        <button className="btn btn-red btn-sm" style={{ padding: '2px 6px' }} onClick={() => removeFromCart(item.id)}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <label className="label">شماره PC (اختیاری)</label>
                <input className="input" placeholder="مثلا PC-01" value={pcName} onChange={e => setPcName(e.target.value)} />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label className="label">روش پرداخت</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className={`btn btn-sm ${payMethod === 'cash' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPayMethod('cash')}>💵 نقدی</button>
                  <button className={`btn btn-sm ${payMethod === 'card' ? 'btn-cyan' : 'btn-ghost'}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPayMethod('card')}>💳 کارت</button>
                </div>
              </div>

              <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: '12px 14px', marginBottom: 14, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text3)', fontSize: 13 }}>تعداد آیتم</span>
                  <span style={{ fontWeight: 700 }}>{cart.reduce((s, x) => s + x.qty, 0)} عدد</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text3)', fontSize: 13 }}>مبلغ کل</span>
                  <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--green)' }}>{formatRial(total)}</span>
                </div>
              </div>

              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px' }} onClick={checkout} disabled={loading || !cart.length}>
                {loading ? '⏳...' : '✅ ثبت سفارش'}
              </button>
            </div>
          </div>
        )}

        {/* Items Management */}
        {tab === 'items' && (
          <div>
            <div className="flex-between mb-16">
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>{items.length} آیتم</span>
              <button className="btn btn-primary btn-sm" onClick={openAddItem}>➕ آیتم جدید</button>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>آیتم</th><th>دسته</th><th>قیمت</th><th>موجودی</th><th>وضعیت</th><th>عملیات</th></tr></thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={it.id}>
                        <td><span style={{ fontSize: 20, marginLeft: 8 }}>{it.emoji}</span>{it.name}</td>
                        <td><span className="badge badge-gray">{CATS[it.category] || it.category}</span></td>
                        <td style={{ fontWeight: 700, color: 'var(--cyan)' }}>{formatRial(it.price)}</td>
                        <td>{it.stock === -1 ? <span style={{ color: 'var(--text3)' }}>نامحدود</span> : <span style={{ fontWeight: 700 }}>{it.stock}</span>}</td>
                        <td>{it.active ? <span className="badge badge-green">فعال</span> : <span className="badge badge-red">غیرفعال</span>}</td>
                        <td>
                          <div className="btn-group">
                            <button className="btn btn-ghost btn-sm" onClick={() => openEditItem(it)}>✏️ ویرایش</button>
                            <button className="btn btn-red btn-sm" onClick={() => deleteItem(it.id)}>🗑</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Orders */}
        {tab === 'orders' && (
          <div>
            <div className="search-bar mb-16">
              <input className="input search-input" placeholder="🔍 جستجو..." value={orderSearch} onChange={e => setOrderSearch(e.target.value)} />
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>کل فروش: <strong style={{ color: 'var(--green)' }}>{formatRial(totalSales)}</strong></span>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>تاریخ</th><th>PC</th><th>کاربر</th><th>آیتم‌ها</th><th>مبلغ</th><th>پرداخت</th></tr></thead>
                  <tbody>
                    {orders.filter(o => !orderSearch || (o.computer_name || '').includes(orderSearch) || (o.username || '').includes(orderSearch)).map(o => (
                      <tr key={o.id}>
                        <td style={{ fontSize: 12, color: 'var(--text3)' }}>{formatDate(o.created_at)}</td>
                        <td>{o.computer_name || '-'}</td>
                        <td>{o.username || <span style={{ color: 'var(--text3)' }}>-</span>}</td>
                        <td style={{ fontSize: 12 }}>{o.items.map(i => `${i.emoji || ''} ${i.name}×${i.qty}`).join(' | ')}</td>
                        <td style={{ fontWeight: 700, color: 'var(--green)' }}>{formatRial(o.total)}</td>
                        <td><span className={`badge ${o.payment_method === 'credits' ? 'badge-purple' : o.payment_method === 'card' ? 'badge-cyan' : 'badge-green'}`}>{o.payment_method === 'credits' ? '⭐ اعتبار' : o.payment_method === 'card' ? '💳 کارت' : '💵 نقدی'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Item Modal */}
      {itemModal !== null && (
        <div className="modal-overlay" onClick={() => setItemModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{itemModal === 'create' ? '➕ آیتم جدید' : '✏️ ویرایش آیتم'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group" style={{ gridColumn: '1/3' }}>
                <label className="label">نام آیتم</label>
                <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="نام غذا یا نوشیدنی" />
              </div>
              <div className="form-group">
                <label className="label">قیمت (ریال)</label>
                <input className="input" type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} placeholder="10000" />
              </div>
              <div className="form-group">
                <label className="label">ایموجی</label>
                <input className="input" value={form.emoji} onChange={e => setForm(p => ({ ...p, emoji: e.target.value }))} maxLength={2} />
              </div>
              <div className="form-group">
                <label className="label">دسته‌بندی</label>
                <select className="input" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                  <option value="food">🍔 غذا</option>
                  <option value="drink">🥤 نوشیدنی</option>
                  <option value="snack">🍟 اسنک</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">موجودی (-۱ = نامحدود)</label>
                <input className="input" type="number" value={form.stock} onChange={e => setForm(p => ({ ...p, stock: Number(e.target.value) }))} min={-1} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setItemModal(null)}>لغو</button>
              <button className="btn btn-primary" onClick={saveItem} disabled={loading}>{loading ? '⏳...' : '✅ ذخیره'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

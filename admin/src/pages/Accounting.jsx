import { useEffect, useState, useRef } from 'react';
import { api, formatRial, formatDate } from '../api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const EXPENSES_KEY = 'mg_expenses';

function loadExpenses() {
  try { return JSON.parse(localStorage.getItem(EXPENSES_KEY) || '[]'); } catch { return []; }
}
function saveExpenses(list) { localStorage.setItem(EXPENSES_KEY, JSON.stringify(list)); }

const EXPENSE_CATS = ['اجاره', 'برق', 'اینترنت', 'حقوق', 'تجهیزات', 'شاپ (خرید)', 'تعمیرات', 'سایر'];

export default function Accounting({ addToast }) {
  const [period, setPeriod] = useState(30);
  const [revenueData, setRevenueData] = useState([]);
  const [shopData, setShopData] = useState([]);
  const [shopProfit, setShopProfit] = useState({});
  const [stats, setStats] = useState({});
  const [expenses, setExpenses] = useState(loadExpenses());
  const [tab, setTab] = useState('overview'); // overview | income | expenses | cashflow | print
  const [expForm, setExpForm] = useState({ date: new Date().toISOString().split('T')[0], category: 'سایر', desc: '', amount: '' });
  const [editExpIdx, setEditExpIdx] = useState(null);
  const [orders, setOrders] = useState([]);
  const [txns, setTxns] = useState([]);
  const printRef = useRef();

  const load = async () => {
    try {
      const [rev, shop, st, ords, profit] = await Promise.all([
        api.getRevenueReport(period),
        api.getShopReport(period),
        api.getStats(),
        api.getOrders(),
        api.getShopProfit(period),
      ]);
      setRevenueData(rev);
      setShopData(shop);
      setStats(st);
      setOrders(ords);
      setShopProfit(profit);

      // Load transactions for income detail
      const users = await api.getUsers();
      const allTxns = await Promise.all(users.map(u => api.getUserTransactions(u.id).then(t => t.map(tx => ({ ...tx, username: u.username })))));
      setTxns(allTxns.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); }, [period]);

  const totalChargeRevenue = revenueData.reduce((s, d) => s + (d.charged || 0), 0);
  const totalShopRevenue = shopData.reduce((s, d) => s + (d.revenue || 0), 0);
  const totalIncome = totalChargeRevenue + totalShopRevenue;

  const periodExpenses = expenses.filter(e => {
    if (period === 0) return e.date === new Date().toISOString().split('T')[0];
    const eDate = new Date(e.date);
    const from = new Date(); from.setDate(from.getDate() - period);
    return eDate >= from;
  });
  const totalExpenses = periodExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const netProfit = totalIncome - totalExpenses;

  // Merge chart data
  const chartDates = [...new Set([...revenueData.map(d => d.date), ...shopData.map(d => d.date)])].sort();
  const combinedChart = chartDates.map(date => ({
    date,
    شارژ: revenueData.find(d => d.date === date)?.charged || 0,
    شاپ: shopData.find(d => d.date === date)?.revenue || 0,
  }));

  const pieData = [
    { name: 'درآمد شارژ', value: totalChargeRevenue, color: '#7c3aed' },
    { name: 'فروش شاپ', value: totalShopRevenue, color: '#06b6d4' },
    { name: 'هزینه‌ها', value: totalExpenses, color: '#ef4444' },
  ].filter(d => d.value > 0);

  const expByCat = EXPENSE_CATS.map(cat => ({
    name: cat,
    value: periodExpenses.filter(e => e.category === cat).reduce((s, e) => s + Number(e.amount), 0),
  })).filter(d => d.value > 0);

  const addExpense = () => {
    if (!expForm.desc || !expForm.amount) return addToast('توضیح و مبلغ الزامی است', 'error');
    let updated;
    if (editExpIdx !== null) {
      updated = expenses.map((e, i) => i === editExpIdx ? { ...expForm } : e);
      setEditExpIdx(null);
    } else {
      updated = [{ ...expForm, id: Date.now() }, ...expenses];
    }
    saveExpenses(updated);
    setExpenses(updated);
    setExpForm({ date: new Date().toISOString().split('T')[0], category: 'سایر', desc: '', amount: '' });
    addToast('هزینه ثبت شد ✅', 'success');
  };

  const deleteExp = (idx) => {
    if (!confirm('این هزینه حذف بشه؟')) return;
    const updated = expenses.filter((_, i) => i !== idx);
    saveExpenses(updated); setExpenses(updated);
    addToast('هزینه حذف شد', 'success');
  };

  const handlePrint = () => {
    const win = window.open('', '_blank');
    win.document.write(`
      <html dir="rtl"><head><meta charset="UTF-8"><title>گزارش حسابداری MuteGame</title>
      <style>
        body { font-family: Tahoma, Arial; direction: rtl; padding: 30px; color: #111; }
        h1 { color: #7c3aed; text-align: center; margin-bottom: 8px; }
        .sub { text-align: center; color: #666; margin-bottom: 30px; font-size: 13px; }
        .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
        .box { border: 1px solid #ddd; border-radius: 8px; padding: 16px; }
        .box h3 { font-size: 13px; color: #666; margin-bottom: 6px; }
        .box .val { font-size: 22px; font-weight: bold; }
        .green { color: #10b981; } .red { color: #ef4444; } .purple { color: #7c3aed; } .blue { color: #0891b2; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
        th { background: #f3f4f6; padding: 10px; text-align: right; border: 1px solid #e5e7eb; }
        td { padding: 9px; border: 1px solid #e5e7eb; }
        h2 { font-size: 16px; margin: 24px 0 12px; border-bottom: 2px solid #7c3aed; padding-bottom: 6px; }
        .profit { font-size: 20px; font-weight: bold; padding: 16px; border-radius: 8px; text-align: center; margin-bottom: 24px; }
        .profit.pos { background: #d1fae5; color: #065f46; border: 2px solid #10b981; }
        .profit.neg { background: #fee2e2; color: #991b1b; border: 2px solid #ef4444; }
      </style></head><body>
      <h1>🎮 گزارش مالی MuteGame</h1>
      <p class="sub">بازه: ${period === 0 ? 'امروز' : period + ' روز اخیر'} | تاریخ چاپ: ${new Date().toLocaleDateString('fa-IR')}</p>

      <div class="grid">
        <div class="box"><h3>درآمد شارژ</h3><div class="val purple">${totalChargeRevenue.toLocaleString('fa-IR')} ریال</div></div>
        <div class="box"><h3>درآمد شاپ</h3><div class="val blue">${totalShopRevenue.toLocaleString('fa-IR')} ریال</div></div>
        <div class="box"><h3>کل درآمد</h3><div class="val green">${totalIncome.toLocaleString('fa-IR')} ریال</div></div>
        <div class="box"><h3>کل هزینه</h3><div class="val red">${totalExpenses.toLocaleString('fa-IR')} ریال</div></div>
      </div>

      <div class="profit ${netProfit >= 0 ? 'pos' : 'neg'}">
        سود خالص: ${netProfit.toLocaleString('fa-IR')} ریال ${netProfit >= 0 ? '✅' : '⚠️'}
      </div>

      <h2>📊 جزئیات درآمد روزانه</h2>
      <table><thead><tr><th>تاریخ</th><th>شارژ (ریال)</th><th>شاپ (ریال)</th><th>جمع (ریال)</th></tr></thead><tbody>
        ${combinedChart.map(d => `<tr><td>${d.date}</td><td>${d.شارژ.toLocaleString('fa-IR')}</td><td>${d.شاپ.toLocaleString('fa-IR')}</td><td>${(d.شارژ + d.شاپ).toLocaleString('fa-IR')}</td></tr>`).join('')}
      </tbody></table>

      <h2>💸 هزینه‌های ثبت‌شده</h2>
      <table><thead><tr><th>تاریخ</th><th>دسته</th><th>توضیح</th><th>مبلغ (ریال)</th></tr></thead><tbody>
        ${periodExpenses.length === 0 ? '<tr><td colspan="4" style="text-align:center">هزینه‌ای ثبت نشده</td></tr>' : periodExpenses.map(e => `<tr><td>${e.date}</td><td>${e.category}</td><td>${e.desc}</td><td>${Number(e.amount).toLocaleString('fa-IR')}</td></tr>`).join('')}
      </tbody></table>

      </body></html>
    `);
    win.document.close();
    win.print();
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', fontSize: 12, direction: 'rtl' }}>
        <p style={{ color: 'var(--text3)', marginBottom: 6 }}>{label}</p>
        {payload.map(p => (
          <p key={p.name} style={{ color: p.fill, fontWeight: 700 }}>{p.name}: {formatRial(p.value)}</p>
        ))}
      </div>
    );
  };

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">📒 حسابداری</span>
        <div className="topbar-right">
          <div style={{ display: 'flex', gap: 4 }}>
            <button className={`btn btn-sm ${period === 0 ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPeriod(0)}>امروز</button>
            {[7, 30, 90].map(d => (
              <button key={d} className={`btn btn-sm ${period === d ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPeriod(d)}>{d} روز</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['overview', '📊 خلاصه'], ['income', '💰 درآمد'], ['expenses', '💸 هزینه'], ['cashflow', '🔄 جریان نقدی']].map(([t, l]) => (
              <button key={t} className={`btn btn-sm ${tab === t ? 'btn-cyan' : 'btn-ghost'}`} onClick={() => setTab(t)}>{l}</button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handlePrint}>🖨️ چاپ گزارش</button>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24 }}>

        {/* Overview */}
        {tab === 'overview' && (
          <>
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14, marginBottom: 24 }}>
              {[
                { label: 'درآمد شارژ', value: formatRial(totalChargeRevenue), icon: '🔋', color: 'purple' },
                { label: 'درآمد شاپ', value: formatRial(totalShopRevenue), icon: '🛒', color: 'cyan' },
                { label: 'سود خالص شاپ', value: formatRial(shopProfit.grossProfit || 0), icon: '📦', color: (shopProfit.grossProfit || 0) >= 0 ? 'green' : 'red' },
                { label: 'کل درآمد', value: formatRial(totalIncome), icon: '💰', color: 'green' },
                { label: 'کل هزینه', value: formatRial(totalExpenses), icon: '💸', color: 'yellow' },
                { label: 'سود خالص', value: formatRial(netProfit), icon: netProfit >= 0 ? '📈' : '📉', color: netProfit >= 0 ? 'green' : 'red' },
              ].map(k => (
                <div key={k.label} className={`stat-card ${k.color}`}>
                  <div className={`stat-icon ${k.color}`} style={{ fontSize: 22 }}>{k.icon}</div>
                  <div className="stat-value" style={{ fontSize: 14, marginBottom: 2 }}>{k.value}</div>
                  <div className="stat-label">{k.label}</div>
                </div>
              ))}
            </div>

            {/* Profit Banner */}
            <div style={{
              background: netProfit >= 0 ? 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))' : 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))',
              border: `1px solid ${netProfit >= 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              borderRadius: 14,
              padding: '20px 28px',
              marginBottom: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 4 }}>سود خالص {period === 0 ? 'امروز' : `${period} روز اخیر`}</div>
                <div style={{ fontSize: 32, fontWeight: 900, color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {netProfit >= 0 ? '+' : ''}{formatRial(netProfit)}
                </div>
              </div>
              <div style={{ textAlign: 'left', fontSize: 13, color: 'var(--text3)' }}>
                <div>حاشیه سود: <strong style={{ color: 'var(--text)' }}>{totalIncome ? ((netProfit / totalIncome) * 100).toFixed(1) : 0}%</strong></div>
                <div style={{ marginTop: 4 }}>نسبت هزینه: <strong style={{ color: 'var(--text)' }}>{totalIncome ? ((totalExpenses / totalIncome) * 100).toFixed(1) : 0}%</strong></div>
              </div>
              <div style={{ fontSize: 48 }}>{netProfit >= 0 ? '🏆' : '⚠️'}</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 24 }}>
              {/* Bar Chart */}
              <div className="card">
                <p className="chart-title">📊 مقایسه درآمد روزانه (ریال)</p>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={combinedChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="شارژ" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="شاپ" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Pie Chart */}
              <div className="card">
                <p className="chart-title">🥧 توزیع درآمد و هزینه</p>
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="45%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => formatRial(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="empty"><div className="empty-icon">📊</div><p className="empty-text">داده‌ای موجود نیست</p></div>
                )}
              </div>
            </div>

            {/* Shop Profit Breakdown */}
            {(shopProfit.ordersCount > 0) && (
              <div className="card" style={{ marginBottom: 16 }}>
                <p className="chart-title">📦 سود و زیان شاپ (فروش - بهای تمام‌شده)</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  {[
                    { label: 'درآمد فروش', value: shopProfit.totalRevenue || 0, color: 'var(--cyan)' },
                    { label: 'بهای تمام‌شده', value: shopProfit.totalCost || 0, color: 'var(--red)' },
                    { label: 'سود ناخالص', value: shopProfit.grossProfit || 0, color: (shopProfit.grossProfit || 0) >= 0 ? 'var(--green)' : 'var(--red)' },
                    { label: 'تعداد آیتم فروخته', value: `${(shopProfit.totalItems || 0).toLocaleString('fa-IR')} عدد`, color: 'var(--text)', isText: true },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--bg2)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border)', textAlign: 'center' }}>
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{s.label}</div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: s.color }}>{s.isText ? s.value : formatRial(s.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Expense breakdown */}
            {expByCat.length > 0 && (
              <div className="card">
                <p className="chart-title">💸 هزینه‌ها بر اساس دسته</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                  {expByCat.sort((a, b) => b.value - a.value).map(c => (
                    <div key={c.name} style={{ background: 'var(--bg2)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>{c.name}</div>
                      <div style={{ fontWeight: 800, color: 'var(--red)', fontSize: 15 }}>{formatRial(c.value)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{totalExpenses ? ((c.value / totalExpenses) * 100).toFixed(1) : 0}% از کل</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Income Detail */}
        {tab === 'income' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div className="card">
                <p className="chart-title">🔋 درآمد شارژ روزانه</p>
                <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
                  <table>
                    <thead><tr><th>تاریخ</th><th>تعداد تراکنش</th><th>مبلغ (ریال)</th></tr></thead>
                    <tbody>
                      {revenueData.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text3)', padding: 30 }}>داده‌ای موجود نیست</td></tr>}
                      {revenueData.map(d => (
                        <tr key={d.date}>
                          <td>{d.date}</td>
                          <td style={{ color: 'var(--text3)' }}>{d.transactions}</td>
                          <td style={{ fontWeight: 700, color: 'var(--purple3)' }}>{formatRial(d.charged)}</td>
                        </tr>
                      ))}
                      {revenueData.length > 0 && (
                        <tr style={{ background: 'rgba(124,58,237,0.1)' }}>
                          <td style={{ fontWeight: 700 }}>جمع کل</td>
                          <td style={{ fontWeight: 700 }}>{revenueData.reduce((s, d) => s + d.transactions, 0)}</td>
                          <td style={{ fontWeight: 800, color: 'var(--purple3)' }}>{formatRial(totalChargeRevenue)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card">
                <p className="chart-title">🛒 فروش شاپ روزانه</p>
                <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
                  <table>
                    <thead><tr><th>تاریخ</th><th>تعداد سفارش</th><th>مبلغ (ریال)</th></tr></thead>
                    <tbody>
                      {shopData.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text3)', padding: 30 }}>داده‌ای موجود نیست</td></tr>}
                      {shopData.map(d => (
                        <tr key={d.date}>
                          <td>{d.date}</td>
                          <td style={{ color: 'var(--text3)' }}>{d.orders}</td>
                          <td style={{ fontWeight: 700, color: 'var(--cyan)' }}>{formatRial(d.revenue)}</td>
                        </tr>
                      ))}
                      {shopData.length > 0 && (
                        <tr style={{ background: 'rgba(6,182,212,0.1)' }}>
                          <td style={{ fontWeight: 700 }}>جمع کل</td>
                          <td style={{ fontWeight: 700 }}>{shopData.reduce((s, d) => s + d.orders, 0)}</td>
                          <td style={{ fontWeight: 800, color: 'var(--cyan)' }}>{formatRial(totalShopRevenue)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="card">
              <p className="chart-title">📋 ریز تراکنش‌های شارژ</p>
              <div className="table-wrap" style={{ maxHeight: 400, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>تاریخ</th><th>کاربر</th><th>نوع</th><th>مبلغ</th><th>توضیح</th></tr></thead>
                  <tbody>
                    {txns.filter(t => t.type === 'charge').slice(0, 100).map(t => (
                      <tr key={t.id}>
                        <td style={{ fontSize: 12, color: 'var(--text3)' }}>{formatDate(t.created_at)}</td>
                        <td style={{ fontWeight: 600 }}>👤 {t.username}</td>
                        <td><span className="badge badge-green">شارژ</span></td>
                        <td style={{ fontWeight: 700, color: 'var(--green)' }}>+{t.amount} دقیقه</td>
                        <td style={{ fontSize: 12, color: 'var(--text3)' }}>{t.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Expenses */}
        {tab === 'expenses' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: 20, alignItems: 'start' }}>
            {/* Add Expense Form */}
            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
                {editExpIdx !== null ? '✏️ ویرایش هزینه' : '➕ ثبت هزینه جدید'}
              </h3>
              <div className="form-group">
                <label className="label">تاریخ</label>
                <input type="date" className="input" value={expForm.date} onChange={e => setExpForm(p => ({ ...p, date: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">دسته‌بندی</label>
                <select className="input" value={expForm.category} onChange={e => setExpForm(p => ({ ...p, category: e.target.value }))}>
                  {EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">توضیح</label>
                <input className="input" placeholder="مثلا: قبض برق ماهانه" value={expForm.desc} onChange={e => setExpForm(p => ({ ...p, desc: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">مبلغ (ریال)</label>
                <input type="number" className="input" placeholder="500000" value={expForm.amount} onChange={e => setExpForm(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {editExpIdx !== null && (
                  <button className="btn btn-ghost" onClick={() => { setEditExpIdx(null); setExpForm({ date: new Date().toISOString().split('T')[0], category: 'سایر', desc: '', amount: '' }); }}>لغو</button>
                )}
                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={addExpense}>
                  {editExpIdx !== null ? '✅ ذخیره ویرایش' : '✅ ثبت هزینه'}
                </button>
              </div>

              {/* Summary */}
              <div style={{ marginTop: 20, padding: 16, background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 8 }}>خلاصه {period} روز اخیر</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>تعداد هزینه</span>
                  <strong>{periodExpenses.length} مورد</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13 }}>جمع هزینه‌ها</span>
                  <strong style={{ color: 'var(--red)' }}>{formatRial(totalExpenses)}</strong>
                </div>
              </div>
            </div>

            {/* Expenses List */}
            <div>
              <div className="card">
                <div className="flex-between mb-16">
                  <p className="chart-title" style={{ margin: 0 }}>📋 لیست هزینه‌ها ({periodExpenses.length} مورد)</p>
                  <select className="input" style={{ width: 'auto', fontSize: 12 }} value={period} onChange={e => setPeriod(Number(e.target.value))}>
                    <option value={7}>۷ روز</option>
                    <option value={30}>۳۰ روز</option>
                    <option value={90}>۹۰ روز</option>
                  </select>
                </div>
                {periodExpenses.length === 0 ? (
                  <div className="empty"><div className="empty-icon">💸</div><p className="empty-text">هزینه‌ای ثبت نشده</p></div>
                ) : (
                  <div className="table-wrap" style={{ maxHeight: 500, overflowY: 'auto' }}>
                    <table>
                      <thead><tr><th>تاریخ</th><th>دسته</th><th>توضیح</th><th>مبلغ (ریال)</th><th>عملیات</th></tr></thead>
                      <tbody>
                        {periodExpenses.map((e, idx) => (
                          <tr key={e.id || idx}>
                            <td style={{ fontSize: 12, color: 'var(--text3)' }}>{e.date}</td>
                            <td><span className="badge badge-yellow">{e.category}</span></td>
                            <td style={{ fontSize: 13 }}>{e.desc}</td>
                            <td style={{ fontWeight: 700, color: 'var(--red)' }}>{formatRial(e.amount)}</td>
                            <td>
                              <div className="btn-group">
                                <button className="btn btn-ghost btn-sm" onClick={() => { setExpForm({ ...e }); setEditExpIdx(expenses.indexOf(e)); }}>✏️</button>
                                <button className="btn btn-red btn-sm" onClick={() => deleteExp(expenses.indexOf(e))}>🗑</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        <tr style={{ background: 'rgba(239,68,68,0.08)' }}>
                          <td colSpan={3} style={{ fontWeight: 700, textAlign: 'left', paddingLeft: 16 }}>جمع کل:</td>
                          <td style={{ fontWeight: 900, color: 'var(--red)', fontSize: 16 }}>{formatRial(totalExpenses)}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Cash Flow */}
        {tab === 'cashflow' && (
          <div>
            <div className="card" style={{ marginBottom: 20 }}>
              <p className="chart-title">🔄 جریان نقدی روزانه (درآمد vs هزینه)</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={combinedChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="شارژ" fill="#7c3aed" radius={[4, 4, 0, 0]} stackId="income" />
                  <Bar dataKey="شاپ" fill="#06b6d4" radius={[4, 4, 0, 0]} stackId="income" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <p className="chart-title">📋 خلاصه جریان نقدی</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>بازه زمانی</th><th>درآمد شارژ</th><th>درآمد شاپ</th><th>کل درآمد</th><th>هزینه‌ها</th><th>سود خالص</th></tr></thead>
                  <tbody>
                    {[7, 30].map(d => {
                      const rev = revenueData.slice(-d).reduce((s, x) => s + (x.charged || 0), 0);
                      const shp = shopData.slice(-d).reduce((s, x) => s + (x.revenue || 0), 0);
                      const exp = expenses.filter(e => { const ed = new Date(e.date); const from = new Date(); from.setDate(from.getDate() - d); return ed >= from; }).reduce((s, e) => s + Number(e.amount), 0);
                      const profit = rev + shp - exp;
                      return (
                        <tr key={d}>
                          <td style={{ fontWeight: 600 }}>{d} روز اخیر</td>
                          <td style={{ color: 'var(--purple3)' }}>{formatRial(rev)}</td>
                          <td style={{ color: 'var(--cyan)' }}>{formatRial(shp)}</td>
                          <td style={{ fontWeight: 700, color: 'var(--green)' }}>{formatRial(rev + shp)}</td>
                          <td style={{ fontWeight: 700, color: 'var(--red)' }}>{formatRial(exp)}</td>
                          <td style={{ fontWeight: 800, fontSize: 15, color: profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatRial(profit)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: 'rgba(124,58,237,0.08)' }}>
                      <td style={{ fontWeight: 700 }}>کل {period} روز</td>
                      <td style={{ color: 'var(--purple3)', fontWeight: 700 }}>{formatRial(totalChargeRevenue)}</td>
                      <td style={{ color: 'var(--cyan)', fontWeight: 700 }}>{formatRial(totalShopRevenue)}</td>
                      <td style={{ fontWeight: 800, color: 'var(--green)' }}>{formatRial(totalIncome)}</td>
                      <td style={{ fontWeight: 800, color: 'var(--red)' }}>{formatRial(totalExpenses)}</td>
                      <td style={{ fontWeight: 900, fontSize: 16, color: netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{formatRial(netProfit)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

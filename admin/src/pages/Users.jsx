import { useEffect, useState } from 'react';
import { api, formatRial, formatDate, formatMinutes } from '../api';

const emptyForm = { name: '', family: '', phone: '', credits: 0, discount_percent: 0 };

export default function Users({ addToast }) {
  const [users, setUsers] = useState([]);
  const [badPayers, setBadPayers] = useState([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all'); // all | badpayers
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editUser, setEditUser] = useState(null);
  const [finUser, setFinUser] = useState(null); // user for financial ops
  const [finOp, setFinOp] = useState('charge'); // charge | decharge | debt_add | debt_pay
  const [finAmount, setFinAmount] = useState('');
  const [finDesc, setFinDesc] = useState('');
  const [txnUser, setTxnUser] = useState(null);
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState(null);
  const [filterActive, setFilterActive] = useState('all');

  const load = async () => {
    try {
      const [us, bp] = await Promise.all([api.getUsers(), api.getBadPayers()]);
      setUsers(us);
      setBadPayers(bp);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  // Top 3 by total_minutes
  const sorted = [...users].sort((a, b) => b.total_minutes - a.total_minutes);
  const top3 = sorted.slice(0, 3).map(u => u.id);
  const tierOf = (id) => {
    const idx = top3.indexOf(id);
    return idx === 0 ? 1 : idx === 1 ? 2 : idx === 2 ? 3 : 0;
  };
  const tierBadge = (tier) => tier === 1 ? '🥇' : tier === 2 ? '🥈' : tier === 3 ? '🥉' : '';

  const filtered = (tab === 'badpayers' ? badPayers : users).filter(u => {
    const matchSearch = !search ||
      u.username?.includes(search) ||
      u.name?.includes(search) ||
      u.family?.includes(search) ||
      u.phone?.includes(search);
    const matchActive = filterActive === 'all' || (filterActive === 'active' ? u.is_active : !u.is_active);
    return matchSearch && matchActive;
  });

  const handleCreate = async () => {
    setLoading(true);
    try {
      const result = await api.createUser(form);
      await load();
      setNewlyCreated(result);
      setModal('created');
    } catch (e) { addToast(e.message, 'error'); }
    setLoading(false);
  };

  const handleEdit = async () => {
    if (!editUser) return;
    setLoading(true);
    try {
      await api.updateUser(editUser.id, form);
      await load();
      addToast('اطلاعات ذخیره شد ✅', 'success');
      setModal(null);
    } catch (e) { addToast(e.message, 'error'); }
    setLoading(false);
  };

  const handleFinancial = async () => {
    if (!finAmount || Number(finAmount) <= 0) return addToast('مبلغ را وارد کنید', 'error');
    setLoading(true);
    try {
      const amt = Number(finAmount);
      const desc = finDesc || undefined;
      if (finOp === 'charge') {
        const res = await api.chargeUser(finUser.id, amt, desc);
        const bonus = res.bonus;
        addToast(`شارژ شد${bonus > 0 ? ` + ${formatRial(bonus)} تخفیف` : ''} ✅`, 'success');
      } else if (finOp === 'decharge') {
        await api.dechargeUser(finUser.id, amt, desc);
        addToast('شارژ کاهش یافت ✅', 'success');
      } else if (finOp === 'debt_add') {
        await api.addDebt(finUser.id, amt, desc);
        addToast('بدهی افزایش یافت', 'info');
      } else if (finOp === 'debt_pay') {
        await api.payDebt(finUser.id, amt, desc);
        addToast('بدهی پرداخت شد ✅', 'success');
      }
      await load();
      setFinAmount('');
      setFinDesc('');
      setModal(null);
    } catch (e) { addToast(e.message, 'error'); }
    setLoading(false);
  };

  const handleToggle = async (u) => {
    try {
      const res = await api.toggleUser(u.id);
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: res.is_active } : x));
      addToast(res.is_active ? `✅ کاربر ${u.username} فعال شد` : `⛔ کاربر ${u.username} غیرفعال شد`, res.is_active ? 'success' : 'info');
    } catch (e) { addToast(e.message, 'error'); }
  };

  const handleDelete = async (u) => {
    if (!confirm(`آیا مطمئنی کاربر "${u.username}" را حذف کنی؟`)) return;
    try {
      await api.deleteUser(u.id);
      await load();
      addToast('کاربر حذف شد', 'success');
    } catch (e) { addToast(e.message, 'error'); }
  };

  const openCreate = () => { setForm(emptyForm); setModal('create'); };
  const openEdit = (u) => {
    setEditUser(u);
    setForm({ name: u.name || '', family: u.family || '', phone: u.phone || '', password: '', discount_percent: u.discount_percent || 0 });
    setModal('edit');
  };
  const openFinancial = (u, op = 'charge') => {
    setFinUser(u); setFinOp(op); setFinAmount(''); setFinDesc('');
    setModal('financial');
  };
  const openTxns = async (u) => {
    setTxnUser(u);
    setModal('txns');
    try { setTxns(await api.getUserTransactions(u.id)); } catch {}
  };

  const finOps = [
    { key: 'charge', label: '🔋 افزایش شارژ', color: 'var(--green)' },
    { key: 'decharge', label: '📉 کاهش شارژ', color: 'var(--yellow)' },
    { key: 'debt_add', label: '💸 افزایش بدهی', color: 'var(--red)' },
    { key: 'debt_pay', label: '✅ پرداخت بدهی', color: 'var(--cyan)' },
  ];

  const quickAmounts = [10000, 30000, 50000, 100000, 200000, 500000];

  const activeCount = users.filter(u => u.is_active).length;
  const inactiveCount = users.filter(u => !u.is_active).length;

  const txnTypeLabel = (type) => {
    if (type === 'charge') return <span className="badge badge-green">شارژ</span>;
    if (type === 'shop') return <span className="badge badge-cyan">شاپ</span>;
    if (type === 'debt_add') return <span className="badge badge-red">بدهی</span>;
    if (type === 'debt_pay') return <span className="badge badge-purple">پرداخت بدهی</span>;
    return <span className="badge badge-gray">کسر</span>;
  };

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">👤 مدیریت کاربران</span>
        <div className="topbar-right">
          <span className="badge badge-green">● {activeCount} فعال</span>
          <span className="badge badge-red">● {inactiveCount} غیرفعال</span>
          {badPayers.length > 0 && <span className="badge badge-yellow">⚠️ {badPayers.length} بد حساب</span>}
          <button className="btn btn-primary btn-sm" onClick={openCreate}>➕ کاربر جدید</button>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24 }}>
        <div className="search-bar mb-16">
          <input
            className="input search-input"
            placeholder="🔍 جستجو با کد، نام، خانوادگی یا تلفن..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <button className={`btn btn-sm ${tab === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('all')}>همه کاربران</button>
            <button className={`btn btn-sm ${tab === 'badpayers' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('badpayers')} style={{ color: tab !== 'badpayers' && badPayers.length > 0 ? 'var(--yellow)' : undefined }}>
              ⚠️ بد حساب‌ها {badPayers.length > 0 && `(${badPayers.length})`}
            </button>
          </div>
          {tab === 'all' && (
            <div style={{ display: 'flex', gap: 4 }}>
              {[['all', 'همه'], ['active', 'فعال'], ['inactive', 'غیرفعال']].map(([v, l]) => (
                <button key={v} className={`btn btn-sm ${filterActive === v ? 'btn-cyan' : 'btn-ghost'}`} onClick={() => setFilterActive(v)}>{l}</button>
              ))}
            </div>
          )}
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{filtered.length} نفر</span>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>کد کاربر</th>
                  <th>نام</th>
                  <th>تلفن</th>
                  <th>اعتبار (ریال)</th>
                  <th>بدهی</th>
                  <th>کل زمان</th>
                  <th>آخرین ورود</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>کاربری پیدا نشد</td></tr>
                )}
                {filtered.map(u => {
                  const tier = tierOf(u.id);
                  return (
                    <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.55 }}>
                      <td>
                        <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 900, color: 'var(--cyan)', letterSpacing: 1 }}>
                          {tierBadge(tier)} {u.username}
                        </div>
                        {u.discount_percent > 0 && (
                          <div style={{ fontSize: 10, color: 'var(--purple3)' }}>🎁 تخفیف {u.discount_percent}%</div>
                        )}
                      </td>
                      <td>
                        <div style={{ fontWeight: 700 }}>
                          {(u.name || u.family) ? `${u.name} ${u.family}`.trim() : <span style={{ color: 'var(--text3)', fontWeight: 400 }}>-</span>}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text3)' }}>عضو از {formatDate(u.created_at)}</div>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{u.phone || '-'}</td>
                      <td>
                        <div style={{ fontWeight: 900, fontSize: 15, color: u.credits <= 0 ? 'var(--red)' : u.credits < 10000 ? 'var(--yellow)' : 'var(--green)' }}>
                          {formatRial(u.credits)}
                        </div>
                      </td>
                      <td>
                        {u.debt > 0 ? (
                          <span style={{ fontWeight: 700, color: 'var(--red)', fontSize: 13 }}>
                            ⚠️ {formatRial(u.debt)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text3)', fontSize: 12 }}>—</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--cyan)', fontSize: 13 }}>{formatMinutes(u.total_minutes)}</td>
                      <td style={{ color: 'var(--text3)', fontSize: 12 }}>{formatDate(u.last_login)}</td>
                      <td>
                        <button
                          onClick={() => handleToggle(u)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
                            borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 11,
                            fontFamily: 'Vazirmatn, sans-serif',
                            background: u.is_active ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                            color: u.is_active ? 'var(--green)' : 'var(--red)',
                            border: u.is_active ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(239,68,68,0.3)',
                          }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: u.is_active ? 'var(--green)' : 'var(--red)', flexShrink: 0 }} />
                          {u.is_active ? 'فعال' : 'غیرفعال'}
                        </button>
                      </td>
                      <td>
                        <div className="btn-group">
                          <button className="btn btn-green btn-sm" onClick={() => openFinancial(u, 'charge')} title="عملیات مالی">💰</button>
                          <button className="btn btn-cyan btn-sm" onClick={() => openTxns(u)} title="تاریخچه">📋</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)} title="ویرایش">✏️</button>
                          <button className="btn btn-red btn-sm" onClick={() => handleDelete(u)} title="حذف">🗑</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {modal === 'create' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">➕ کاربر جدید</h3>
            <div style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13 }}>
              <div style={{ color: 'var(--cyan)', fontWeight: 700, marginBottom: 4 }}>🤖 کد و رمز خودکار</div>
              <div style={{ color: 'var(--text3)' }}>سیستم یه کد عددی از ۱۰۰۰ به بعد می‌ده. رمز هم همان کد خواهد بود.</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="label">نام</label>
                <input className="input" placeholder="نام" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">نام خانوادگی</label>
                <input className="input" placeholder="نام خانوادگی" value={form.family} onChange={e => setForm(p => ({ ...p, family: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">شماره تلفن</label>
                <input className="input" placeholder="09xxxxxxxxx" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} dir="ltr" />
              </div>
              <div className="form-group">
                <label className="label">اعتبار اولیه (ریال)</label>
                <input className="input" type="number" min={0} step={1000} value={form.credits} onChange={e => setForm(p => ({ ...p, credits: Number(e.target.value) }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>لغو</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
                {loading ? '⏳...' : '✅ ساخت کاربر'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Created */}
      {modal === 'created' && newlyCreated && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>✅</div>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 20 }}>کاربر ساخته شد!</h3>
            <div style={{ background: 'var(--bg2)', border: '2px solid var(--cyan)', borderRadius: 14, padding: 24, marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>کد کاربری (نام کاربری + رمز عبور)</div>
              <div style={{ fontSize: 52, fontWeight: 900, color: 'var(--cyan)', letterSpacing: 4, fontFamily: 'monospace' }}>
                {newlyCreated.username}
              </div>
              {(newlyCreated.name || newlyCreated.family) && (
                <div style={{ fontSize: 14, color: 'var(--text2)', marginTop: 8 }}>{newlyCreated.name} {newlyCreated.family}</div>
              )}
            </div>
            <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>
              این کد را به کاربر بدید. هم نام کاربری هم رمز عبور همین عدد است.
            </p>
            <div className="modal-footer" style={{ justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => setModal(null)}>✅ متوجه شدم</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {modal === 'edit' && editUser && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">✏️ ویرایش — <span style={{ color: 'var(--cyan)' }}>{editUser.username}</span></h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="label">نام</label>
                <input className="input" placeholder="نام" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">نام خانوادگی</label>
                <input className="input" placeholder="نام خانوادگی" value={form.family} onChange={e => setForm(p => ({ ...p, family: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">شماره تلفن</label>
                <input className="input" dir="ltr" placeholder="09xxxxxxxxx" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">رمز جدید (خالی = بدون تغییر)</label>
                <input className="input" type="password" placeholder="رمز جدید" value={form.password || ''} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
              </div>
              <div className="form-group" style={{ gridColumn: '1/3' }}>
                <label className="label">تخفیف فردی هنگام شارژ (%)</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="input" type="number" min={0} max={100} value={form.discount_percent} onChange={e => setForm(p => ({ ...p, discount_percent: e.target.value }))} style={{ flex: 1 }} />
                  <div style={{ padding: '10px 14px', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 8, fontWeight: 800, color: 'var(--purple3)', whiteSpace: 'nowrap' }}>
                    {form.discount_percent || 0}% تخفیف
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>لغو</button>
              <button className="btn btn-primary" onClick={handleEdit} disabled={loading}>
                {loading ? '⏳...' : '✅ ذخیره'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Financial Operations Modal */}
      {modal === 'financial' && finUser && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">💰 عملیات مالی — <span style={{ color: 'var(--cyan)' }}>{finUser.username}</span></h3>

            {/* User info */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>اعتبار فعلی</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: finUser.credits > 0 ? 'var(--green)' : 'var(--red)' }}>
                  {formatRial(finUser.credits)}
                </div>
              </div>
              <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: '10px 14px', border: `1px solid ${finUser.debt > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border)'}` }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>بدهی</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: finUser.debt > 0 ? 'var(--red)' : 'var(--text3)' }}>
                  {finUser.debt > 0 ? formatRial(finUser.debt) : '—'}
                </div>
              </div>
            </div>

            {/* Op selector */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              {finOps.map(op => (
                <button key={op.key}
                  className={`btn btn-sm ${finOp === op.key ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ justifyContent: 'center', padding: '10px 6px', fontSize: 12, color: finOp !== op.key ? op.color : undefined }}
                  onClick={() => setFinOp(op.key)}>
                  {op.label}
                </button>
              ))}
            </div>

            {/* Quick amounts */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 12 }}>
              {quickAmounts.map(a => (
                <button key={a}
                  className={`btn btn-sm ${Number(finAmount) === a ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ justifyContent: 'center', fontSize: 11 }}
                  onClick={() => setFinAmount(String(a))}>
                  {a.toLocaleString('fa-IR')} ریال
                </button>
              ))}
            </div>

            <div className="form-group">
              <label className="label">مبلغ (ریال)</label>
              <input className="input" type="number" min={1} step={1000} value={finAmount} onChange={e => setFinAmount(e.target.value)} placeholder="مثلا ۱۰۰۰۰۰" />
            </div>
            <div className="form-group">
              <label className="label">توضیح (اختیاری)</label>
              <input className="input" value={finDesc} onChange={e => setFinDesc(e.target.value)} placeholder="توضیح اختیاری..." />
            </div>

            {finOp === 'charge' && Number(finAmount) > 0 && (
              <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--green)', marginBottom: 12 }}>
                ✅ بعد از شارژ اعتبار: {formatRial(finUser.credits + Number(finAmount))}
                {(finUser.discount_percent > 0 || tierOf(finUser.id) > 0) && (
                  <span style={{ color: 'var(--purple3)', marginRight: 8 }}>+ تخفیف اعمال می‌شه</span>
                )}
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>لغو</button>
              <button
                className="btn btn-primary"
                onClick={handleFinancial}
                disabled={loading || !finAmount || Number(finAmount) <= 0}>
                {loading ? '⏳...' : finOps.find(o => o.key === finOp)?.label}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transactions Modal */}
      {modal === 'txns' && txnUser && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">
              📋 تاریخچه — <span style={{ color: 'var(--cyan)' }}>{txnUser.username}</span>
              {(txnUser.name || txnUser.family) && <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text3)', marginRight: 8 }}>{txnUser.name} {txnUser.family}</span>}
            </h3>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr><th>نوع</th><th>مبلغ</th><th>توضیح</th><th>تاریخ</th></tr>
                </thead>
                <tbody>
                  {txns.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 30, color: 'var(--text3)' }}>تراکنشی ثبت نشده</td></tr>}
                  {txns.map(t => (
                    <tr key={t.id}>
                      <td>{txnTypeLabel(t.type)}</td>
                      <td style={{ fontWeight: 700, color: t.amount > 0 ? 'var(--green)' : 'var(--red)' }}>
                        {t.amount > 0 ? '+' : ''}{formatRial(t.amount)}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text3)' }}>{t.description}</td>
                      <td style={{ fontSize: 11, color: 'var(--text3)' }}>{formatDate(t.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>بستن</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

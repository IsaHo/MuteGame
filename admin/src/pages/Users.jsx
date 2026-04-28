import { useEffect, useState } from 'react';
import { api, formatRial, formatDate, formatMinutes } from '../api';

const emptyForm = { name: '', family: '', phone: '', credits: 0 };

export default function Users({ addToast }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // null | 'create' | 'edit' | 'charge' | 'txns'
  const [form, setForm] = useState(emptyForm);
  const [editUser, setEditUser] = useState(null);
  const [chargeTarget, setChargeTarget] = useState(null);
  const [chargeAmount, setChargeAmount] = useState(60);
  const [txnUser, setTxnUser] = useState(null);
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState(null);
  const [filterActive, setFilterActive] = useState('all');

  const load = async () => {
    try { setUsers(await api.getUsers()); } catch { }
  };

  useEffect(() => { load(); }, []);

  const filtered = users.filter(u => {
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
      await fetch(`/api/users/${editUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }).then(r => r.json());
      await load();
      addToast('اطلاعات ذخیره شد ✅', 'success');
      setModal(null);
    } catch (e) { addToast(e.message, 'error'); }
    setLoading(false);
  };

  const handleCharge = async () => {
    if (!chargeAmount || chargeAmount < 1) return addToast('مقدار شارژ را وارد کنید', 'error');
    setLoading(true);
    try {
      await api.chargeUser(chargeTarget.id, Number(chargeAmount));
      await load();
      addToast(`${chargeAmount} دقیقه شارژ شد ✅`, 'success');
      setModal(null);
    } catch (e) { addToast(e.message, 'error'); }
    setLoading(false);
  };

  const handleToggle = async (u) => {
    try {
      const res = await fetch(`/api/users/${u.id}/toggle`, { method: 'POST' }).then(r => r.json());
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
    setForm({ name: u.name || '', family: u.family || '', phone: u.phone || '', password: '' });
    setModal('edit');
  };
  const openCharge = (u) => { setChargeTarget(u); setChargeAmount(60); setModal('charge'); };
  const openTxns = async (u) => {
    setTxnUser(u);
    setModal('txns');
    try { setTxns(await api.getUserTransactions(u.id)); } catch { }
  };

  const activeCount = users.filter(u => u.is_active).length;
  const inactiveCount = users.filter(u => !u.is_active).length;

  const quickChargeOptions = [30, 60, 120, 180, 300, 600];

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">👤 مدیریت کاربران</span>
        <div className="topbar-right">
          <span className="badge badge-green">● {activeCount} فعال</span>
          <span className="badge badge-red">● {inactiveCount} غیرفعال</span>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>➕ کاربر جدید</button>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24 }}>
        {/* Search & filter */}
        <div className="search-bar mb-16">
          <input
            className="input search-input"
            placeholder="🔍 جستجو با کد، نام، خانوادگی یا تلفن..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            {[['all', 'همه'], ['active', 'فعال'], ['inactive', 'غیرفعال']].map(([v, l]) => (
              <button key={v} className={`btn btn-sm ${filterActive === v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterActive(v)}>{l}</button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{filtered.length} نفر</span>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>کد کاربر</th>
                  <th>نام و نام خانوادگی</th>
                  <th>شماره تلفن</th>
                  <th>اعتبار (دقیقه)</th>
                  <th>کل زمان</th>
                  <th>آخرین ورود</th>
                  <th>وضعیت</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>کاربری پیدا نشد</td></tr>
                )}
                {filtered.map(u => (
                  <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.55 }}>
                    {/* Code */}
                    <td>
                      <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 900, color: 'var(--cyan)', letterSpacing: 1 }}>
                        {u.username}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>رمز: {u.username}</div>
                    </td>

                    {/* Name */}
                    <td>
                      <div style={{ fontWeight: 700 }}>
                        {(u.name || u.family) ? `${u.name} ${u.family}`.trim() : <span style={{ color: 'var(--text3)', fontWeight: 400 }}>ثبت نشده</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>عضو از {formatDate(u.created_at)}</div>
                    </td>

                    {/* Phone */}
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>
                      {u.phone || <span style={{ color: 'var(--text3)' }}>-</span>}
                    </td>

                    {/* Credits */}
                    <td>
                      <span style={{
                        fontWeight: 900, fontSize: 20,
                        color: u.credits <= 0 ? 'var(--red)' : u.credits <= 10 ? 'var(--yellow)' : 'var(--green)'
                      }}>
                        {u.credits}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', marginRight: 4 }}>دقیقه</span>
                    </td>

                    {/* Total time */}
                    <td style={{ color: 'var(--cyan)', fontSize: 13 }}>{formatMinutes(u.total_minutes)}</td>

                    {/* Last login */}
                    <td style={{ color: 'var(--text3)', fontSize: 12 }}>{formatDate(u.last_login)}</td>

                    {/* Active toggle */}
                    <td>
                      <button
                        onClick={() => handleToggle(u)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                          borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700,
                          fontSize: 12, fontFamily: 'Vazirmatn, sans-serif', transition: 'all 0.2s',
                          background: u.is_active ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                          color: u.is_active ? 'var(--green)' : 'var(--red)',
                          border: u.is_active ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(239,68,68,0.3)',
                        }}
                        title={u.is_active ? 'کلیک برای غیرفعال کردن' : 'کلیک برای فعال کردن'}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: u.is_active ? 'var(--green)' : 'var(--red)', flexShrink: 0 }} />
                        {u.is_active ? 'فعال' : 'غیرفعال'}
                      </button>
                    </td>

                    {/* Actions */}
                    <td>
                      <div className="btn-group">
                        <button className="btn btn-green btn-sm" onClick={() => openCharge(u)} title="شارژ اعتبار">🔋 شارژ</button>
                        <button className="btn btn-cyan btn-sm" onClick={() => openTxns(u)} title="تاریخچه">📋</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)} title="ویرایش">✏️</button>
                        <button className="btn btn-red btn-sm" onClick={() => handleDelete(u)} title="حذف">🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
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

            {/* Auto info notice */}
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
                <label className="label">اعتبار اولیه (دقیقه)</label>
                <input className="input" type="number" min={0} value={form.credits} onChange={e => setForm(p => ({ ...p, credits: Number(e.target.value) }))} />
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

      {/* Created - show code */}
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
                <div style={{ fontSize: 14, color: 'var(--text2)', marginTop: 8 }}>
                  {newlyCreated.name} {newlyCreated.family}
                </div>
              )}
              {newlyCreated.credits > 0 && (
                <div style={{ fontSize: 13, color: 'var(--green)', marginTop: 6 }}>
                  اعتبار اولیه: {newlyCreated.credits} دقیقه
                </div>
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
            <h3 className="modal-title">✏️ ویرایش کاربر <span style={{ color: 'var(--cyan)' }}>{editUser.username}</span></h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="label">نام</label>
                <input className="input" placeholder="نام" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">نام خانوادگی</label>
                <input className="input" placeholder="نام خانوادگی" value={form.family} onChange={e => setForm(p => ({ ...p, family: e.target.value }))} />
              </div>
              <div className="form-group" style={{ gridColumn: '1/2' }}>
                <label className="label">شماره تلفن</label>
                <input className="input" placeholder="09xxxxxxxxx" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} dir="ltr" />
              </div>
              <div className="form-group" style={{ gridColumn: '2/3' }}>
                <label className="label">رمز جدید (خالی = بدون تغییر)</label>
                <input className="input" type="password" placeholder="رمز جدید" value={form.password || ''} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
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

      {/* Charge Modal */}
      {modal === 'charge' && chargeTarget && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">🔋 شارژ اعتبار</h3>
            <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text3)' }}>کاربر</div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--cyan)' }}>{chargeTarget.username}</div>
                  {(chargeTarget.name || chargeTarget.family) && <div style={{ fontSize: 12, color: 'var(--text3)' }}>{chargeTarget.name} {chargeTarget.family}</div>}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 13, color: 'var(--text3)' }}>اعتبار فعلی</div>
                  <div style={{ fontWeight: 900, fontSize: 22, color: chargeTarget.credits > 0 ? 'var(--green)' : 'var(--red)' }}>
                    {chargeTarget.credits} دقیقه
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
              {quickChargeOptions.map(m => (
                <button key={m} className={`btn ${chargeAmount == m ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                  style={{ justifyContent: 'center', flexDirection: 'column', padding: '10px 4px' }}
                  onClick={() => setChargeAmount(m)}>
                  <span style={{ fontWeight: 800 }}>{m >= 60 ? `${m / 60} ساعت` : `${m} دقیقه`}</span>
                </button>
              ))}
            </div>
            <div className="form-group">
              <label className="label">مقدار دلخواه (دقیقه)</label>
              <input type="number" className="input" value={chargeAmount} onChange={e => setChargeAmount(e.target.value)} min={1} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>لغو</button>
              <button className="btn btn-green" onClick={handleCharge} disabled={loading}>
                {loading ? '⏳...' : `✅ شارژ ${chargeAmount} دقیقه`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transactions Modal */}
      {modal === 'txns' && txnUser && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">
              📋 تاریخچه تراکنش‌ها —
              <span style={{ color: 'var(--cyan)', marginRight: 6 }}>{txnUser.username}</span>
              {(txnUser.name || txnUser.family) && <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text3)' }}>{txnUser.name} {txnUser.family}</span>}
            </h3>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr><th>نوع</th><th>مقدار</th><th>توضیح</th><th>تاریخ</th></tr>
                </thead>
                <tbody>
                  {txns.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 30, color: 'var(--text3)' }}>تراکنشی ثبت نشده</td></tr>}
                  {txns.map(t => (
                    <tr key={t.id}>
                      <td>
                        {t.type === 'charge' ? <span className="badge badge-green">شارژ</span>
                          : t.type === 'shop' ? <span className="badge badge-cyan">شاپ</span>
                            : <span className="badge badge-red">کسر</span>}
                      </td>
                      <td style={{ fontWeight: 700, color: t.amount > 0 ? 'var(--green)' : 'var(--red)' }}>
                        {t.amount > 0 ? '+' : ''}{t.amount} دقیقه
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

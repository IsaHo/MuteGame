import { useEffect, useState } from 'react';
import { api, formatRial, formatDate, formatMinutes } from '../api';

const emptyForm = { username: '', password: '', credits: 0 };

export default function Users({ addToast }) {
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // null | 'create' | 'edit' | 'charge' | 'txns'
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [chargeId, setChargeId] = useState(null);
  const [chargeAmount, setChargeAmount] = useState(60);
  const [txnUser, setTxnUser] = useState(null);
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try { setUsers(await api.getUsers()); } catch { }
  };

  useEffect(() => { load(); }, []);

  const filtered = users.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  const openCreate = () => { setForm(emptyForm); setEditId(null); setModal('create'); };
  const openEdit = (u) => { setForm({ username: u.username, password: '', credits: u.credits }); setEditId(u.id); setModal('edit'); };
  const openCharge = (u) => { setChargeId(u.id); setChargeAmount(60); setModal('charge'); };
  const openTxns = async (u) => {
    setTxnUser(u);
    setModal('txns');
    try { setTxns(await api.getUserTransactions(u.id)); } catch { }
  };

  const handleCreate = async () => {
    if (!form.username || !form.password) return addToast('نام کاربری و رمز عبور الزامی است', 'error');
    setLoading(true);
    try {
      await api.createUser(form);
      await load();
      addToast('کاربر ساخته شد ✅', 'success');
      setModal(null);
    } catch (e) { addToast(e.message, 'error'); }
    setLoading(false);
  };

  const handleEdit = async () => {
    setLoading(true);
    try {
      await api.updateUser(editId, form);
      await load();
      addToast('کاربر ویرایش شد ✅', 'success');
      setModal(null);
    } catch (e) { addToast(e.message, 'error'); }
    setLoading(false);
  };

  const handleCharge = async () => {
    if (!chargeAmount || chargeAmount < 1) return addToast('مقدار شارژ را وارد کنید', 'error');
    setLoading(true);
    try {
      await api.chargeUser(chargeId, Number(chargeAmount));
      await load();
      addToast(`${chargeAmount} دقیقه شارژ شد ✅`, 'success');
      setModal(null);
    } catch (e) { addToast(e.message, 'error'); }
    setLoading(false);
  };

  const handleDelete = async (u) => {
    if (!confirm(`آیا مطمئنی کاربر "${u.username}" را حذف کنی؟`)) return;
    try {
      await api.deleteUser(u.id);
      await load();
      addToast('کاربر حذف شد', 'success');
    } catch (e) { addToast(e.message, 'error'); }
  };

  const quickChargeOptions = [30, 60, 120, 180, 300, 600];

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">👤 مدیریت کاربران</span>
        <div className="topbar-right">
          <span className="badge badge-purple">{users.length} کاربر</span>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>➕ کاربر جدید</button>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24 }}>
        {/* Search */}
        <div className="search-bar mb-16">
          <input className="input search-input" placeholder="🔍 جستجوی کاربر..." value={search} onChange={e => setSearch(e.target.value)} />
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{filtered.length} نتیجه</span>
        </div>

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>نام کاربری</th>
                  <th>اعتبار (دقیقه)</th>
                  <th>کل زمان بازی</th>
                  <th>آخرین ورود</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: 40 }}>کاربری پیدا نشد</td></tr>
                )}
                {filtered.map((u, i) => (
                  <tr key={u.id}>
                    <td style={{ color: 'var(--text3)', fontSize: 12 }}>{i + 1}</td>
                    <td>
                      <div style={{ fontWeight: 700 }}>👤 {u.username}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>عضو از {formatDate(u.created_at)}</div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 800, fontSize: 16, color: u.credits <= 10 ? 'var(--red)' : u.credits <= 30 ? 'var(--yellow)' : 'var(--green)' }}>
                        {u.credits}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', marginRight: 4 }}>دقیقه</span>
                    </td>
                    <td style={{ color: 'var(--cyan)' }}>{formatMinutes(u.total_minutes)}</td>
                    <td style={{ color: 'var(--text3)', fontSize: 12 }}>{formatDate(u.last_login)}</td>
                    <td>
                      <div className="btn-group">
                        <button className="btn btn-green btn-sm" onClick={() => openCharge(u)}>🔋 شارژ</button>
                        <button className="btn btn-cyan btn-sm" onClick={() => openTxns(u)}>📋 تاریخچه</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>✏️</button>
                        <button className="btn btn-red btn-sm" onClick={() => handleDelete(u)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {(modal === 'create' || modal === 'edit') && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{modal === 'create' ? '➕ کاربر جدید' : '✏️ ویرایش کاربر'}</h3>
            <div className="form-group">
              <label className="label">نام کاربری</label>
              <input className="input" placeholder="نام کاربری" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">{modal === 'edit' ? 'رمز جدید (خالی = بدون تغییر)' : 'رمز عبور'}</label>
              <input className="input" type="password" placeholder="رمز عبور" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
            </div>
            {modal === 'create' && (
              <div className="form-group">
                <label className="label">اعتبار اولیه (دقیقه)</label>
                <input className="input" type="number" min={0} value={form.credits} onChange={e => setForm(p => ({ ...p, credits: Number(e.target.value) }))} />
              </div>
            )}
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal(null)}>لغو</button>
              <button className="btn btn-primary" onClick={modal === 'create' ? handleCreate : handleEdit} disabled={loading}>
                {loading ? '⏳...' : modal === 'create' ? '✅ ساختن کاربر' : '✅ ذخیره'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Charge Modal */}
      {modal === 'charge' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">🔋 شارژ اعتبار</h3>
            <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>
              کاربر: <strong style={{ color: 'var(--text)' }}>{users.find(u => u.id === chargeId)?.username}</strong>
              &nbsp;|&nbsp; اعتبار فعلی: <strong style={{ color: 'var(--cyan)' }}>{users.find(u => u.id === chargeId)?.credits} دقیقه</strong>
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
              {quickChargeOptions.map(m => (
                <button key={m} className={`btn ${chargeAmount == m ? 'btn-primary' : 'btn-ghost'} btn-sm`} style={{ justifyContent: 'center' }} onClick={() => setChargeAmount(m)}>
                  {m >= 60 ? `${m / 60} ساعت` : `${m} دقیقه`}
                </button>
              ))}
            </div>
            <div className="form-group">
              <label className="label">یا مقدار دلخواه (دقیقه)</label>
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
            <h3 className="modal-title">📋 تاریخچه تراکنش‌های {txnUser.username}</h3>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>نوع</th>
                    <th>مقدار</th>
                    <th>توضیح</th>
                    <th>تاریخ</th>
                  </tr>
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

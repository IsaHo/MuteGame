import { useEffect, useState } from 'react';
import { api, formatRial } from '../api';
import socket from '../socket';

export default function Clients({ addToast }) {
  const [clients, setClients] = useState([]);
  const [selected, setSelected] = useState(null);
  const [msgModal, setMsgModal] = useState(null);
  const [extendModal, setExtendModal] = useState(null);
  const [msgText, setMsgText] = useState('');
  const [extendMin, setExtendMin] = useState(60);
  const [view, setView] = useState('grid'); // grid | table

  useEffect(() => {
    api.getClients().then(setClients).catch(() => { });
    socket.on('clients:update', setClients);
    return () => socket.off('clients:update');
  }, []);

  const kick = async (c) => {
    if (!confirm(`آیا مطمئنی می‌خوای ${c.computerName} را اخراج کنی؟`)) return;
    try {
      await api.kickClient(c.socketId);
      addToast(`${c.computerName} اخراج شد`, 'success');
    } catch (e) { addToast(e.message, 'error'); }
  };

  const sendMsg = async () => {
    try {
      await api.messageClient(msgModal.socketId, msgText);
      addToast('پیام ارسال شد ✅', 'success');
      setMsgModal(null); setMsgText('');
    } catch (e) { addToast(e.message, 'error'); }
  };

  const extend = async () => {
    try {
      await api.extendClient(extendModal.socketId, Number(extendMin));
      addToast(`${extendMin} دقیقه اضافه شد`, 'success');
      setExtendModal(null);
    } catch (e) { addToast(e.message, 'error'); }
  };

  const active = clients.filter(c => c.status === 'active').length;
  const idle = clients.filter(c => c.status !== 'active').length;

  const elapsed = (start) => {
    if (!start) return '-';
    const m = Math.floor((Date.now() - new Date(start)) / 60000);
    const h = Math.floor(m / 60);
    const min = m % 60;
    return h > 0 ? `${h}:${String(min).padStart(2, '0')} ساعت` : `${min} دقیقه`;
  };

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">🖥️ کامپیوترها</span>
        <div className="topbar-right">
          <span className="badge badge-green">● {active} فعال</span>
          <span className="badge badge-gray">○ {idle} خالی</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setView(v => v === 'grid' ? 'table' : 'grid')}>
            {view === 'grid' ? '📋 جدول' : '⊞ شبکه'}
          </button>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24 }}>
        {clients.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon">🔌</div>
            <p className="empty-text">هیچ کامپیوتری متصل نیست</p>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>کلاینت‌ها باید به سرور وصل بشن</p>
          </div>
        ) : view === 'grid' ? (
          <div className="clients-grid">
            {clients.map(c => (
              <div
                key={c.socketId}
                className={`client-card ${c.status === 'active' ? 'active' : ''}`}
                onClick={() => setSelected(selected?.socketId === c.socketId ? null : c)}
              >
                {c.status === 'active' && <div className="online-dot" />}
                <span className="client-pc-icon">🖥️</span>
                <div className="client-name">{c.computerName}</div>
                <div className="client-user">
                  {c.username ? (
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>👤 {c.username}</span>
                  ) : (
                    <span>خالی</span>
                  )}
                </div>
                {c.status === 'active' && (
                  <>
                    <div className="client-credits">⏱ {c.credits} دقیقه مانده</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{elapsed(c.sessionStart)}</div>
                  </>
                )}
                {selected?.socketId === c.socketId && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }} onClick={e => e.stopPropagation()}>
                    {c.status === 'active' && (
                      <>
                        <button className="btn btn-green btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setExtendModal(c)}>⏰ افزایش وقت</button>
                        <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setMsgModal(c)}>💬 پیام</button>
                        <button className="btn btn-red btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => kick(c)}>⚡ اخراج</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>کامپیوتر</th>
                    <th>کاربر</th>
                    <th>اعتبار مانده</th>
                    <th>مدت جلسه</th>
                    <th>وضعیت</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map(c => (
                    <tr key={c.socketId}>
                      <td style={{ fontWeight: 700 }}>🖥️ {c.computerName}</td>
                      <td>{c.username || <span style={{ color: 'var(--text3)' }}>-</span>}</td>
                      <td style={{ color: 'var(--cyan)', fontWeight: 700 }}>{c.status === 'active' ? `${c.credits} دقیقه` : '-'}</td>
                      <td>{elapsed(c.sessionStart)}</td>
                      <td>
                        {c.status === 'active'
                          ? <span className="badge badge-green">● فعال</span>
                          : <span className="badge badge-gray">○ خالی</span>
                        }
                      </td>
                      <td>
                        {c.status === 'active' && (
                          <div className="btn-group">
                            <button className="btn btn-green btn-sm" onClick={() => setExtendModal(c)}>⏰ وقت</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setMsgModal(c)}>💬</button>
                            <button className="btn btn-red btn-sm" onClick={() => kick(c)}>⚡ اخراج</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Message Modal */}
      {msgModal && (
        <div className="modal-overlay" onClick={() => setMsgModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">💬 ارسال پیام به {msgModal.computerName}</h3>
            <div className="form-group">
              <label className="label">متن پیام</label>
              <textarea className="input" rows={3} value={msgText} onChange={e => setMsgText(e.target.value)} placeholder="پیام خود را وارد کنید..." style={{ resize: 'vertical' }} />
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setMsgModal(null)}>لغو</button>
              <button className="btn btn-primary" onClick={sendMsg}>📤 ارسال پیام</button>
            </div>
          </div>
        </div>
      )}

      {/* Extend Modal */}
      {extendModal && (
        <div className="modal-overlay" onClick={() => setExtendModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">⏰ افزایش وقت - {extendModal.computerName}</h3>
            <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 16 }}>کاربر: <strong style={{ color: 'var(--text)' }}>{extendModal.username}</strong></p>
            <div className="form-group">
              <label className="label">تعداد دقیقه</label>
              <input type="number" className="input" value={extendMin} onChange={e => setExtendMin(e.target.value)} min={1} max={1440} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 16 }}>
              {[30, 60, 120, 180].map(m => (
                <button key={m} className={`btn ${extendMin == m ? 'btn-primary' : 'btn-ghost'} btn-sm`} style={{ justifyContent: 'center' }} onClick={() => setExtendMin(m)}>{m} دقیقه</button>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setExtendModal(null)}>لغو</button>
              <button className="btn btn-green" onClick={extend}>✅ اضافه کردن وقت</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

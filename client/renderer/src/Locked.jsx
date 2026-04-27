import { useState } from 'react';

const ipc = window.electron || { quitApp: async () => {} };

export default function Locked({ onUnlock }) {
  const [adminCode, setAdminCode] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [err, setErr] = useState('');

  const handleAdminExit = async () => {
    const ok = await ipc.quitApp(adminCode);
    if (!ok) { setErr('رمز اشتباه است'); setTimeout(() => setErr(''), 3000); }
  };

  return (
    <div className="locked-screen">
      <div className="locked-bg" />

      <div className="locked-content">
        <span className="lock-icon">🔒</span>
        <h1 className="locked-title">سیستم قفل است</h1>
        <p className="locked-sub">برای استفاده از کامپیوتر، وارد شوید</p>

        <div className="locked-actions">
          <button className="locked-btn primary" onClick={onUnlock}>
            🚀 ورود به سیستم
          </button>
          <button className="locked-btn ghost" onClick={() => setShowAdmin(p => !p)}>
            ⚙️ خروج ادمین
          </button>
          {showAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 280, animation: 'fadeIn 0.2s ease' }}>
              {err && <div style={{ fontSize: 12, color: 'var(--red)', textAlign: 'center' }}>⚠️ {err}</div>}
              <input
                type="password"
                placeholder="رمز خروج ادمین"
                value={adminCode}
                onChange={e => setAdminCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdminExit()}
                style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', fontSize: 13, fontFamily: 'Vazirmatn, sans-serif', outline: 'none', direction: 'rtl' }}
              />
              <button onClick={handleAdminExit} className="locked-btn ghost" style={{ fontSize: 12 }}>تایید</button>
            </div>
          )}
        </div>

        <div style={{ marginTop: 48, fontSize: 12, color: 'var(--text3)' }}>
          🎮 MuteGame Internet Cafe
        </div>
      </div>
    </div>
  );
}

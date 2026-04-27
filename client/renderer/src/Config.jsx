import { useState } from 'react';

export default function Config({ config, onSave }) {
  const [form, setForm] = useState({
    serverUrl: config?.serverUrl || 'http://192.168.1.1:3001',
    computerName: config?.computerName || 'PC-01',
  });

  return (
    <div className="config-screen">
      <div className="config-card">
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <span style={{ fontSize: 48, display: 'block', marginBottom: 8 }}>⚙️</span>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>تنظیمات اتصال</h2>
          <p style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>اطلاعات اتصال به سرور MuteGame را وارد کنید</p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>آدرس IP سرور</label>
          <input
            className="input"
            placeholder="http://192.168.1.100:3001"
            value={form.serverUrl}
            onChange={e => setForm(p => ({ ...p, serverUrl: e.target.value }))}
            style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', width: '100%', fontSize: 14, fontFamily: 'monospace, Vazirmatn, sans-serif', outline: 'none', direction: 'ltr' }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>نام این کامپیوتر</label>
          <input
            className="input"
            placeholder="PC-01"
            value={form.computerName}
            onChange={e => setForm(p => ({ ...p, computerName: e.target.value }))}
            style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text)', width: '100%', fontSize: 14, fontFamily: 'Vazirmatn, sans-serif', outline: 'none' }}
          />
        </div>

        <button
          onClick={() => onSave(form)}
          style={{ width: '100%', padding: 14, background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', border: 'none', borderRadius: 12, color: 'white', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'Vazirmatn, sans-serif' }}
        >
          🔗 اتصال به سرور
        </button>

        <div style={{ marginTop: 16, padding: 14, background: 'rgba(6,182,212,0.06)', borderRadius: 10, border: '1px solid rgba(6,182,212,0.15)', fontSize: 11, color: 'var(--text3)' }}>
          💡 آدرس IP سرور را از ادمین گیم‌نت بخواهید
        </div>
      </div>
    </div>
  );
}

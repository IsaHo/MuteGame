import { useState } from 'react';

export default function Login({ serverUrl, onLogin }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!form.username || !form.password) return setErr('نام کاربری و رمز عبور الزامی است');
    setErr(''); setLoading(true);
    try {
      const res = await fetch(`${serverUrl}/api/auth/client/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطا در ورود');
      if (data.user.credits <= 0) throw new Error('اعتبار شما صفر است. لطفاً از ادمین شارژ بگیرید.');
      onLogin(data.user);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-bg" />
      <div className="grid-bg" />

      <div className="login-card">
        <div className="logo-area">
          <span className="logo-icon">🎮</span>
          <div className="logo-text">MuteGame</div>
          <div className="logo-sub">INTERNET CAFE</div>
        </div>

        {err && (
          <div className="error-box">⚠️ {err}</div>
        )}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="label">نام کاربری</label>
            <div className="input-wrap">
              <span className="input-icon">👤</span>
              <input
                className="input"
                placeholder="نام کاربری خود را وارد کنید"
                value={form.username}
                onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                autoFocus
              />
            </div>
          </div>
          <div className="form-group">
            <label className="label">رمز عبور</label>
            <div className="input-wrap">
              <span className="input-icon">🔒</span>
              <input
                className="input"
                type="password"
                placeholder="رمز عبور خود را وارد کنید"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              />
            </div>
          </div>
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? '⏳ در حال ورود...' : '🚀 ورود به سیستم'}
          </button>
        </form>

        <div className="server-info">
          🔗 متصل به سرور MuteGame
          <br />
          اگر اکانت ندارید، از ادمین گیم‌نت بخواهید
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function Login() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const data = await api.adminLogin(form.username, form.password);
      localStorage.setItem('mg_token', data.token);
      localStorage.setItem('mg_admin', data.username);
      navigate('/');
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-logo">
          <div className="login-logo-text">🎮 MuteGame</div>
          <p>سیستم مدیریت گیم‌نت حرفه‌ای</p>
        </div>

        <h2 className="login-title">ورود به پنل ادمین</h2>

        {err && <div className="alert alert-error">⚠️ {err}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="label">نام کاربری ادمین</label>
            <input
              className="input"
              placeholder="نام کاربری"
              value={form.username}
              onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label className="label">رمز عبور</label>
            <input
              className="input"
              type="password"
              placeholder="رمز عبور"
              value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              required
            />
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} type="submit" disabled={loading}>
            {loading ? '⏳ در حال ورود...' : '🔐 ورود به سیستم'}
          </button>
        </form>

        <div style={{ marginTop: 24, padding: 16, background: 'rgba(6,182,212,0.08)', borderRadius: 10, border: '1px solid rgba(6,182,212,0.2)', fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>
          پیش‌فرض: <strong style={{ color: 'var(--cyan)' }}>admin / admin123</strong>
        </div>
      </div>
    </div>
  );
}

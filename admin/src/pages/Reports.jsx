import { useEffect, useState } from 'react';
import { api, formatRial, formatDate, formatMinutes } from '../api';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Reports({ addToast }) {
  const [period, setPeriod] = useState(30);
  const [revenue, setRevenue] = useState([]);
  const [shop, setShop] = useState([]);
  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);

  const load = async () => {
    try {
      const [rev, sh, st, us, sess] = await Promise.all([
        api.getRevenueReport(period),
        api.getShopReport(period),
        api.getStats(),
        api.getUsers(),
        api.getSessions(),
      ]);
      setRevenue(rev); setShop(sh); setStats(st); setUsers(us); setSessions(sess);
    } catch { }
  };

  useEffect(() => { load(); }, [period]);

  const topUsers = [...users].sort((a, b) => b.total_minutes - a.total_minutes).slice(0, 10);

  const CustomTip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
        <p style={{ color: 'var(--text3)', marginBottom: 4 }}>{label}</p>
        {payload.map(p => <p key={p.name} style={{ color: p.stroke || p.fill, fontWeight: 700 }}>{formatRial(p.value)}</p>)}
      </div>
    );
  };

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">📈 گزارشات</span>
        <div className="topbar-right">
          {[7, 30, 90].map(d => (
            <button key={d} className={`btn btn-sm ${period === d ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPeriod(d)}>{d} روز</button>
          ))}
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24 }}>
        <div className="stat-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card purple"><div className="stat-icon purple">👥</div><div className="stat-value">{stats.totalUsers || 0}</div><div className="stat-label">کل کاربران</div></div>
          <div className="stat-card cyan"><div className="stat-icon cyan">🟢</div><div className="stat-value">{stats.activeNow || 0}</div><div className="stat-label">آنلاین الان</div></div>
          <div className="stat-card green"><div className="stat-icon green">💰</div><div className="stat-value" style={{ fontSize: 16 }}>{formatRial(stats.totalRevenue || 0)}</div><div className="stat-label">کل درآمد شارژ</div></div>
          <div className="stat-card yellow"><div className="stat-icon yellow">🛒</div><div className="stat-value" style={{ fontSize: 16 }}>{formatRial(stats.totalShopRevenue || 0)}</div><div className="stat-label">کل فروش شاپ</div></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div className="card">
            <p className="chart-title">💰 درآمد شارژ ({period} روز)</p>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={revenue}>
                <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} /><stop offset="95%" stopColor="#7c3aed" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                <Tooltip content={<CustomTip />} />
                <Area type="monotone" dataKey="charged" stroke="#7c3aed" fill="url(#g1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <p className="chart-title">🛒 فروش شاپ ({period} روز)</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={shop}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                <Tooltip content={<CustomTip />} />
                <Bar dataKey="revenue" fill="#06b6d4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Top Users */}
          <div className="card">
            <p className="chart-title">🏆 پرکاربردترین کاربران</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>کاربر</th><th>زمان کل</th><th>اعتبار</th></tr></thead>
                <tbody>
                  {topUsers.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text3)', padding: 30 }}>داده‌ای موجود نیست</td></tr>}
                  {topUsers.map((u, i) => (
                    <tr key={u.id}>
                      <td>
                        <span style={{ fontSize: 18 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}</span>
                      </td>
                      <td style={{ fontWeight: 700 }}>👤 {u.username}</td>
                      <td style={{ color: 'var(--cyan)' }}>{formatMinutes(u.total_minutes)}</td>
                      <td style={{ color: 'var(--green)', fontWeight: 700 }}>{u.credits} دقیقه</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Sessions */}
          <div className="card">
            <p className="chart-title">🕐 آخرین جلسات</p>
            <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>کاربر</th><th>PC</th><th>مدت</th><th>وضعیت</th></tr></thead>
                <tbody>
                  {sessions.slice(0, 20).map(s => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.username}</td>
                      <td style={{ fontSize: 12, color: 'var(--text3)' }}>{s.computer_name || '-'}</td>
                      <td style={{ color: 'var(--cyan)' }}>{s.duration} دقیقه</td>
                      <td>{s.end_time ? <span className="badge badge-gray">تمام</span> : <span className="badge badge-green">● فعال</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api, formatRial, formatDate } from '../api';
import socket from '../socket';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard({ addToast }) {
  const [stats, setStats] = useState({ totalUsers: 0, totalRevenue: 0, totalShopRevenue: 0, todayUsers: 0, activeNow: 0 });
  const [clients, setClients] = useState([]);
  const [chart, setChart] = useState([]);
  const [sessions, setSessions] = useState([]);

  const load = async () => {
    try {
      const [s, rev, sess] = await Promise.all([api.getStats(), api.getRevenueReport(7), api.getSessions()]);
      setStats(s);
      setChart(rev);
      setSessions(sess.slice(0, 8));
    } catch { }
  };

  useEffect(() => {
    load();
    api.getClients().then(setClients).catch(() => { });

    socket.on('clients:update', (c) => {
      setClients(c);
      setStats(p => ({ ...p, activeNow: c.filter(x => x.status === 'active').length }));
    });
    const interval = setInterval(load, 30000);
    return () => { socket.off('clients:update'); clearInterval(interval); };
  }, []);

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
        <p style={{ color: 'var(--text3)', marginBottom: 4 }}>{label}</p>
        <p style={{ color: 'var(--purple3)', fontWeight: 700 }}>{formatRial(payload[0]?.value)}</p>
      </div>
    );
  };

  const active = clients.filter(c => c.status === 'active');
  const idle = clients.filter(c => c.status === 'idle');

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">📊 داشبورد</span>
        <div className="topbar-right">
          <div className="online-badge">
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
            {stats.activeNow} نفر آنلاین
          </div>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>
            {new Date().toLocaleDateString('fa-IR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24 }}>
        {/* Stats */}
        <div className="stat-grid">
          <div className="stat-card purple">
            <div className="stat-icon purple">🖥️</div>
            <div className="stat-value">{clients.length}</div>
            <div className="stat-label">کامپیوتر متصل</div>
          </div>
          <div className="stat-card green">
            <div className="stat-icon green">🟢</div>
            <div className="stat-value">{stats.activeNow}</div>
            <div className="stat-label">در حال بازی</div>
          </div>
          <div className="stat-card cyan">
            <div className="stat-icon cyan">👥</div>
            <div className="stat-value">{stats.totalUsers}</div>
            <div className="stat-label">کل کاربران</div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-icon yellow">📅</div>
            <div className="stat-value">{stats.todayUsers}</div>
            <div className="stat-label">بازدید امروز</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          <div className="stat-card purple" style={{ gridColumn: '1 / 2' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="stat-icon purple">💰</div>
              <div>
                <div className="stat-value" style={{ fontSize: 20 }}>{formatRial(stats.totalRevenue)}</div>
                <div className="stat-label">کل درآمد شارژ</div>
              </div>
            </div>
          </div>
          <div className="stat-card cyan" style={{ gridColumn: '2 / 3' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="stat-icon cyan">🛒</div>
              <div>
                <div className="stat-value" style={{ fontSize: 20 }}>{formatRial(stats.totalShopRevenue)}</div>
                <div className="stat-label">کل فروش شاپ</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 24 }}>
          {/* Chart */}
          <div className="card">
            <p className="chart-title">📈 درآمد ۷ روز اخیر (ریال)</p>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chart}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="charged" stroke="#7c3aed" fill="url(#grad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Live PCs */}
          <div className="card">
            <p className="chart-title">🖥️ وضعیت کامپیوترها</p>
            {clients.length === 0 ? (
              <div className="empty"><div className="empty-icon">🔌</div><p className="empty-text">هیچ کامپیوتری متصل نیست</p></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                {clients.map(c => (
                  <div key={c.socketId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 8, border: `1px solid ${c.status === 'active' ? 'rgba(16,185,129,0.3)' : 'var(--border)'}` }}>
                    <span style={{ fontSize: 20 }}>🖥️</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{c.computerName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.username || 'خالی'}</div>
                    </div>
                    {c.status === 'active'
                      ? <span className="badge badge-green">● فعال</span>
                      : <span className="badge badge-gray">○ خالی</span>
                    }
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Sessions */}
        <div className="card">
          <p className="chart-title">🕐 آخرین جلسات بازی</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>کاربر</th>
                  <th>کامپیوتر</th>
                  <th>شروع</th>
                  <th>پایان</th>
                  <th>مدت (دقیقه)</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text3)', padding: 30 }}>جلسه‌ای ثبت نشده</td></tr>
                ) : sessions.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 700 }}>{s.username}</td>
                    <td>{s.computer_name || '-'}</td>
                    <td style={{ color: 'var(--text3)' }}>{formatDate(s.start_time)}</td>
                    <td style={{ color: 'var(--text3)' }}>{s.end_time ? formatDate(s.end_time) : '-'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--cyan)' }}>{s.duration} دقیقه</td>
                    <td>
                      {s.end_time
                        ? <span className="badge badge-gray">پایان یافته</span>
                        : <span className="badge badge-green">● در حال بازی</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

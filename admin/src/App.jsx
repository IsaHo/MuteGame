import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Users from './pages/Users';
import Shop from './pages/Shop';
import Reports from './pages/Reports';
import Accounting from './pages/Accounting';
import Settings from './pages/Settings';
import socket from './socket';
import { api, formatRial, formatDate } from './api';

export const ToastContext = createContext(null);

function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span>{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}</span>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

function OrderNotifPanel({ orders, onApprove, onCancel, onClose }) {
  if (!orders.length) return (
    <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
      هیچ سفارش در انتظاری وجود ندارد
    </div>
  );
  return (
    <div style={{ maxHeight: 420, overflowY: 'auto' }}>
      {orders.map(o => (
        <div key={o.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>
                {o.computer_name || 'نامشخص'}
              </span>
              {o.username && <span style={{ fontSize: 12, color: 'var(--text3)', marginRight: 8 }}>کاربر: {o.username}</span>}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{formatDate(o.created_at)}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            {(o.items || []).map(i => `${i.emoji || ''} ${i.name} ×${i.qty}`).join('  |  ')}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 800, color: 'var(--green)', fontSize: 14 }}>{formatRial(o.total)}</span>
              <span style={{ fontSize: 11, color: o.payment_method === 'credits' ? 'var(--purple3)' : 'var(--yellow)', marginRight: 8 }}>
                {o.payment_method === 'credits' ? '⭐ از شارژ' : '💵 نقدی'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => onApprove(o.id)}
                style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--green)', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'Vazirmatn, sans-serif' }}>
                ✅ تایید
              </button>
              <button
                onClick={() => onCancel(o.id)}
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--red)', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'Vazirmatn, sans-serif' }}>
                ❌ لغو
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Sidebar({ onlineCount, pendingOrders, onApproveOrder, onCancelOrder }) {
  const navigate = useNavigate();
  const admin = localStorage.getItem('mg_admin') || 'ادمین';
  const [showNotif, setShowNotif] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('mg_token');
    localStorage.removeItem('mg_admin');
    navigate('/login');
  };

  const links = [
    { to: '/', icon: '📊', label: 'داشبورد' },
    { to: '/clients', icon: '🖥️', label: 'کامپیوترها' },
    { to: '/users', icon: '👤', label: 'کاربران' },
    { to: '/shop', icon: '🛒', label: 'شاپ' },
    { to: '/accounting', icon: '📒', label: 'حسابداری' },
    { to: '/reports', icon: '📈', label: 'گزارشات' },
    { to: '/settings', icon: '⚙️', label: 'تنظیمات' },
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <h1>🎮 MuteGame</h1>
        <p>پنل مدیریت گیم‌نت</p>
      </div>
      <nav className="sidebar-nav">
        {links.map(l => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="icon">{l.icon}</span>
            {l.label}
            {l.to === '/clients' && onlineCount > 0 && (
              <span style={{ marginRight: 'auto', background: 'var(--green)', color: '#000', padding: '1px 7px', borderRadius: '20px', fontSize: '11px', fontWeight: 800 }}>
                {onlineCount}
              </span>
            )}
            {l.to === '/shop' && pendingOrders.length > 0 && (
              <span style={{ marginRight: 'auto', background: 'var(--yellow)', color: '#000', padding: '1px 7px', borderRadius: '20px', fontSize: '11px', fontWeight: 800 }}>
                {pendingOrders.length}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Order notifications bell */}
      <div style={{ padding: '0 12px 8px', position: 'relative' }}>
        <button
          onClick={() => setShowNotif(p => !p)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            background: pendingOrders.length > 0 ? 'rgba(245,158,11,0.12)' : 'var(--bg2)',
            border: pendingOrders.length > 0 ? '1px solid rgba(245,158,11,0.3)' : '1px solid var(--border)',
            borderRadius: 10, cursor: 'pointer', color: pendingOrders.length > 0 ? 'var(--yellow)' : 'var(--text3)',
            fontFamily: 'Vazirmatn, sans-serif', fontSize: 13, fontWeight: 600,
          }}>
          🔔 سفارشات در انتظار
          {pendingOrders.length > 0 && (
            <span style={{ marginRight: 'auto', background: 'var(--yellow)', color: '#000', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 900 }}>
              {pendingOrders.length}
            </span>
          )}
        </button>

        {showNotif && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 8,
            background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 14,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 999,
          }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>🔔 سفارشات جدید</span>
              <button onClick={() => setShowNotif(false)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <OrderNotifPanel
              orders={pendingOrders}
              onApprove={(id) => { onApproveOrder(id); }}
              onCancel={(id) => { onCancelOrder(id); }}
              onClose={() => setShowNotif(false)}
            />
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10, textAlign: 'center' }}>
          👑 {admin}
        </div>
        <button className="logout-btn" onClick={handleLogout}>🚪 خروج از سیستم</button>
      </div>
    </div>
  );
}

function Layout() {
  const [onlineCount, setOnlineCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);

  const addToast = (msg, type = 'success') => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  };

  const loadPendingOrders = async () => {
    try {
      const orders = await api.getOrders('pending');
      setPendingOrders(orders);
    } catch {}
  };

  const handleApproveOrder = async (id) => {
    try {
      await api.approveOrder(id);
      setPendingOrders(p => p.filter(o => o.id !== id));
      addToast('سفارش تایید شد ✅', 'success');
    } catch (e) { addToast(e.message, 'error'); }
  };

  const handleCancelOrder = async (id) => {
    try {
      await api.cancelOrder(id);
      setPendingOrders(p => p.filter(o => o.id !== id));
      addToast('سفارش لغو شد', 'info');
    } catch (e) { addToast(e.message, 'error'); }
  };

  useEffect(() => {
    loadPendingOrders();

    socket.on('clients:update', (clients) => {
      setOnlineCount(clients.filter(c => c.status === 'active').length);
    });

    socket.on('order:new', (order) => {
      setPendingOrders(p => {
        if (p.find(o => o.id === order.id)) return p;
        return [order, ...p];
      });
      addToast(`🛒 سفارش جدید از ${order.computer_name || 'نامشخص'} — ${order.items?.map(i => i.name).join(', ')}`, 'info');
    });

    return () => {
      socket.off('clients:update');
      socket.off('order:new');
    };
  }, []);

  const token = localStorage.getItem('mg_token');
  if (!token) return <Navigate to="/login" />;

  return (
    <ToastContext.Provider value={addToast}>
      <div className="layout">
        <Sidebar
          onlineCount={onlineCount}
          pendingOrders={pendingOrders}
          onApproveOrder={handleApproveOrder}
          onCancelOrder={handleCancelOrder}
        />
        <div className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard addToast={addToast} />} />
            <Route path="/clients" element={<Clients addToast={addToast} />} />
            <Route path="/users" element={<Users addToast={addToast} />} />
            <Route path="/shop" element={<Shop addToast={addToast} pendingOrders={pendingOrders} onApproveOrder={handleApproveOrder} onCancelOrder={handleCancelOrder} />} />
            <Route path="/accounting" element={<Accounting addToast={addToast} />} />
            <Route path="/reports" element={<Reports addToast={addToast} />} />
            <Route path="/settings" element={<Settings addToast={addToast} />} />
          </Routes>
        </div>
        <Toast toasts={toasts} />
      </div>
    </ToastContext.Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<Layout />} />
      </Routes>
    </BrowserRouter>
  );
}

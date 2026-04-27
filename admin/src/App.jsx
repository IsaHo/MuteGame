import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Clients from './pages/Clients';
import Users from './pages/Users';
import Shop from './pages/Shop';
import Reports from './pages/Reports';
import Accounting from './pages/Accounting';
import socket from './socket';

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

function Sidebar({ onlineCount }) {
  const navigate = useNavigate();
  const admin = localStorage.getItem('mg_admin') || 'ادمین';

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
          </NavLink>
        ))}
      </nav>
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

  const addToast = (msg, type = 'success') => {
    const id = Date.now();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  };

  useEffect(() => {
    socket.on('clients:update', (clients) => {
      setOnlineCount(clients.filter(c => c.status === 'active').length);
    });
    return () => socket.off('clients:update');
  }, []);

  const token = localStorage.getItem('mg_token');
  if (!token) return <Navigate to="/login" />;

  return (
    <ToastContext.Provider value={addToast}>
      <div className="layout">
        <Sidebar onlineCount={onlineCount} />
        <div className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard addToast={addToast} />} />
            <Route path="/clients" element={<Clients addToast={addToast} />} />
            <Route path="/users" element={<Users addToast={addToast} />} />
            <Route path="/shop" element={<Shop addToast={addToast} />} />
            <Route path="/accounting" element={<Accounting addToast={addToast} />} />
            <Route path="/reports" element={<Reports addToast={addToast} />} />
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

import { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import Login from './Login';
import Desktop from './Desktop';
import Locked from './Locked';
import Config from './Config';

const ipc = window.electron || {
  getConfig: async () => ({ serverUrl: 'http://localhost:3001', computerName: 'PC-01' }),
  saveConfig: async () => {},
  getComputerName: async () => 'PC-01',
  lockScreen: async () => {},
  unlockScreen: async () => {},
};

export default function App() {
  const [state, setState] = useState('loading'); // loading | config | login | active | locked
  const [config, setConfig] = useState(null);
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);
  const [sessionStart, setSessionStart] = useState(null);
  const [notification, setNotification] = useState(null);
  const [shopItems, setShopItems] = useState([]);

  const showNotif = useCallback((msg, dur = 4000) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), dur);
  }, []);

  useEffect(() => {
    ipc.getConfig().then(cfg => {
      setConfig(cfg);
      if (!cfg.serverUrl) { setState('config'); return; }
      connectSocket(cfg);
    });
  }, []);

  const connectSocket = (cfg) => {
    const sock = io(cfg.serverUrl, { transports: ['websocket'], reconnection: true, reconnectionDelay: 3000 });

    sock.on('connect', () => {
      console.log('Connected to server');
      sock.emit('client:register', { computerId: cfg.computerName, computerName: cfg.computerName });
      setState('login');
    });

    sock.on('connect_error', () => setState('config'));

    sock.on('credits:update', ({ credits: c }) => {
      setCredits(c);
      if (c <= 5 && c > 0) showNotif(`⚠️ فقط ${c} دقیقه اعتبار دارید! شارژ کنید.`);
    });

    sock.on('credits:low', ({ credits: c }) => {
      showNotif(`⏰ اعتبار شما کم است: ${c} دقیقه`, 6000);
    });

    sock.on('session:end', ({ reason }) => {
      if (reason === 'no_credits') showNotif('⛔ اعتبار شما تمام شد!', 5000);
      else if (reason === 'admin_kick') showNotif('⚡ جلسه توسط ادمین پایان یافت', 5000);
      setUser(null); setCredits(0); setSessionStart(null);
      setState('locked');
      ipc.lockScreen();
    });

    sock.on('admin:message', ({ text }) => {
      showNotif(`📢 پیام از ادمین: ${text}`, 8000);
    });

    setSocket(sock);

    // Load shop items
    fetch(`${cfg.serverUrl}/api/shop/items`).then(r => r.json()).then(items => setShopItems(items.filter(i => i.active))).catch(() => { });
  };

  const handleLogin = useCallback((userData) => {
    setUser(userData);
    setCredits(userData.credits);
    setSessionStart(new Date());
    setState('active');
    ipc.unlockScreen();

    if (socket) {
      socket.emit('client:login', {
        userId: userData.id,
        username: userData.username,
        credits: userData.credits,
      });

      // Start session on server
      fetch(`${config.serverUrl}/api/sessions/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userData.id, computerName: config.computerName }),
      }).catch(() => { });
    }
    showNotif(`🎮 خوش آمدید ${userData.username}! ${userData.credits} دقیقه اعتبار دارید.`);
  }, [socket, config]);

  const handleLogout = useCallback(() => {
    if (!user) return;
    socket?.emit('client:logout');
    fetch(`${config.serverUrl}/api/sessions/end`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    }).catch(() => { });
    setUser(null); setCredits(0); setSessionStart(null);
    setState('locked');
    ipc.lockScreen();
  }, [user, socket, config]);

  const saveConfig = async (newCfg) => {
    await ipc.saveConfig(newCfg);
    setConfig(newCfg);
    connectSocket(newCfg);
    setState('login');
  };

  if (state === 'loading') {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#07071a', gap: 16 }}>
        <span style={{ fontSize: 60 }}>🎮</span>
        <div style={{ fontSize: 24, fontWeight: 900, background: 'linear-gradient(135deg, #a78bfa, #06b6d4)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>MuteGame</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>در حال اتصال به سرور...</div>
        <div style={{ width: 40, height: 40, border: '3px solid #1e1e4a', borderTop: '3px solid #7c3aed', borderRadius: '50%', animation: 'spin 1s linear infinite', marginTop: 8 }} />
      </div>
    );
  }

  if (state === 'config') return <Config config={config} onSave={saveConfig} />;

  return (
    <div style={{ height: '100vh', position: 'relative' }}>
      {state === 'login' && <Login serverUrl={config?.serverUrl} onLogin={handleLogin} />}
      {state === 'active' && (
        <Desktop
          user={user}
          credits={credits}
          sessionStart={sessionStart}
          shopItems={shopItems}
          serverUrl={config?.serverUrl}
          onLogout={handleLogout}
        />
      )}
      {state === 'locked' && <Locked onUnlock={() => setState('login')} />}
      {notification && <div className="notification">🔔 {notification}</div>}
    </div>
  );
}

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
  const [state, setState] = useState('loading');
  const [config, setConfig] = useState(null);
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);
  const [debt, setDebt] = useState(0);
  const [sessionStart, setSessionStart] = useState(null);
  const [notification, setNotification] = useState(null);
  const [shopItems, setShopItems] = useState([]);
  const [gameSettings, setGameSettings] = useState({ gaming_price_per_hour: 30000 });

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
      sock.emit('client:register', { computerId: cfg.computerName, computerName: cfg.computerName });
      setState('login');

      // Load settings and shop items
      fetch(`${cfg.serverUrl}/api/settings`).then(r => r.json()).then(s => setGameSettings(s)).catch(() => {});
      fetch(`${cfg.serverUrl}/api/shop/items`).then(r => r.json()).then(items => setShopItems(items.filter(i => i.active))).catch(() => {});
    });

    sock.on('connect_error', () => setState('config'));

    sock.on('credits:update', ({ credits: c, debt: d }) => {
      setCredits(c);
      if (d !== undefined) setDebt(d);
      const pricePerHour = Number(gameSettings.gaming_price_per_hour || 30000);
      if (c <= pricePerHour && c > 0) {
        const minsLeft = Math.floor(c / (pricePerHour / 60));
        showNotif(`⚠️ فقط ${minsLeft} دقیقه اعتبار دارید! شارژ کنید.`);
      }
    });

    sock.on('credits:low', ({ credits: c }) => {
      const pricePerHour = Number(gameSettings.gaming_price_per_hour || 30000);
      const minsLeft = Math.floor(c / (pricePerHour / 60));
      showNotif(`⏰ اعتبار کم است: ${minsLeft} دقیقه`, 6000);
    });

    sock.on('session:end', ({ reason }) => {
      if (reason === 'no_credits') showNotif('⛔ اعتبار شما تمام شد!', 5000);
      else if (reason === 'admin_kick') showNotif('⚡ جلسه توسط ادمین پایان یافت', 5000);
      else if (reason === 'account_disabled') showNotif('⛔ حساب شما غیرفعال شد', 5000);
      setUser(null); setCredits(0); setDebt(0); setSessionStart(null);
      setState('locked');
      ipc.lockScreen();
    });

    sock.on('admin:message', ({ text }) => {
      showNotif(`📢 پیام از ادمین: ${text}`, 8000);
    });

    sock.on('order:approved', () => {
      showNotif('✅ سفارش شما تایید شد! به زودی تحویل داده می‌شه 🚀', 6000);
    });

    sock.on('order:cancelled', () => {
      showNotif('❌ سفارش شما لغو شد. با ادمین تماس بگیرید.', 6000);
    });

    setSocket(sock);
  };

  const handleLogin = useCallback((userData) => {
    setUser(userData);
    setCredits(userData.credits);
    setDebt(userData.debt || 0);
    setSessionStart(new Date());
    setState('active');
    ipc.unlockScreen();

    if (socket) {
      socket.emit('client:login', {
        userId: userData.id,
        username: userData.username,
        credits: userData.credits,
      });
    }
    const pricePerHour = Number(gameSettings.gaming_price_per_hour || 30000);
    const minsLeft = Math.floor(userData.credits / (pricePerHour / 60));
    showNotif(`🎮 خوش آمدید ${userData.username}! حدود ${minsLeft} دقیقه اعتبار دارید.`);
  }, [socket, config, gameSettings]);

  const handleLogout = useCallback(() => {
    if (!user) return;
    socket?.emit('client:logout');
    setUser(null); setCredits(0); setDebt(0); setSessionStart(null);
    setState('locked');
    ipc.lockScreen();
  }, [user, socket]);

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
          debt={debt}
          sessionStart={sessionStart}
          shopItems={shopItems}
          serverUrl={config?.serverUrl}
          gameSettings={gameSettings}
          onLogout={handleLogout}
        />
      )}
      {state === 'locked' && <Locked onUnlock={() => setState('login')} />}
      {notification && <div className="notification">🔔 {notification}</div>}
    </div>
  );
}

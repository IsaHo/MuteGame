import { useState, useEffect, useRef } from 'react';

const GAMES = [
  { name: 'Steam', icon: '🎮', path: 'steam://' },
  { name: 'Battle.net', icon: '⚔️', path: '' },
  { name: 'Epic Games', icon: '🎯', path: '' },
  { name: 'Discord', icon: '💬', path: '' },
  { name: 'Chrome', icon: '🌐', path: '' },
  { name: 'CS2', icon: '🔫', path: '' },
  { name: 'Valorant', icon: '🎯', path: '' },
  { name: 'FIFA', icon: '⚽', path: '' },
];

const ipc = window.electron || { openGame: async () => {}, minimize: async () => {} };

export default function Desktop({ user, credits, sessionStart, shopItems, serverUrl, onLogout }) {
  const [clock, setClock] = useState(new Date());
  const [elapsed, setElapsed] = useState(0);
  const [cartModal, setCartModal] = useState(false);
  const [cart, setCart] = useState([]);
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderDone, setOrderDone] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(new Date());
      if (sessionStart) setElapsed(Math.floor((Date.now() - sessionStart) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionStart]);

  const creditLevel = credits <= 5 ? 'low' : credits <= 15 ? 'warn' : '';
  const totalMin = credits + Math.floor(elapsed / 60);
  const progress = totalMin > 0 ? (credits / totalMin) * 283 : 0;

  const formatElapsed = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const addToCart = (item) => {
    setCart(c => {
      const ex = c.find(x => x.id === item.id);
      if (ex) return c.map(x => x.id === item.id ? { ...x, qty: x.qty + 1 } : x);
      return [...c, { ...item, qty: 1 }];
    });
  };

  const total = cart.reduce((s, x) => s + x.price * x.qty, 0);

  const sendOrder = async () => {
    if (!cart.length) return;
    setOrderLoading(true);
    try {
      await fetch(`${serverUrl}/api/shop/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          computerName: window.electron ? 'client' : 'unknown',
          items: cart.map(x => ({ id: x.id, name: x.name, qty: x.qty, price: x.price })),
          total,
          paymentMethod: 'cash',
        }),
      });
      setCart([]); setOrderDone(true);
      setTimeout(() => { setOrderDone(false); setCartModal(false); }, 2500);
    } catch (e) { alert('خطا در ثبت سفارش'); }
    setOrderLoading(false);
  };

  const formatRial = (n) => Number(n).toLocaleString('fa-IR') + ' ریال';

  return (
    <div className="desktop-screen">
      {/* Top Bar */}
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="topbar-logo">🎮 MuteGame</span>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>خوش آمدی، <strong style={{ color: 'var(--text)' }}>{user?.username}</strong></span>
        </div>

        <div className="topbar-right">
          <div className={`credit-badge ${creditLevel}`}>
            <span style={{ fontSize: 20 }}>⏱</span>
            <div>
              <div className="credit-amount">{credits}</div>
              <div className="credit-label">دقیقه مانده</div>
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div className="clock">{clock.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            <div className="date-text">{clock.toLocaleDateString('fa-IR', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          </div>

          <button onClick={() => setCartModal(true)} style={{ position: 'relative', background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.2)', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', color: 'var(--cyan)', fontSize: 18, fontFamily: 'Vazirmatn, sans-serif' }}>
            🛒
            {cart.length > 0 && <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--red)', color: 'white', width: 16, height: 16, borderRadius: '50%', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{cart.reduce((s, x) => s + x.qty, 0)}</span>}
          </button>

          <button onClick={onLogout} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', color: 'var(--red)', fontSize: 18 }}>🚪</button>
        </div>
      </div>

      {/* Body */}
      <div className="desktop-body">
        {/* Left shortcuts */}
        <div className="shortcuts-bar">
          {GAMES.map(g => (
            <button key={g.name} className="shortcut-btn" onClick={() => ipc.openGame(g.path)}>
              <span className="s-icon">{g.icon}</span>
              {g.name}
            </button>
          ))}
        </div>

        {/* Main */}
        <div className="desktop-main">
          {/* Welcome */}
          <div className="welcome-card">
            <div className="welcome-text">
              <h2>سلام {user?.username}! 👋</h2>
              <p>زمان بازی: {formatElapsed(elapsed)}</p>
              {credits <= 5 && credits > 0 && (
                <p style={{ color: 'var(--red)', fontWeight: 700, marginTop: 6, fontSize: 13 }}>⚠️ اعتبار رو به اتمام است! از ادمین شارژ بگیرید</p>
              )}
            </div>

            {/* Timer circle */}
            <div className="session-timer">
              <div className="timer-circle">
                <svg width="90" height="90">
                  <circle className="timer-bg" cx="45" cy="45" r="38" />
                  <circle
                    className="timer-prog"
                    cx="45" cy="45" r="38"
                    strokeDasharray="283"
                    strokeDashoffset={283 - progress}
                    style={{ stroke: credits <= 5 ? 'var(--red)' : credits <= 15 ? 'var(--yellow)' : 'var(--cyan)' }}
                  />
                </svg>
                <div className="timer-inner">
                  <div className="timer-num" style={{ color: credits <= 5 ? 'var(--red)' : 'var(--text)' }}>{credits}</div>
                  <div className="timer-unit">دقیقه</div>
                </div>
              </div>
              <div className="session-elapsed">⏱ {formatElapsed(elapsed)}</div>
            </div>
          </div>

          {/* Info */}
          <div className="info-grid">
            <div className="info-card">
              <div className="info-icon">🎮</div>
              <div className="info-val">{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}</div>
              <div className="info-label">زمان بازی امروز</div>
            </div>
            <div className="info-card">
              <div className="info-icon">⏱</div>
              <div className="info-val">{credits}</div>
              <div className="info-label">دقیقه باقی‌مانده</div>
            </div>
            <div className="info-card">
              <div className="info-icon">👤</div>
              <div className="info-val" style={{ fontSize: 14 }}>{user?.username}</div>
              <div className="info-label">نام کاربری شما</div>
            </div>
          </div>

          {/* Shop */}
          {shopItems.length > 0 && (
            <div className="shop-section">
              <h3>🛒 سفارش از شاپ گیم‌نت</h3>
              <div className="shop-items-grid">
                {shopItems.slice(0, 12).map(item => (
                  <button key={item.id} className="shop-item-btn" onClick={() => { addToCart(item); }}>
                    <span className="si-emoji">{item.emoji}</span>
                    <div className="si-name">{item.name}</div>
                    <div className="si-price">{formatRial(item.price)}</div>
                  </button>
                ))}
              </div>
              {cart.length > 0 && (
                <div style={{ marginTop: 10, padding: '10px 16px', background: 'rgba(6,182,212,0.1)', borderRadius: 10, border: '1px solid rgba(6,182,212,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--cyan)' }}>🛒 {cart.reduce((s, x) => s + x.qty, 0)} آیتم انتخاب شده</span>
                  <button onClick={() => setCartModal(true)} style={{ background: 'var(--cyan)', border: 'none', borderRadius: 8, padding: '6px 14px', color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 12, fontFamily: 'Vazirmatn, sans-serif' }}>
                    ثبت سفارش ({formatRial(total)})
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Cart Modal */}
      {cartModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }} onClick={() => !orderLoading && setCartModal(false)}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 28, width: 400, animation: 'fadeIn 0.2s ease' }} onClick={e => e.stopPropagation()}>
            {orderDone ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 60, marginBottom: 16 }}>✅</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)' }}>سفارش ثبت شد!</div>
                <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 8 }}>پیک سفارش شما رو میاره 🚀</div>
              </div>
            ) : (
              <>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>🛒 سبد خرید شما</h3>
                {cart.length === 0 ? (
                  <p style={{ color: 'var(--text3)', textAlign: 'center', padding: '20px 0' }}>سبد خالی است</p>
                ) : (
                  <div style={{ marginBottom: 16 }}>
                    {cart.map(item => (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 24 }}>{item.emoji}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{formatRial(item.price)} × {item.qty}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button onClick={() => setCart(c => c.map(x => x.id === item.id ? { ...x, qty: Math.max(1, x.qty - 1) } : x))} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: 'var(--text)', fontSize: 14 }}>-</button>
                          <span style={{ fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{item.qty}</span>
                          <button onClick={() => setCart(c => c.map(x => x.id === item.id ? { ...x, qty: x.qty + 1 } : x))} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: 'var(--text)', fontSize: 14 }}>+</button>
                          <button onClick={() => setCart(c => c.filter(x => x.id !== item.id))} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, width: 24, height: 24, cursor: 'pointer', color: 'var(--red)', fontSize: 12 }}>✕</button>
                        </div>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', fontWeight: 800, fontSize: 15 }}>
                      <span>جمع کل:</span>
                      <span style={{ color: 'var(--green)' }}>{formatRial(total)}</span>
                    </div>
                  </div>
                )}
                <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,0.1)', borderRadius: 10, border: '1px solid rgba(245,158,11,0.2)', fontSize: 12, color: 'var(--yellow)', marginBottom: 14 }}>
                  ℹ️ پرداخت نقدی هنگام تحویل
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setCartModal(false)} style={{ flex: 1, padding: 12, background: 'transparent', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text2)', cursor: 'pointer', fontSize: 13, fontFamily: 'Vazirmatn, sans-serif' }}>لغو</button>
                  <button onClick={sendOrder} disabled={orderLoading || !cart.length} style={{ flex: 2, padding: 12, background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', border: 'none', borderRadius: 10, color: 'white', cursor: 'pointer', fontWeight: 700, fontSize: 14, fontFamily: 'Vazirmatn, sans-serif' }}>
                    {orderLoading ? '⏳ در حال ثبت...' : '✅ ثبت سفارش'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { io } from 'socket.io-client';
import Login from './Login';
import Desktop from './Desktop';
import Locked from './Locked';
import Config from './Config';
import Loading from './Loading';
import AdminPanel from './AdminPanel';
import ToastStack, { toast } from './components/Toast';
import AdminAuthModal from './components/AdminExitModal';
import ReconnectOverlay from './ReconnectOverlay';
import {
  reducer as sessionReducer,
  initial as sessionInitial,
  SESSION_STATES,
  isOverlayVisible,
  canEmitResume,
  shouldKillActiveGame,
} from './sessionStateMachine';

const ipc = window.electron || {
  getConfig: async () => ({ serverUrl: 'http://localhost:3001', computerName: 'PC-01' }),
  saveConfig: async () => {},
  getComputerName: async () => 'PC-01',
  lockScreen: async () => {},
  unlockScreen: async () => {},
  quitApp: async () => false,
  // Hardcoded default removed — without the Electron IPC bridge the renderer
  // can't authenticate against the scrypt-hashed admin store, so we fail
  // closed. The real bridge from preload.js is what gets used in production.
  verifyAdminPassword: async () => false,
  adminSetupRequired: async () => false,
  adminSetInitialPassword: async () => ({ ok: false, error: 'IPC bridge missing' }),
  adminShutdown: async () => ({ ok: false, error: 'IPC bridge missing' }),
  setLauncherActive: async () => true,
  setPolicy: async () => true,
  shutdownSystem: async () => true,
  restartSystem: async () => true,
  onAdminExitRequested: () => () => {},
  findGameExe: async () => ({ found: false }),
  launchGame: async () => ({ ok: false, error: 'IPC missing' }),
  applyClientAssignment: async () => ({ ok: false }),
  // Phase 4B fallbacks — in-renderer-only (lost on reload).
  sessionGet: async () => null,
  sessionSet: async () => false,
  sessionClear: async () => true,
  sessionKillActiveGame: async () => ({ ok: true, killed: false }),
};

/* ─── Web Audio warning sounds ─────────────────────────────────────── */
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  return audioCtx;
}
function playWarn(kind = 'beep', volume = 0.7) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const v = Math.max(0, Math.min(1, volume));
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  gain.gain.value = v * 0.4;

  if (kind === 'beep') {
    osc.frequency.value = 880;
    osc.type = 'sine';
    osc.start(); setTimeout(() => osc.stop(), 200);
  } else if (kind === 'chime') {
    osc.frequency.value = 660;
    osc.type = 'triangle';
    osc.start();
    setTimeout(() => { osc.frequency.value = 880; }, 180);
    setTimeout(() => { osc.frequency.value = 1100; }, 360);
    setTimeout(() => osc.stop(), 600);
  } else if (kind === 'siren') {
    osc.type = 'sawtooth';
    osc.frequency.value = 400;
    osc.start();
    let f = 400, dir = 1;
    const id = setInterval(() => {
      f += dir * 80; if (f > 1200) dir = -1; if (f < 400) dir = 1;
      osc.frequency.value = f;
    }, 60);
    setTimeout(() => { clearInterval(id); osc.stop(); }, 1500);
  }
}

/* ─── First-run admin password setup ──────────────────────────────────
 * Rendered as a blocking overlay until the operator chooses an exit
 * password on a fresh install. Kiosk lockdown stays deferred on the
 * main side until this completes — otherwise the install would be
 * unexitable. After success the parent continues the normal cold-start
 * (read config, connect socket, etc.). */
function AdminSetupOverlay({ onDone }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e?.preventDefault?.();
    setErr('');
    if (pw.length < 6) return setErr('رمز باید حداقل ۶ کاراکتر باشد');
    if (pw !== pw2) return setErr('رمز و تکرار یکسان نیستند');
    setSaving(true);
    try {
      const r = await window.electron?.adminSetInitialPassword?.(pw);
      if (!r || r.ok === false) return setErr(r?.error || 'خطا در ذخیره رمز');
      onDone?.();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999999,
      background: 'rgba(5,5,16,0.96)', backdropFilter: 'blur(10px)',
      display: 'grid', placeItems: 'center', direction: 'rtl',
      fontFamily: 'Vazirmatn, Tahoma, sans-serif',
    }}>
      <form onSubmit={submit} style={{
        width: 'min(420px, 92vw)', padding: '28px 30px',
        background: 'linear-gradient(145deg, rgba(30,20,60,0.96), rgba(15,10,30,0.96))',
        border: '1px solid rgba(139,92,246,0.35)',
        borderRadius: 18,
        boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 0 4px rgba(139,92,246,0.12)',
        color: '#e5e7ff',
      }}>
        <div style={{ fontSize: 38, textAlign: 'center', marginBottom: 8 }}>🔐</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, textAlign: 'center', marginBottom: 6 }}>
          راه‌اندازی اولیه — رمز خروج ادمین
        </h2>
        <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginBottom: 18, lineHeight: 1.7 }}>
          این رمز برای خروج از کیوسک و دسترسی به پنل ادمین لازم است.
          آن را در جای امن نگه‌دار — تا قبل از تعیین آن، قفل کیوسک فعال نمی‌شود.
        </p>
        {err && (
          <div style={{
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
            color: '#fca5a5', padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13,
          }}>⚠️ {err}</div>
        )}
        <input
          type="password" placeholder="رمز جدید (حداقل ۶ کاراکتر)"
          value={pw} onChange={e => setPw(e.target.value)} autoFocus
          style={{ width: '100%', padding: '12px 14px', marginBottom: 10, borderRadius: 10,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)',
            color: '#fff', fontSize: 14, direction: 'ltr', textAlign: 'right' }}
        />
        <input
          type="password" placeholder="تکرار رمز"
          value={pw2} onChange={e => setPw2(e.target.value)}
          style={{ width: '100%', padding: '12px 14px', marginBottom: 16, borderRadius: 10,
            background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)',
            color: '#fff', fontSize: 14, direction: 'ltr', textAlign: 'right' }}
        />
        <button type="submit" disabled={saving} style={{
          width: '100%', padding: '12px 16px', borderRadius: 10, border: 'none',
          background: 'linear-gradient(135deg, #8b5cf6, #22d3ee)',
          color: '#0b0420', fontWeight: 800, fontSize: 14, cursor: 'pointer',
          opacity: saving ? 0.6 : 1,
        }}>
          {saving ? '⏳ در حال ذخیره…' : '✅ ذخیره و فعال‌سازی قفل کیوسک'}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState('loading');
  const [loadingStatus, setLoadingStatus] = useState('در حال اتصال به سرور…');
  const [config, setConfig] = useState(null);
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [credits, setCredits] = useState(0);
  const [debt, setDebt] = useState(0);
  const [sessionStart, setSessionStart] = useState(null);
  const [shopItems, setShopItems] = useState([]);
  const [serverGames, setServerGames] = useState([]);
  const [warnSettings, setWarnSettings] = useState({ warn_at_minutes: '10,5,1', warn_sound: 'beep', warn_volume: '70' });
  const [gameSettings, setGameSettings] = useState({ gaming_price_per_hour: 30000 });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [connectError, setConnectError] = useState(null);
  const lastWarnedThreshold = useRef(null);
  const handleLoginRef = useRef(null);
  const userRef = useRef(null);

  // ─── Phase 4B — recovery state machine ─────────────────────────────
  // Lives alongside the existing `state` (which tracks UI screens like
  // 'loading'/'login'/'active'/'locked'/'config'). The recovery reducer
  // adds GRACE_*/RECOVERING/RECOVERED on top. Overlay renders when the
  // reducer says so; underlying screen stays mounted.
  const [recovery, recoveryDispatch] = useReducer(sessionReducer, sessionInitial);
  const recoveryRef = useRef(recovery);
  useEffect(() => { recoveryRef.current = recovery; }, [recovery]);

  // Grace-tick timer — drives GRACE_SOFT → GRACE_MEDIUM → GRACE_HARD
  // escalation based on lockout_level. Cleaned up on state exit.
  useEffect(() => {
    const cur = recovery.state;
    if (cur !== SESSION_STATES.GRACE_SOFT
        && cur !== SESSION_STATES.GRACE_MEDIUM
        && cur !== SESSION_STATES.GRACE_HARD) {
      return undefined;
    }
    const startMs = recovery.disconnect_at || Date.now();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      recoveryDispatch({ type: 'GRACE_TIMER', elapsed_seconds: elapsed });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [recovery.state, recovery.disconnect_at]);

  // RECOVERED is a flash state — auto-hide after 600ms.
  useEffect(() => {
    if (recovery.state !== SESSION_STATES.RECOVERED) return undefined;
    const id = setTimeout(() => recoveryDispatch({ type: 'RECOVERED_HIDE' }), 600);
    return () => clearTimeout(id);
  }, [recovery.state]);

  // Sync lockout level from server settings (already fetched into
  // gameSettings on connect). Default 'medium'.
  useEffect(() => {
    const lvl = gameSettings.billing_kiosk_lockout_level || 'medium';
    recoveryDispatch({ type: 'SET_LOCKOUT_LEVEL', level: lvl });
  }, [gameSettings.billing_kiosk_lockout_level]);

  // HARD lockout — kill active game via IPC.
  useEffect(() => {
    if (shouldKillActiveGame(recovery)) {
      ipc.sessionKillActiveGame?.().catch(() => {});
    }
  }, [recovery.state]);

  const normalizeConfig = (cfg) => {
    if (!cfg) return cfg;
    const out = { ...cfg };
    if (!out.serverUrl && out.serverIp) {
      const port = out.serverPort || '3001';
      out.serverUrl = `http://${out.serverIp}:${port}`;
    }
    return out;
  };

  useEffect(() => {
    // First-run check: if main hasn't seen an admin exit password yet,
    // freeze the launcher in a setup overlay. Lockdown stays deferred on
    // the main side until setup completes.
    (async () => {
      try {
        const need = await ipc.adminSetupRequired?.();
        if (need) { setSetupRequired(true); return; }
      } catch {}
      // Phase 4B — pull any cached session from main BEFORE opening
      // the socket, so the reducer enters the connect handler in a
      // state where canEmitResume() returns true and the kiosk emits
      // client:resume instead of bouncing to the login screen.
      try {
        const cached = await ipc.sessionGet?.();
        if (cached && cached.session_uuid && cached.user_id) {
          recoveryDispatch({ type: 'LOGIN_SUBMIT' });
          recoveryDispatch({
            type: 'SESSION_STARTED',
            session_uuid: cached.session_uuid,
            user_id: Number(cached.user_id),
            locked_rate_per_hour: cached.locked_rate_per_hour,
          });
          // Treat mount as a disconnect — socket isn't connected yet.
          recoveryDispatch({ type: 'DISCONNECTED', now_ms: Date.now() });
        }
      } catch (e) { /* ignore */ }

      ipc.getConfig().then(raw => {
        const cfg = normalizeConfig(raw);
        setConfig(cfg);
        if (!cfg.serverUrl) { setState('config'); return; }
        connectSocket(cfg);
      });
    })();
  }, []);

  // Universal admin-auth hotkey (Ctrl+Shift+X)
  useEffect(() => {
    const open = () => setShowAuthModal(true);
    const off = ipc.onAdminExitRequested?.(open);
    const onKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      try { off?.(); } catch {}
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Time-limit warning trigger
  useEffect(() => {
    if (!user || !sessionStart) { lastWarnedThreshold.current = null; return; }
    const pricePerHour = Number(gameSettings.gaming_price_per_hour || 30000);
    const pricePerMin = pricePerHour / 60;
    const minsLeft = Math.floor(credits / pricePerMin);
    const thresholds = String(warnSettings.warn_at_minutes || '10,5,1')
      .split(',')
      .map(x => parseInt(x.trim(), 10))
      .filter(x => !isNaN(x) && x > 0)
      .sort((a, b) => b - a);

    for (const t of thresholds) {
      if (minsLeft <= t && lastWarnedThreshold.current !== t && minsLeft > 0) {
        lastWarnedThreshold.current = t;
        const sound = warnSettings.warn_sound || 'beep';
        const vol = Number(warnSettings.warn_volume || 70) / 100;
        if (sound !== 'none') playWarn(sound, vol);
        toast.warn(`⏰ فقط ${t} دقیقه از وقتت مونده`);
        break;
      }
    }
  }, [credits, user, sessionStart, gameSettings, warnSettings]);

  const connectSocket = (cfg) => {
    setLoadingStatus(`در حال اتصال به ${cfg.serverUrl}…`);
    setConnectError(null);
    const sock = io(cfg.serverUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: 3,
      timeout: 5000,
    });

    sock.on('connect', () => {
      setConnectError(null);
      // B2.2 — point the crash uploader at the server we just connected
      // to. Any subsequent renderer crash POSTs to /api/admin/crash-report.
      try { ipc.setCrashServerUrl?.(cfg.serverUrl); } catch (_) {}
      sock.emit('client:register', { computerId: cfg.computerName, computerName: cfg.computerName });

      // Phase 4B — if the recovery reducer holds a session_uuid + user_id
      // from before disconnect, emit client:resume INSTEAD of forcing
      // the login screen. The reducer's canEmitResume() returns true
      // only when we have a uuid and we're in a recoverable state. On
      // the first ever connect (no prior session), this is false and
      // we fall to the regular login flow.
      const rec = recoveryRef.current;
      if (canEmitResume(rec)) {
        recoveryDispatch({ type: 'RECONNECTING' });
        sock.emit('client:resume', {
          session_uuid: rec.session_uuid,
          user_id: rec.user_id,
        });
      } else {
        setState('login');
      }

      fetch(`${cfg.serverUrl}/api/settings`).then(r => r.json()).then(s => setGameSettings(s)).catch(() => {});
      fetch(`${cfg.serverUrl}/api/shop/items`).then(r => r.json()).then(items => setShopItems(items.filter(i => i.active))).catch(() => {});
      fetch(`${cfg.serverUrl}/api/games?active=1`).then(r => r.json()).then(games => {
        setServerGames(games);
        // Push to main so the launch allowlist includes hint_paths + exe_names
        try { window.electron?.updateAllowlist?.(games); } catch {}
      }).catch(() => {});
    });

    // Phase 4B — socket-level disconnect handler. Transitions the
    // recovery reducer to GRACE_SOFT (game keeps running, overlay
    // shown). Doesn't reset the legacy `state`/`user`/`credits` — the
    // ACTIVE UI stays mounted underneath the overlay so the customer's
    // current activity is preserved.
    sock.on('disconnect', () => {
      const rec = recoveryRef.current;
      if (rec.state === SESSION_STATES.ACTIVE) {
        recoveryDispatch({ type: 'DISCONNECTED', now_ms: Date.now() });
      }
    });

    // Phase 4B — server says "your session is restored". Refresh
    // credits/debt cache and let the reducer transition RECOVERING →
    // RECOVERED → ACTIVE (the RECOVERED state auto-hides after 600ms).
    sock.on('resume:ok', (payload) => {
      const { session_id, locked_rate_per_hour, credits: c, debt: d, post_pay } = payload || {};
      recoveryDispatch({
        type: 'RESUME_OK',
        session_id, locked_rate_per_hour,
        credits: c, debt: d, post_pay,
      });
      if (typeof c === 'number') setCredits(c);
      if (typeof d === 'number') setDebt(d);
      // Make sure the underlying UI is in ACTIVE; on a renderer-reload
      // resume path the legacy state may still be 'loading'.
      if (recoveryRef.current.user_id) setState('active');
    });

    // Phase 4B — server refused to resume. Reasons:
    //   session_not_found / state_closed / wrong_computer / wrong_user /
    //   recovery_max_age_exceeded / duplicate_client / invalid_payload.
    // The reducer clears the session cache and counts strikes; after
    // STRIKE_LIMIT rejections in STRIKE_WINDOW_MS it transitions to
    // LOCKED so the operator gets called.
    sock.on('resume:rejected', (payload) => {
      const reason = (payload && payload.reason) || 'unknown';
      recoveryDispatch({ type: 'RESUME_REJECTED', reason, now_ms: Date.now() });
      ipc.sessionClear?.().catch(() => {});
      setUser(null); setCredits(0); setDebt(0); setSessionStart(null);
      if (recoveryRef.current.state === SESSION_STATES.LOCKED) {
        setState('locked');
      } else {
        setState('login');
      }
      const map = {
        session_not_found: 'نشست پیدا نشد — لطفاً دوباره وارد شوید',
        state_closed: 'نشست بسته شده — ورود مجدد لازم است',
        wrong_computer: 'این صندلی متعلق به سیستم دیگری است',
        wrong_user: 'شناسه کاربر مطابقت ندارد',
        recovery_max_age_exceeded: 'مدت بازیابی به پایان رسیده — ورود مجدد',
        duplicate_client: 'این نشست توسط سیستم دیگری در حال استفاده است',
      };
      toast.danger(map[reason] || `بازیابی نشست ناموفق (${reason})`, 6000);
    });

    // Phase 4B — server confirms session started after client:login.
    // Push uuid into both the reducer and the main-process cache so
    // a renderer reload can recover it.
    sock.on('session:started', (payload) => {
      const { session_uuid, locked_rate_per_hour } = payload || {};
      if (!session_uuid) return;
      const rec = recoveryRef.current;
      const u = userRef.current;
      const userId = rec.user_id || (u && u.id) || null;
      recoveryDispatch({
        type: 'SESSION_STARTED',
        session_uuid,
        user_id: userId,
        locked_rate_per_hour,
      });
      ipc.sessionSet?.({
        session_uuid,
        user_id: userId,
        computer_name: cfg.computerName,
        locked_rate_per_hour,
      }).catch(() => {});
    });

    let failedAttempts = 0;
    sock.on('connect_error', (e) => {
      failedAttempts += 1;
      if (failedAttempts >= 3) {
        setConnectError(
          `اتصال به ${cfg.serverUrl} ناموفق — IP/پورت رو چک کن یا مطمئن شو سرور بالا و فایروال ویندوز اجازه می‌ده (${e?.message || 'no response'})`
        );
        setState('config');
      } else {
        setLoadingStatus(`تلاش ${failedAttempts.toLocaleString('en-US')}/3 — ${cfg.serverUrl}`);
      }
    });

    sock.on('credits:update', ({ credits: c, debt: d }) => {
      setCredits(c);
      if (d !== undefined) setDebt(d);
    });

    sock.on('credits:low', ({ credits: c }) => {
      const pricePerHour = Number(gameSettings.gaming_price_per_hour || 30000);
      const minsLeft = Math.floor(c / (pricePerHour / 60));
      toast.warn(`اعتبار کم: ${minsLeft} دقیقه باقی‌مانده`, 6000);
    });

    sock.on('session:end', ({ reason, limit }) => {
      if (reason === 'no_credits') toast.danger('اعتبارت تموم شد', 6000);
      else if (reason === 'admin_kick') toast.danger('نشست توسط ادمین پایان یافت', 6000);
      else if (reason === 'account_disabled') toast.danger('حسابت غیرفعال شد', 6000);
      else if (reason === 'limit_reached') toast.danger(`لیمیت وقت (${limit||0} دقیقه) به اتمام رسید`, 6000);
      else if (reason === 'session_gone') toast.danger('نشست توسط سیستم دیگری گرفته شد', 6000);
      // Phase 4B — drive the reducer to LOCKED + clear the cached uuid.
      recoveryDispatch({ type: reason === 'admin_kick' ? 'ADMIN_KICK' : 'SESSION_END', reason });
      ipc.sessionClear?.().catch(() => {});
      // logout signal to server is redundant (server already ended the
      // session), but harmless if the socket is still alive.
      try { sock.emit('client:logout'); } catch {}
      setUser(null); setCredits(0); setDebt(0); setSessionStart(null);
      setState('locked');
      ipc.lockScreen();
    });

    /* Admin message — render as a centered modal that stays until the user
     * dismisses it. The previous toast was easy to miss while playing. */
    const showAdminBanner = (kind, html) => {
      try {
        const old = document.getElementById('mg-admin-banner');
        if (old) old.remove();
        const overlay = document.createElement('div');
        overlay.id = 'mg-admin-banner';
        const palette = {
          info:    { bg: 'rgba(124,58,237,.95)', accent: '#a78bfa' },
          success: { bg: 'rgba(16,185,129,.95)',  accent: '#34d399' },
          danger:  { bg: 'rgba(239,68,68,.95)',  accent: '#f87171' },
        }[kind] || { bg: 'rgba(124,58,237,.95)', accent: '#a78bfa' };
        Object.assign(overlay.style, {
          position: 'fixed', inset: '0', zIndex: '999998',
          background: 'rgba(5,6,15,.55)', backdropFilter: 'blur(6px)',
          display: 'grid', placeItems: 'center', direction: 'rtl',
        });
        overlay.innerHTML = `
          <div style="
            min-width:360px; max-width:560px; padding:28px 32px;
            background:${palette.bg}; color:#fff;
            border-radius:18px; border:1px solid ${palette.accent}55;
            box-shadow:0 30px 80px rgba(0,0,0,.5), 0 0 0 4px ${palette.accent}25;
            font-family:'Vazirmatn',Tahoma,sans-serif; text-align:center;
          ">
            ${html}
            <button id="mg-admin-banner-close" style="
              margin-top:18px; padding:12px 28px; font-size:14px; font-weight:700;
              background:rgba(0,0,0,.25); color:#fff; border:1px solid rgba(255,255,255,.3);
              border-radius:999px; cursor:pointer;
            ">باشه، فهمیدم</button>
          </div>
        `;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('#mg-admin-banner-close').addEventListener('click', close);
      } catch {}
    };

    sock.on('admin:message', ({ text }) => {
      showAdminBanner('info', `
        <div style="font-size:42px; margin-bottom:10px;">📢</div>
        <div style="font-size:13px; opacity:.85; margin-bottom:6px;">پیام از مدیر گیم‌نت</div>
        <div style="font-size:18px; font-weight:700; line-height:1.7;">${(text||'').replace(/</g,'&lt;')}</div>
      `);
      // Phase 4B — also surface the message inside the recovery
      // overlay if the kiosk is currently in a GRACE_* / RECOVERING
      // state (banner would be hidden under the overlay).
      recoveryDispatch({ type: 'ADMIN_MESSAGE', text: text || '' });
      try { new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAAAAA').play().catch(()=>{}); } catch {}
    });

    sock.on('order:approved', ({ orderId }) => {
      toast.success('✅ سفارش تایید شد! به‌زودی تحویل می‌گیری 🚀', 8000);
      showAdminBanner('success', `
        <div style="font-size:48px; margin-bottom:10px;">✅</div>
        <div style="font-size:18px; font-weight:800; margin-bottom:4px;">سفارش شما تایید شد</div>
        <div style="font-size:13px; opacity:.85;">شماره سفارش: #${orderId} — به‌زودی تحویل می‌گیری</div>
      `);
    });
    sock.on('order:cancelled', ({ orderId }) => {
      toast.danger('❌ سفارش لغو شد. با ادمین تماس بگیر.', 8000);
      showAdminBanner('danger', `
        <div style="font-size:48px; margin-bottom:10px;">❌</div>
        <div style="font-size:18px; font-weight:800; margin-bottom:4px;">سفارش شما لغو شد</div>
        <div style="font-size:13px; opacity:.85;">شماره سفارش: #${orderId} — برای جزئیات با ادمین صحبت کن</div>
      `);
    });

    /* ─── New events from server ─── */
    sock.on('games:update', (games) => {
      setServerGames(Array.isArray(games) ? games : []);
      try { window.electron?.updateAllowlist?.(games); } catch {}
    });

    sock.on('warn:settings', (w) => setWarnSettings(prev => ({ ...prev, ...w })));

    /* Live shop catalog updates — when admin changes price/stock/active or
     * adds/removes items, every client refreshes immediately. */
    sock.on('shop:update', (items) => {
      if (Array.isArray(items)) setShopItems(items.filter(i => i.active));
    });

    /* Live game settings updates (e.g. currency_unit toman/rial). */
    sock.on('settings:update', (s) => {
      if (s) setGameSettings(prev => ({ ...prev, ...s }));
    });

    sock.on('client:assignment', async (assignment) => {
      try {
        const res = await ipc.applyClientAssignment(assignment);
        if (assignment?.dns) toast.info(`🛡 DNS تنظیم شد: ${assignment.dns.name}`);
        if (assignment?.modem) toast.info(`📡 مودم: ${assignment.modem.name}`);
        if (res && res.dns && String(res.dns).startsWith('ERR')) {
          toast.warn('اعمال DNS نیاز به Administrator داره', 6000);
        }
      } catch {}
    });

    // Admin force-login (right-click → assign user)
    sock.on('admin:force-login', ({ user: u }) => {
      if (!u) return;
      handleLoginRef.current?.(u);
    });

    // Admin power actions
    sock.on('admin:power', ({ action }) => {
      if (action === 'lock')      ipc.lockScreen?.();
      else if (action === 'restart')  ipc.restartSystem?.();
      else if (action === 'shutdown') ipc.shutdownSystem?.();
    });

    /* ─── Incoming voice chunks from admin (push-to-talk) ───
     * Each chunk is a base64 webm/opus blob. We buffer the chunks within
     * a "talk session" and play each as it arrives via an Audio() element.
     * The user's mute toggle sets `voiceLocalMuted` which skips playback.
     */
    let voiceBanner = null;
    let activeAudio = null;
    sock.on('voice:incoming-start', () => {
      // Show a small floating banner while admin is talking
      try {
        if (voiceBanner) voiceBanner.remove();
        voiceBanner = document.createElement('div');
        voiceBanner.id = 'mg-voice-banner';
        voiceBanner.innerHTML = '🎙 ادمین در حال صحبت…';
        Object.assign(voiceBanner.style, {
          position: 'fixed', top: '14px', left: '50%', transform: 'translateX(-50%)',
          padding: '8px 18px', background: 'rgba(124,58,237,.92)',
          color: '#fff', borderRadius: '999px', fontSize: '13px', fontWeight: '700',
          zIndex: '999999', boxShadow: '0 12px 30px rgba(124,58,237,.45)',
          backdropFilter: 'blur(8px)', direction: 'rtl',
        });
        document.body.appendChild(voiceBanner);
      } catch {}
    });
    sock.on('voice:incoming-chunk', ({ audio, mime }) => {
      if (window.__voiceLocalMuted) return;
      try {
        // Decode base64 → Blob → playable URL
        const bin = atob(audio);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: mime || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        const a = new Audio(url);
        a.volume = 1.0;
        a.play().catch(() => {});
        a.addEventListener('ended', () => URL.revokeObjectURL(url));
        activeAudio = a;
      } catch {}
    });
    sock.on('voice:incoming-stop', () => {
      try { voiceBanner?.remove(); voiceBanner = null; } catch {}
    });
    sock.on('voice:mute-toggle', ({ muted }) => {
      window.__voiceLocalMuted = !!muted;
      if (muted) try { voiceBanner?.remove(); voiceBanner = null; } catch {}
    });

    setSocket(sock);
  };

  const handleLogin = useCallback((userData) => {
    setUser(userData);
    setCredits(userData.credits);
    setDebt(userData.debt || 0);
    setSessionStart(Date.now());
    setState('active');
    ipc.unlockScreen();

    // Phase 4B — seed reducer with user_id BEFORE session:started
    // arrives so SESSION_STARTED has the user context. The reducer
    // transitions IDLE → STARTING here; session:started flips it to
    // ACTIVE with the uuid attached.
    recoveryDispatch({ type: 'LOGIN_SUBMIT' });
    // We pre-populate user_id via a synthetic SESSION_STARTED-less
    // shim: store user_id on the reducer via the SESSION_STARTED path
    // when it arrives. To make user_id available for canEmitResume
    // even if SESSION_STARTED is delayed, we extend RECONNECTING to
    // pull from recoveryRef; we already do that. No extra action here.

    if (socket) {
      socket.emit('client:login', {
        userId: userData.id,
        username: userData.username,
        credits: userData.credits,
      });
    }
    const pricePerHour = Number(gameSettings.gaming_price_per_hour || 30000);
    const minsLeft = Math.floor(userData.credits / (pricePerHour / 60));
    toast.success(`خوش اومدی ${userData.username}! ≈ ${minsLeft} دقیقه اعتبار داری`);
  }, [socket, gameSettings]);

  // Keep a stable ref so socket listeners can call latest handleLogin
  useEffect(() => { handleLoginRef.current = handleLogin; }, [handleLogin]);
  // Phase 4B — keep userRef fresh for socket-event closures.
  useEffect(() => { userRef.current = user; }, [user]);

  const handleLogout = useCallback(() => {
    if (!user) return;
    socket?.emit('client:logout');
    setUser(null); setCredits(0); setDebt(0); setSessionStart(null);
    setState('locked');
    ipc.lockScreen();
    // Phase 4B — clear cached session + drive reducer to IDLE.
    recoveryDispatch({ type: 'LOGOUT' });
    ipc.sessionClear?.().catch(() => {});
  }, [user, socket]);

  const saveConfig = async (newCfg) => {
    await ipc.saveConfig(newCfg);
    setConfig(newCfg);
    setState('loading');
    connectSocket(newCfg);
  };

  const saveAdminConfig = async (newCfg) => {
    await ipc.saveConfig(newCfg);
    setConfig(newCfg);
  };

  const retryConnection = () => {
    if (config?.serverUrl) {
      setState('loading');
      connectSocket(config);
    }
  };

  const closeAdminPanel = () => {
    setShowAdminPanel(false);
    if (config?.serverUrl) {
      setState('loading');
      connectSocket(config);
    }
  };

  const fullExit = async () => {
    // AdminPanel was reached via verify-admin-password — main keeps a 5-min
    // "recently verified" flag, so we don't need to round-trip the plaintext
    // password just to shut down. If the flag has expired, the user gets a
    // toast and re-enters via Ctrl+Shift+X.
    const r = await ipc.adminShutdown?.();
    if (r && r.ok === false && r.error) toast.danger(r.error);
  };

  return (
    <>
      {setupRequired && (
        <AdminSetupOverlay
          onDone={async () => {
            setSetupRequired(false);
            // Continue the normal cold-start path now that lockdown is armed.
            const raw = await ipc.getConfig();
            const cfg = normalizeConfig(raw);
            setConfig(cfg);
            if (!cfg.serverUrl) setState('config');
            else connectSocket(cfg);
          }}
        />
      )}
      {!setupRequired && state === 'loading' && <Loading status={loadingStatus} />}
      {!setupRequired && state === 'config' && <Config config={config} onSave={saveConfig} connectError={connectError} onRetry={retryConnection} />}
      {!setupRequired && state === 'login' && <Login serverUrl={config?.serverUrl} onLogin={handleLogin} />}
      {!setupRequired && state === 'active' && (
        <Desktop
          user={user}
          credits={credits}
          debt={debt}
          sessionStart={sessionStart}
          shopItems={shopItems}
          serverUrl={config?.serverUrl}
          gameSettings={gameSettings}
          config={config}
          serverGames={serverGames}
          onLogout={handleLogout}
        />
      )}
      {!setupRequired && state === 'locked' && (
        <Locked onUnlock={() => {
          // Phase 4B — unlocking also resets the recovery reducer.
          recoveryDispatch({ type: 'LOCK_UNLOCKED' });
          setState('login');
        }} />
      )}

      {/* Phase 4B — recovery overlay. Renders ABOVE the active session
          UI during GRACE / RECOVERING / RECOVERED states so the
          customer sees the connection status without losing their
          session context. */}
      {!setupRequired && isOverlayVisible(recovery) && (
        <ReconnectOverlay
          state={recovery.state}
          gracElapsedS={recovery.grace_elapsed_s}
          adminMessage={recovery.admin_message}
          lockoutLevel={recovery.lockout_level}
          onClearAdminMessage={() => recoveryDispatch({ type: 'CLEAR_ADMIN_MESSAGE' })}
        />
      )}

      <ToastStack />

      {showAuthModal && (
        <AdminAuthModal
          onClose={() => setShowAuthModal(false)}
          onAuthorized={() => { setShowAuthModal(false); setShowAdminPanel(true); }}
        />
      )}

      {showAdminPanel && (
        <AdminPanel
          config={config}
          onSave={saveAdminConfig}
          onExitFully={fullExit}
          onCloseAndReload={closeAdminPanel}
        />
      )}
    </>
  );
}

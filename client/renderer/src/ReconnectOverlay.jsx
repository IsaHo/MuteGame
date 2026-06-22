import { useEffect, useState } from 'react';
import { SESSION_STATES } from './sessionStateMachine';

/*
 * Reconnect overlay shown when the client-side state machine is in any
 * of GRACE_SOFT / GRACE_MEDIUM / GRACE_HARD / RECOVERING / RECOVERED.
 *
 * Persian RTL UI:
 *   - GRACE_SOFT   — "اتصال قطع شد، در حال تلاش مجدد…" (game keeps running)
 *   - GRACE_MEDIUM — same overlay + "بازی جدید موقتاً غیرفعال است"
 *   - GRACE_HARD   — same overlay + "نشست در آستانه پایان" + warning
 *   - RECOVERING   — "در حال بازیابی نشست…"
 *   - RECOVERED    — "نشست بازیابی شد ✓" (auto-hides via RECOVERED_HIDE)
 *
 * The overlay is non-modal in SOFT (allows the customer to continue
 * gaming) and progressively heavier in MEDIUM/HARD. Admin messages
 * appear inside the overlay's body slot.
 */
export default function ReconnectOverlay({
  state, gracElapsedS, adminMessage, lockoutLevel,
  onClearAdminMessage,
}) {
  // Live counter ticks every second while we're in any GRACE_* state.
  // Used purely for display; the actual lockout-level escalation runs
  // off the dispatcher's setInterval.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (state !== SESSION_STATES.GRACE_SOFT
        && state !== SESSION_STATES.GRACE_MEDIUM
        && state !== SESSION_STATES.GRACE_HARD
        && state !== SESSION_STATES.RECOVERING) {
      return undefined;
    }
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // Styling tier per state — softer GRACE shows a less-intrusive banner
  // at the top; HARD takes the full screen.
  const intrusive =
    state === SESSION_STATES.GRACE_MEDIUM
    || state === SESSION_STATES.GRACE_HARD
    || state === SESSION_STATES.RECOVERING;

  const isFull =
    state === SESSION_STATES.GRACE_HARD
    || state === SESSION_STATES.RECOVERING
    || state === SESSION_STATES.RECOVERED;

  const heading = (() => {
    switch (state) {
      case SESSION_STATES.GRACE_SOFT:   return 'اتصال قطع شد';
      case SESSION_STATES.GRACE_MEDIUM: return 'هنوز در حال تلاش برای اتصال';
      case SESSION_STATES.GRACE_HARD:   return '⚠ آستانه پایان نشست';
      case SESSION_STATES.RECOVERING:   return 'در حال بازیابی نشست…';
      case SESSION_STATES.RECOVERED:    return '✓ نشست بازیابی شد';
      default: return '';
    }
  })();

  const sub = (() => {
    switch (state) {
      case SESSION_STATES.GRACE_SOFT:
        return 'در حال تلاش مجدد به سرور — بازی شما همچنان فعال است.';
      case SESSION_STATES.GRACE_MEDIUM:
        return 'بازی جدید موقتاً غیرفعال است. نشست فعلی تا اتصال مجدد ادامه دارد.';
      case SESSION_STATES.GRACE_HARD:
        return 'اگر اتصال برقرار نشود، بازی فعال بسته می‌شود و نشست پایان می‌یابد.';
      case SESSION_STATES.RECOVERING:
        return 'لطفاً صبر کنید — در حال تأیید با سرور.';
      case SESSION_STATES.RECOVERED:
        return 'اتصال برقرار شد. می‌توانید ادامه دهید.';
      default: return '';
    }
  })();

  // Disconnect countdown — how long has the user been disconnected.
  const elapsed = (gracElapsedS || 0) + tick;
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  const elapsedLabel = (min > 0 ? `${min}دق ` : '') + `${sec}ثانیه`;

  const containerStyle = isFull
    ? overlayFull
    : (intrusive ? overlayHeavy : overlaySoft);

  return (
    <div dir="rtl" style={containerStyle} role="status" aria-live="polite">
      <div style={card}>
        <div style={spinnerBox}>
          {state === SESSION_STATES.RECOVERED ? null : <Spinner state={state} />}
        </div>
        <h2 style={titleStyle(state)}>{heading}</h2>
        <p style={subStyle}>{sub}</p>
        {(state === SESSION_STATES.GRACE_SOFT
          || state === SESSION_STATES.GRACE_MEDIUM
          || state === SESSION_STATES.GRACE_HARD) && (
          <div style={countdownRow}>
            <span style={countdownLabel}>زمان قطعی:</span>
            <span style={countdownValue}>{elapsedLabel}</span>
          </div>
        )}
        {lockoutLevel && (
          <div style={lockoutPill}>
            <span style={lockoutLabel}>سطح قفل:</span>
            <span style={lockoutLevelStyle(lockoutLevel)}>{
              lockoutLevel === 'soft' ? 'نرم' :
              lockoutLevel === 'medium' ? 'متوسط' :
              lockoutLevel === 'hard' ? 'سخت' : lockoutLevel
            }</span>
          </div>
        )}
        {adminMessage && (
          <div style={adminMsgBox}>
            <div style={adminMsgHeader}>پیام ادمین</div>
            <div style={adminMsgBody}>{adminMessage}</div>
            <button onClick={onClearAdminMessage} style={adminMsgDismiss}>بستن</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Spinner({ state }) {
  // Animated dots — no external assets.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhase(p => (p + 1) % 4), 350);
    return () => clearInterval(id);
  }, []);
  const filled = '●';
  const empty = '○';
  const dots = Array.from({ length: 4 }, (_, i) => (i === phase ? filled : empty)).join(' ');
  const color = state === SESSION_STATES.GRACE_HARD ? '#ff4444' : '#3aa0ff';
  return <div style={{ fontSize: 32, letterSpacing: 6, color }}>{dots}</div>;
}

// ── inline styles (kept inline to avoid touching styles.css) ────────
const overlaySoft = {
  position: 'fixed', top: 16, right: 16, zIndex: 9000,
  background: 'rgba(15, 22, 36, 0.92)', color: '#e6edf3',
  padding: '14px 18px', borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
  fontFamily: 'IRANSansX, Tahoma, sans-serif', minWidth: 280,
};
const overlayHeavy = {
  position: 'fixed', inset: 0, zIndex: 9500,
  background: 'rgba(8, 14, 26, 0.85)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'IRANSansX, Tahoma, sans-serif',
};
const overlayFull = {
  position: 'fixed', inset: 0, zIndex: 10000,
  background: 'rgba(4, 8, 18, 0.96)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'IRANSansX, Tahoma, sans-serif',
};
const card = {
  background: 'linear-gradient(180deg, rgba(28,40,60,0.95), rgba(18,26,40,0.95))',
  borderRadius: 18, padding: '28px 32px', minWidth: 360, maxWidth: 480,
  color: '#e6edf3', textAlign: 'center',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
};
const spinnerBox = { height: 48, marginBottom: 8 };
function titleStyle(state) {
  const color = state === SESSION_STATES.GRACE_HARD ? '#ff6b6b'
    : state === SESSION_STATES.RECOVERED ? '#4ade80'
    : '#e6edf3';
  return { margin: '4px 0 8px', fontSize: 22, fontWeight: 700, color };
}
const subStyle = { margin: '6px 0 14px', fontSize: 14, opacity: 0.85, lineHeight: 1.6 };
const countdownRow = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: 8, padding: '8px 14px', borderRadius: 10,
  background: 'rgba(255,255,255,0.04)', marginTop: 6,
};
const countdownLabel = { opacity: 0.6, fontSize: 13 };
const countdownValue = { fontWeight: 700, fontSize: 16, letterSpacing: 0.5 };
const lockoutPill = {
  marginTop: 10, fontSize: 12, opacity: 0.7,
  display: 'flex', justifyContent: 'center', gap: 6,
};
const lockoutLabel = {};
function lockoutLevelStyle(lvl) {
  const map = { soft: '#4ade80', medium: '#fbbf24', hard: '#ff6b6b' };
  return { fontWeight: 700, color: map[lvl] || '#e6edf3' };
}
const adminMsgBox = {
  marginTop: 16, padding: '12px 14px', borderRadius: 10,
  background: 'rgba(56, 138, 255, 0.12)',
  border: '1px solid rgba(56, 138, 255, 0.35)',
  textAlign: 'right',
};
const adminMsgHeader = { fontSize: 12, opacity: 0.7, marginBottom: 4 };
const adminMsgBody = { fontSize: 14, lineHeight: 1.6 };
const adminMsgDismiss = {
  marginTop: 8, padding: '6px 12px', borderRadius: 8, border: 'none',
  background: 'rgba(56,138,255,0.25)', color: '#e6edf3', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 12,
};

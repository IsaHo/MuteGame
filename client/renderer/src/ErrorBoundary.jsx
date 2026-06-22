import { Component } from 'react';

/*
 * B2.2 — Renderer ErrorBoundary.
 *
 * Catches any error thrown during React render / commit phase, reports
 * to main process via IPC, and renders a Persian RTL fatal-error
 * screen so the kiosk doesn't show a blank window. The fatal screen
 * offers a Reload + Operator-call hint; the operator gets details
 * from the crash_log table on the server.
 *
 * Does NOT auto-reload — repeated render loops would just generate
 * more crash rows. Operator decides when to reload via Ctrl+R or
 * full app restart.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: null, componentStack: null };
    this._reported = false;
  }

  static getDerivedStateFromError(err) {
    return {
      hasError: true,
      message: (err && err.message) || String(err),
    };
  }

  componentDidCatch(err, info) {
    // Report once per mount. React may call componentDidCatch multiple
    // times for the same error in concurrent mode — guard with a flag.
    if (this._reported) return;
    this._reported = true;
    this.setState({ componentStack: info && info.componentStack });
    try {
      const ipc = (typeof window !== 'undefined') ? window.electron : null;
      if (ipc && typeof ipc.reportRendererCrash === 'function') {
        ipc.reportRendererCrash({
          message: (err && err.message) || String(err),
          stack: (err && err.stack) || '',
          details: {
            kind: 'react_error_boundary',
            componentStack: info && info.componentStack,
            href: typeof window !== 'undefined' ? window.location.href : null,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          },
        });
      }
    } catch (e) { /* never throw out of an error boundary */ }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div dir="rtl" style={overlay}>
        <div style={card}>
          <div style={icon}>⚠</div>
          <h2 style={heading}>خطای داخلی برنامه</h2>
          <p style={lead}>
            یک خطای غیرمنتظره رخ داد. لطفاً با اپراتور تماس بگیرید.
          </p>
          <div style={detailsBox}>
            <div style={detailsLabel}>پیام:</div>
            <div style={detailsValue}>{this.state.message}</div>
          </div>
          <p style={hint}>
            اپراتور: گزارش این خطا در پنل ادمین → سیستم → خطاها قابل
            مشاهده است.
          </p>
          <button style={reloadBtn} onClick={() => {
            try {
              if (typeof window !== 'undefined' && window.location) window.location.reload();
            } catch (_) {}
          }}>تلاش مجدد</button>
        </div>
      </div>
    );
  }
}

const overlay = {
  position: 'fixed', inset: 0, zIndex: 99999,
  background: 'rgba(4, 8, 18, 0.98)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'IRANSansX, Tahoma, sans-serif',
  color: '#e6edf3',
};
const card = {
  background: 'linear-gradient(180deg, rgba(40,20,20,0.95), rgba(20,12,12,0.95))',
  borderRadius: 18, padding: '32px 40px', minWidth: 420, maxWidth: 580,
  textAlign: 'center', border: '1px solid rgba(255, 90, 90, 0.3)',
  boxShadow: '0 30px 80px rgba(0, 0, 0, 0.6)',
};
const icon = { fontSize: 64, color: '#ff6b6b', marginBottom: 12 };
const heading = { margin: '0 0 12px', fontSize: 26, fontWeight: 800, color: '#ff8a8a' };
const lead = { margin: '0 0 18px', fontSize: 15, opacity: 0.9, lineHeight: 1.7 };
const detailsBox = {
  margin: '12px 0', padding: '12px 14px', borderRadius: 10,
  background: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(255,255,255,0.06)',
  textAlign: 'right',
};
const detailsLabel = { fontSize: 12, opacity: 0.6, marginBottom: 4 };
const detailsValue = {
  fontSize: 13, fontFamily: 'Consolas, monospace', wordBreak: 'break-word',
  lineHeight: 1.5, maxHeight: 200, overflow: 'auto',
};
const hint = { margin: '16px 0 8px', fontSize: 12, opacity: 0.55, lineHeight: 1.7 };
const reloadBtn = {
  marginTop: 14, padding: '10px 24px', borderRadius: 10, border: 'none',
  background: 'rgba(255, 107, 107, 0.25)', color: '#e6edf3',
  fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

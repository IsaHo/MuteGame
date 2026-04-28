import { useEffect, useState } from 'react';
import { formatRial } from '../api';

export default function Settings({ addToast }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    try {
      const res = await fetch('/api/settings');
      setSettings(await res.json());
    } catch { }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setLoading(true);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      addToast('تنظیمات ذخیره شد ✅', 'success');
    } catch (e) { addToast('خطا در ذخیره', 'error'); }
    setLoading(false);
  };

  const set = (key, val) => setSettings(p => ({ ...p, [key]: val }));

  const pricePerMin = Number(settings?.gaming_price_per_minute || 0);
  const pricePerHour = pricePerMin * 60;
  const peakPrice = pricePerHour * Number(settings?.gaming_peak_multiplier || 1);

  if (!settings) return (
    <div style={{ height: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--text3)' }}>در حال بارگذاری...</div>
    </div>
  );

  return (
    <div>
      <div className="topbar">
        <span className="topbar-title">⚙️ تنظیمات سیستم</span>
        <div className="topbar-right">
          {saved && <span className="badge badge-green">✅ ذخیره شد</span>}
          <button className="btn btn-primary" onClick={save} disabled={loading}>
            {loading ? '⏳...' : '💾 ذخیره همه تنظیمات'}
          </button>
        </div>
      </div>

      <div className="page-body" style={{ paddingTop: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Gaming Pricing */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 28 }}>🎮</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>قیمت‌گذاری ساعت بازی</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>هزینه بازی به ازای هر دقیقه</div>
              </div>
            </div>

            <div className="form-group">
              <label className="label">قیمت هر دقیقه (ریال)</label>
              <input
                type="number"
                className="input"
                value={settings.gaming_price_per_minute}
                onChange={e => set('gaming_price_per_minute', e.target.value)}
                min={0}
              />
            </div>

            {/* Preview */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
              {[
                { label: '۳۰ دقیقه', mins: 30 },
                { label: '۱ ساعت', mins: 60 },
                { label: '۲ ساعت', mins: 120 },
              ].map(t => (
                <div key={t.label} style={{ background: 'var(--bg2)', borderRadius: 10, padding: '10px', textAlign: 'center', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>{t.label}</div>
                  <div style={{ fontWeight: 800, color: 'var(--purple3)', fontSize: 13 }}>{(pricePerMin * t.mins).toLocaleString('fa-IR')} ریال</div>
                </div>
              ))}
            </div>

            <div className="divider" />

            <div className="form-group">
              <label className="label">ضریب ساعت شلوغ (peak hours)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  className="input"
                  value={settings.gaming_peak_multiplier}
                  onChange={e => set('gaming_peak_multiplier', e.target.value)}
                  min={1} max={3} step={0.1}
                  style={{ flex: 1 }}
                />
                <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--yellow)', whiteSpace: 'nowrap' }}>
                  ×{settings.gaming_peak_multiplier}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              <div className="form-group">
                <label className="label">شروع ساعت شلوغ</label>
                <input type="number" className="input" value={settings.gaming_peak_start} onChange={e => set('gaming_peak_start', e.target.value)} min={0} max={23} />
              </div>
              <div className="form-group">
                <label className="label">پایان ساعت شلوغ</label>
                <input type="number" className="input" value={settings.gaming_peak_end} onChange={e => set('gaming_peak_end', e.target.value)} min={0} max={24} />
              </div>
            </div>

            {/* Peak preview */}
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 12, color: 'var(--yellow)', marginBottom: 6 }}>⚡ ساعت شلوغ ({settings.gaming_peak_start}:00 تا {settings.gaming_peak_end}:00)</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--text3)' }}>قیمت ۱ ساعت در ساعت شلوغ:</span>
                <span style={{ fontWeight: 800, color: 'var(--yellow)' }}>{peakPrice.toLocaleString('fa-IR')} ریال</span>
              </div>
            </div>
          </div>

          {/* Cafe Info */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <span style={{ fontSize: 28 }}>🏪</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>اطلاعات گیم‌نت</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>در گزارشات نمایش داده می‌شه</div>
              </div>
            </div>

            <div className="form-group">
              <label className="label">نام گیم‌نت</label>
              <input className="input" value={settings.cafe_name} onChange={e => set('cafe_name', e.target.value)} placeholder="MuteGame" />
            </div>
            <div className="form-group">
              <label className="label">آدرس</label>
              <input className="input" value={settings.cafe_address} onChange={e => set('cafe_address', e.target.value)} placeholder="آدرس گیم‌نت..." />
            </div>
            <div className="form-group">
              <label className="label">شماره تلفن</label>
              <input className="input" value={settings.cafe_phone} onChange={e => set('cafe_phone', e.target.value)} placeholder="021xxxxxxxx" dir="ltr" />
            </div>

            <div className="divider" />

            {/* Summary card */}
            <div style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.1), rgba(6,182,212,0.05))', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 10 }}>خلاصه تعرفه</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { label: 'عادی - ۱ ساعت', val: pricePerHour, color: 'var(--green)' },
                  { label: 'عادی - ۲ ساعت', val: pricePerHour * 2, color: 'var(--green)' },
                  { label: 'شلوغ - ۱ ساعت', val: peakPrice, color: 'var(--yellow)' },
                  { label: 'شلوغ - ۲ ساعت', val: peakPrice * 2, color: 'var(--yellow)' },
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text3)' }}>{r.label}</span>
                    <span style={{ fontWeight: 700, color: r.color }}>{r.val.toLocaleString('fa-IR')} ریال</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

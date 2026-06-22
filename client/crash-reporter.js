/*
 * B2.2 — Client crash reporter.
 *
 * Runs in the Electron main process. Three capture paths:
 *
 *   1. Native crashes (V8, GPU, child processes) — Electron's built-in
 *      crashReporter.start() writes minidumps to
 *      <userData>/Crashpad/pending/. Operator can collect manually.
 *
 *   2. Main-process JS errors — process.on('uncaughtException') +
 *      process.on('unhandledRejection'). Each writes a local JSON dump
 *      AND best-effort POSTs to <server>/api/admin/crash-report.
 *
 *   3. Renderer JS errors — caught by React ErrorBoundary, sent to
 *      main via IPC `crash:report`, then handled identically to (2).
 *
 * Local dumps live in <userData>/MuteGame/crashes/*.json. Rotation
 * keeps the N newest (default 50). On normal start, no flush is
 * attempted — server-side upload is best-effort only. Operator can
 * inspect the dir manually.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const VALID_SOURCES = new Set(['client_main', 'client_renderer', 'client_native']);
let _crashDir = null;
let _serverUrl = null;
let _computerName = null;
let _appVersion = null;
let _retention = 50;

function init(opts) {
  _crashDir = opts.crashDir || path.join(opts.userDataPath || '.', 'crashes');
  _serverUrl = opts.serverUrl || null;
  _computerName = opts.computerName || os.hostname();
  _appVersion = opts.appVersion || null;
  _retention = Math.max(1, Number(opts.retention) || 50);
  try { fs.mkdirSync(_crashDir, { recursive: true }); }
  catch (e) { console.error('[crash-reporter] mkdir failed:', e.message); }
}

function setServerUrl(url) { _serverUrl = url || null; }

function isoStamp(d) { return d.toISOString().replace(/[:.]/g, '-'); }

function write(payload) {
  if (!_crashDir) return { ok: false, reason: 'not_initialized' };
  const source = VALID_SOURCES.has(payload.source) ? payload.source : 'client_main';
  const now = new Date();
  const blob = {
    ts: now.toISOString(),
    source,
    computer_name: _computerName,
    version: _appVersion,
    message: String((payload.message != null ? payload.message : '')).slice(0, 4000),
    stack: String((payload.stack != null ? payload.stack : '')).slice(0, 64_000),
    details: payload.details || null,
  };
  const fname = isoStamp(now) + '-' + source + '.json';
  const fpath = path.join(_crashDir, fname);
  try {
    fs.writeFileSync(fpath, JSON.stringify(blob, null, 2));
  } catch (e) {
    console.error('[crash-reporter] disk write failed:', e.message);
    return { ok: false, reason: 'disk_write_failed' };
  }
  rotate();
  return { ok: true, path: fpath, blob };
}

function rotate() {
  if (!_crashDir || !fs.existsSync(_crashDir)) return;
  try {
    const files = fs.readdirSync(_crashDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const p = path.join(_crashDir, f);
        return { path: p, mtime: fs.statSync(p).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const f of files.slice(_retention)) {
      try { fs.unlinkSync(f.path); } catch (_) {}
    }
  } catch (e) { console.error('[crash-reporter] rotate failed:', e.message); }
}

/*
 * upload — best-effort POST to server. Times out at 4s so a slow or
 * down server does not delay process exit. Returns a promise; callers
 * decide whether to await (handler may exit before resolution).
 */
function upload(blob) {
  if (!_serverUrl) return Promise.resolve({ ok: false, reason: 'no_server_url' });
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch(_serverUrl + '/api/admin/crash-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(blob),
      signal: controller.signal,
    }).then((r) => { clearTimeout(timer); resolve({ ok: r.ok, status: r.status }); })
      .catch((e) => { clearTimeout(timer); resolve({ ok: false, reason: e.name || 'fetch_error', message: e.message }); });
  });
}

function record(payload) {
  const w = write(payload);
  if (!w.ok || !w.blob) return Promise.resolve({ ...w, uploaded: false });
  return upload(w.blob).then(u => ({ ...w, uploaded: u.ok, upload: u }));
}

function installMainProcessHandlers(opts) {
  const exitOnCrash = opts && typeof opts.exitOnCrash === 'boolean' ? opts.exitOnCrash : false;

  process.on('uncaughtException', (err) => {
    record({
      source: 'client_main',
      message: (err && err.message) || String(err),
      stack: (err && err.stack) || '',
      details: { kind: 'uncaughtException', pid: process.pid, node: process.version, platform: process.platform },
    }).catch(() => {});
    console.error('═══ MAIN uncaughtException ═══');
    console.error(err && (err.stack || err.message) ? (err.stack || err.message) : err);
    console.error('══════════════════════════════');
    if (exitOnCrash) process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    record({
      source: 'client_main',
      message: (reason && reason.message) || String(reason),
      stack: (reason && reason.stack) || '',
      details: { kind: 'unhandledRejection', pid: process.pid, node: process.version, platform: process.platform },
    }).catch(() => {});
    console.error('═══ MAIN unhandledRejection ═══');
    console.error(reason);
    console.error('═══════════════════════════════');
    if (exitOnCrash) process.exit(1);
  });
}

/*
 * recordRendererCrash — entry point for IPC `crash:report` events from
 * renderer ErrorBoundary or window 'error' listener. Caller has
 * already serialized the error; we just persist + best-effort upload.
 */
function recordRendererCrash(details) {
  return record({
    source: 'client_renderer',
    message: details && details.message,
    stack: details && details.stack,
    details: details && details.details,
  });
}

module.exports = {
  init,
  setServerUrl,
  record,
  recordRendererCrash,
  installMainProcessHandlers,
  rotate,
  VALID_SOURCES,
};

/*
 * B2.2 — Crash reporter (server side).
 *
 * Captures uncaughtException + unhandledRejection in the server
 * process. Persists each crash twice:
 *   1. JSON dump file in crashes/<ISO>-<source>.json
 *   2. crash_log table row (append-only, schema-enforced)
 *
 * Two-phase write protocol:
 *   write file as <name>.json.pending
 *   attempt DB INSERT
 *   on success rename to <name>.json (atomic)
 *   on failure leave .pending; boot recovery sweeps re-flush
 *
 * Rotation keeps `crash_dump_retention_count` newest files on disk
 * (default 50). DB rows are NOT pruned — append-only triggers
 * enforce that. Operator can archive the table periodically.
 *
 * Public surface:
 *   recordCrash(db, {source, message, stack, details, computer_name,
 *                    version}) — sync write+INSERT
 *   rotate(dir, keep) — prune disk dir to N newest
 *   flushPendingAtBoot(db) — drain .pending files into crash_log
 *   installServerHandlers(getDb, getVersion?) — wire process.on
 *   getCrashDir(db) — resolve from settings or default
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CRASH_DIR_DEFAULT = path.resolve(__dirname, 'crashes');

const VALID_SOURCES = new Set([
  'server', 'client_main', 'client_renderer', 'client_native',
]);

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function isoStamp(d) {
  // 2026-06-22T14:35:12.345Z → 2026-06-22T14-35-12-345Z (filesystem-safe)
  return d.toISOString().replace(/[:.]/g, '-');
}

function getRetention(db) {
  try {
    const r = db.prepare("SELECT value FROM settings WHERE key = 'crash_dump_retention_count'").get();
    return Math.max(1, Number((r && r.value) || 50));
  } catch (_) { return 50; }
}

function getCrashDir(db) {
  try {
    const r = db.prepare("SELECT value FROM settings WHERE key = 'crash_dump_dir'").get();
    if (r && r.value) return path.resolve(r.value);
  } catch (_) {}
  return CRASH_DIR_DEFAULT;
}

/*
 * recordCrash — durable two-phase write. Returns { dbOk, fname, path }.
 * Never throws — crash handlers must not crash themselves. All failure
 * paths log to stderr and continue.
 */
function recordCrash(db, payload) {
  const now = new Date();
  const source = VALID_SOURCES.has(payload.source) ? payload.source : 'server';
  let dir;
  try { dir = getCrashDir(db); } catch (_) { dir = CRASH_DIR_DEFAULT; }
  try { ensureDir(dir); } catch (e) {
    console.error('[crash-reporter] ensureDir failed:', e.message);
  }

  const fname = isoStamp(now) + '-' + source + '.json';
  const pendingPath = path.join(dir, fname + '.pending');
  const flushedPath = path.join(dir, fname);

  const blob = {
    ts: now.toISOString(),
    source,
    computer_name: payload.computer_name || os.hostname(),
    version: payload.version || null,
    message: String((payload.message != null ? payload.message : '')).slice(0, 4000),
    stack: String((payload.stack != null ? payload.stack : '')).slice(0, 64_000),
    details: payload.details || null,
  };
  const json = JSON.stringify(blob, null, 2);

  try {
    fs.writeFileSync(pendingPath, json);
  } catch (e) {
    console.error('[crash-reporter] disk write failed:', e.message);
    // Even if disk failed, try DB insert below — the more durable record
    // wins. Without disk we lose the resume-on-boot retry.
  }

  let dbOk = false;
  try {
    db.prepare(
      'INSERT INTO crash_log (source, computer_name, version, message, stack, details) '
      + 'VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      blob.source,
      blob.computer_name,
      blob.version,
      blob.message,
      blob.stack,
      JSON.stringify(blob.details || {})
    );
    dbOk = true;
  } catch (e) {
    console.error('[crash-reporter] DB insert failed:', e.message);
  }

  if (dbOk) {
    try { fs.renameSync(pendingPath, flushedPath); }
    catch (_) { /* file may not exist if disk write failed; ignore */ }
  }

  try { rotate(dir, getRetention(db)); } catch (_) {}

  return { dbOk, fname, path: dbOk ? flushedPath : pendingPath };
}

/*
 * rotate — keep `keep` newest crash files (both .json and .json.pending).
 * pending files are kept regardless of age UP TO retention budget — we
 * want the boot recovery sweep to see them.
 */
function rotate(dir, keep) {
  if (!fs.existsSync(dir)) return { kept: 0, dropped: 0 };
  const all = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json') || f.endsWith('.json.pending'))
    .map(f => {
      const p = path.join(dir, f);
      return { name: f, path: p, mtime: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  let dropped = 0;
  for (const f of all.slice(keep)) {
    try { fs.unlinkSync(f.path); dropped++; } catch (_) {}
  }
  return { kept: Math.min(all.length, keep), dropped };
}

/*
 * flushPendingAtBoot — drain any *.json.pending files into crash_log.
 * Called once at server startup. Renames flushed files to drop the
 * .pending suffix.
 */
function flushPendingAtBoot(db) {
  let dir;
  try { dir = getCrashDir(db); } catch (_) { dir = CRASH_DIR_DEFAULT; }
  if (!fs.existsSync(dir)) return { found: 0, flushed: 0, failed: 0 };
  let found = 0, flushed = 0, failed = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json.pending')) continue;
    found++;
    const p = path.join(dir, f);
    try {
      const blob = JSON.parse(fs.readFileSync(p, 'utf8'));
      const source = VALID_SOURCES.has(blob.source) ? blob.source : 'server';
      db.prepare(
        'INSERT INTO crash_log (source, computer_name, version, message, stack, details, created_at) '
        + 'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        source,
        blob.computer_name || null,
        blob.version || null,
        blob.message || '',
        blob.stack || '',
        JSON.stringify(blob.details || {}),
        blob.ts || null
      );
      fs.renameSync(p, p.replace(/\.pending$/, ''));
      flushed++;
    } catch (e) {
      console.error('[crash-reporter] flush pending error', f, ':', e.message);
      failed++;
    }
  }
  try { rotate(dir, getRetention(db)); } catch (_) {}
  if (found > 0) {
    console.log('💥 [crash-reporter] boot flush — found=' + found + ' flushed=' + flushed + ' failed=' + failed);
  }
  return { found, flushed, failed };
}

/*
 * installServerHandlers — wire uncaughtException + unhandledRejection.
 * Each handler records the crash, logs to stderr, and exits with code 1
 * so the supervisor (B2.4 watchdog) can restart cleanly.
 */
function installServerHandlers(getDbFn, opts) {
  const getVersion = opts && typeof opts.getVersion === 'function' ? opts.getVersion : () => null;
  const exitOnCrash = opts && typeof opts.exitOnCrash === 'boolean' ? opts.exitOnCrash : true;

  const handle = (kind) => (err) => {
    try {
      const db = getDbFn();
      recordCrash(db, {
        source: 'server',
        computer_name: os.hostname(),
        version: getVersion() || null,
        message: (err && err.message) || String(err),
        stack: (err && err.stack) || '',
        details: {
          kind,                     // 'uncaughtException' | 'unhandledRejection'
          pid: process.pid,
          node: process.version,
          platform: process.platform,
        },
      });
    } catch (e) {
      console.error('[crash-reporter] handler-internal failure:', e.message);
    }
    console.error('═══ SERVER ' + kind + ' ═══');
    console.error(err && (err.stack || err.message) ? (err.stack || err.message) : err);
    console.error('═══════════════════════════');
    if (exitOnCrash) process.exit(1);
  };

  process.on('uncaughtException', handle('uncaughtException'));
  process.on('unhandledRejection', (reason) => handle('unhandledRejection')(reason));
}

module.exports = {
  recordCrash,
  rotate,
  flushPendingAtBoot,
  installServerHandlers,
  getCrashDir,
  VALID_SOURCES,
  CRASH_DIR_DEFAULT,
};

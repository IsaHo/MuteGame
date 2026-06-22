/*
 * B2.1 — SQLite Online Backup engine.
 *
 * Uses better-sqlite3's db.backup(destinationFile) which is WAL-aware
 * and non-blocking — writers continue during the snapshot.
 *
 * Public surface:
 *   performBackup(db, opts)   — take a snapshot, integrity-check it,
 *                               rotate the destination dir, optionally
 *                               copy to a secondary destination.
 *   listBackups(opts)         — enumerate backups in primary dest.
 *   rotateDir(dir, keep)      — prune dir to N most recent .db files,
 *                               drop stray .tmp older than 1h.
 *   shouldRunScheduled(db)    — boot scheduler predicate; true when
 *                               current hour matches schedule and last
 *                               run was > 23h ago.
 *   timestamp(date)           — UTC YYYYMMDD-HHMMSS for filenames.
 *   BackupError               — typed failure with .code in
 *                               {disk_full, integrity_check_failed,
 *                                source_missing, dest_unwritable}.
 *
 * Files land in <primary>/daily/ or <primary>/weekly/ (Sundays).
 * Manual snapshots tagged with -manual suffix; pre-migration tagged
 * with -pre-migration. Filenames are sortable UTC timestamps so the
 * mtime-based rotation is deterministic across timezones.
 *
 * All settings reads go through `settings` table — no direct file
 * config — so a single boot guard in database.js seeds defaults once
 * and operator changes via /api/settings UI take effect on next cycle.
 */

const fs = require('fs');
const path = require('path');

class BackupError extends Error {
  constructor(reason, details) {
    super('backup: ' + reason);
    this.name = 'BackupError';
    this.code = reason;
    this.details = details || {};
  }
}

function readSetting(db, key, fallback) {
  try {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return (r && r.value !== undefined) ? r.value : fallback;
  } catch (_) { return fallback; }
}

function writeSetting(db, key, value) {
  try {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) '
      + 'ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP'
    ).run(key, String(value));
  } catch (e) { /* settings update is best-effort; do not block backup */ }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function getDiskFreeBytes(dirPath) {
  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(dirPath);
      return stats.bavail * stats.bsize;
    }
  } catch (_) { /* fall through */ }
  // Older Node or unsupported FS — return Infinity so we don't block backups
  // on a disk-free check we can't compute. Production should be on Node ≥ 18.
  return Number.POSITIVE_INFINITY;
}

function timestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
    + '-' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
}

/*
 * performBackup — main entry point.
 *
 * opts:
 *   tag       — 'daily' | 'weekly' | 'manual' | 'pre-migration'  (default 'daily')
 *   dest      — primary directory override (defaults to settings)
 *   dest_secondary — secondary directory override
 *   db_path   — source DB file path (defaults to db.name from better-sqlite3)
 *   now       — Date override for tests
 *
 * Returns: { ok, path, size, tag, secondary, elapsed_ms, integrity_ms }
 * Throws:  BackupError on disk_full / integrity_check_failed / source_missing.
 */
async function performBackup(db, opts = {}) {
  const now = opts.now || new Date();
  const tag = opts.tag || 'daily';

  // Resolve source DB path. better-sqlite3 exposes `name` for the path
  // it was opened with; tests can override via opts.db_path.
  const dbPath = opts.db_path || db.name;
  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new BackupError('source_missing', { db_path: dbPath });
  }

  const primary       = opts.dest || readSetting(db, 'backup_dest_primary', './backups');
  const secondary     = opts.dest_secondary !== undefined ? opts.dest_secondary : readSetting(db, 'backup_dest_secondary', '');
  const minRatio      = Number(readSetting(db, 'backup_min_free_disk_ratio', '2.0'));
  const retentionDaily = Number(readSetting(db, 'backup_retention_daily', '14'));
  const retentionWeekly = Number(readSetting(db, 'backup_retention_weekly', '8'));

  const ts = timestamp(now);
  const suffix = (tag === 'manual' || tag === 'pre-migration') ? ('-' + tag) : '';
  const fileName = 'mutegame-' + ts + suffix + '.db';
  const subdir = (tag === 'weekly') ? 'weekly' : 'daily';
  const targetDir = path.resolve(primary, subdir);
  try { ensureDir(targetDir); }
  catch (e) { throw new BackupError('dest_unwritable', { dir: targetDir, err: e.message }); }
  const targetPath = path.join(targetDir, fileName);

  // Disk-free pre-check. Refuse if free < minRatio × db_size — avoids
  // partial writes on near-full disks.
  const dbStat = fs.statSync(dbPath);
  const dbSize = dbStat.size;
  const free = getDiskFreeBytes(targetDir);
  if (free !== Number.POSITIVE_INFINITY && free < dbSize * minRatio) {
    writeSetting(db, 'backup_last_status', 'fail:disk_full');
    writeSetting(db, 'backup_last_at', now.toISOString());
    throw new BackupError('disk_full', { free, required: dbSize * minRatio, db_size: dbSize });
  }

  // Write to .tmp then rename atomically. Crash mid-write leaves a .tmp
  // that the next rotation will sweep (≥ 1h old).
  const tmpPath = targetPath + '.tmp';
  const t0 = Date.now();
  await db.backup(tmpPath);
  const elapsed_ms = Date.now() - t0;
  fs.renameSync(tmpPath, targetPath);

  // Integrity check on the new file. Open read-only so the verifier
  // can't accidentally modify the snapshot.
  const t1 = Date.now();
  const Database = require('better-sqlite3');
  let integrityResult = null;
  const verify = new Database(targetPath, { readonly: true, fileMustExist: true });
  try {
    const r = verify.prepare('PRAGMA integrity_check').get();
    integrityResult = r && r.integrity_check;
  } finally { verify.close(); }
  const integrity_ms = Date.now() - t1;
  if (integrityResult !== 'ok') {
    // Leave the bad file in place so operators can inspect; record status.
    writeSetting(db, 'backup_last_status', 'fail:integrity');
    writeSetting(db, 'backup_last_at', now.toISOString());
    throw new BackupError('integrity_check_failed', { result: integrityResult, path: targetPath });
  }

  const size = fs.statSync(targetPath).size;
  writeSetting(db, 'backup_last_status', 'ok');
  writeSetting(db, 'backup_last_at', now.toISOString());
  writeSetting(db, 'backup_last_size_bytes', String(size));
  writeSetting(db, 'backup_last_path', targetPath);

  // Secondary destination (USB / SMB / off-machine). Best-effort copy;
  // failure is logged in the return value but does not fail the main op.
  let secondaryResult = null;
  if (secondary) {
    try {
      const secDir = path.resolve(secondary, subdir);
      ensureDir(secDir);
      const secPath = path.join(secDir, fileName);
      fs.copyFileSync(targetPath, secPath);
      secondaryResult = { ok: true, path: secPath };
    } catch (e) {
      secondaryResult = { ok: false, error: e.message };
    }
  }

  // Rotation.
  try {
    rotateDir(targetDir, (tag === 'weekly') ? retentionWeekly : retentionDaily);
  } catch (e) { /* non-fatal */ }

  return {
    ok: true,
    path: targetPath,
    size,
    tag,
    secondary: secondaryResult,
    elapsed_ms,
    integrity_ms,
    integrity: integrityResult,
  };
}

/*
 * rotateDir — keep `keep` most-recent .db files, drop the rest. Also
 * sweeps stray .tmp files older than 1h (crash-mid-snapshot leftovers).
 */
function rotateDir(dir, keep) {
  if (!fs.existsSync(dir)) return { kept: 0, dropped: 0 };
  const all = fs.readdirSync(dir);
  const dbFiles = all
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const p = path.join(dir, f);
      return { name: f, path: p, mtime: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  let dropped = 0;
  for (const f of dbFiles.slice(keep)) {
    try { fs.unlinkSync(f.path); dropped++; } catch (_) {}
  }
  const oneHourAgo = Date.now() - 3_600_000;
  for (const f of all) {
    if (!f.endsWith('.tmp')) continue;
    const p = path.join(dir, f);
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs < oneHourAgo) fs.unlinkSync(p);
    } catch (_) {}
  }
  return { kept: Math.min(dbFiles.length, keep), dropped };
}

/*
 * listBackups — enumerate snapshots in primary destination.
 *   opts.dest — override primary dir
 */
function listBackups(opts = {}) {
  const dir = opts.dest || './backups';
  const out = [];
  for (const sub of ['daily', 'weekly']) {
    const fullDir = path.resolve(dir, sub);
    if (!fs.existsSync(fullDir)) continue;
    for (const f of fs.readdirSync(fullDir)) {
      if (!f.endsWith('.db')) continue;
      const p = path.join(fullDir, f);
      const st = fs.statSync(p);
      out.push({
        name: f,
        path: p,
        tag: sub,
        size: st.size,
        mtime: st.mtimeMs,
        mtime_iso: new Date(st.mtimeMs).toISOString(),
      });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/*
 * shouldRunScheduled — predicate for the boot 60s ticker.
 * True when:
 *   - current hour == backup_schedule_hour
 *   - AND last successful backup was > 23h ago (or never)
 */
function shouldRunScheduled(db, now) {
  const n = now || new Date();
  const targetHour = Number(readSetting(db, 'backup_schedule_hour', '4'));
  const lastIso = readSetting(db, 'backup_last_at', '');
  const last = lastIso ? Date.parse(lastIso) : null;
  if (Number.isFinite(last)) {
    const hoursSince = (n.getTime() - last) / 3_600_000;
    if (hoursSince < 23) return false;
  }
  return n.getHours() === targetHour;
}

/*
 * pickTag — Sunday → 'weekly', else 'daily'. Pulled out for testability.
 */
function pickTag(now) {
  const n = now || new Date();
  return n.getDay() === 0 ? 'weekly' : 'daily';
}

module.exports = {
  performBackup,
  listBackups,
  rotateDir,
  shouldRunScheduled,
  pickTag,
  timestamp,
  BackupError,
};

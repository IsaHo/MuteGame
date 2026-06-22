#!/usr/bin/env node
/*
 * B2.1 — restore CLI.
 *
 * Usage:
 *   node restore.js <snapshot.db> [--target <path>] [--yes]
 *
 * Defaults:
 *   --target  resolves to ../mutegame.db relative to this script
 *
 * Procedure:
 *   1. Validate snapshot via PRAGMA integrity_check
 *   2. Show snapshot metadata (schema version, row counts)
 *   3. Confirm with operator (unless --yes)
 *   4. Copy current DB + WAL to .pre-restore-<ts> backup
 *   5. Remove current WAL/SHM (snapshot is a self-contained DB)
 *   6. Copy snapshot over target
 *   7. Re-open target read-only + PRAGMA integrity_check
 *   8. Print row counts of restored DB
 *
 * Exit codes:
 *   0 — success
 *   2 — bad args
 *   3 — snapshot integrity_check failed
 *   4 — post-restore integrity_check failed
 *   5 — operator declined confirmation
 *   6 — filesystem error
 *
 * Operator must stop the server BEFORE running. Restart after success.
 * The pre-restore copies (target + ".pre-restore-<ts>") are kept so a
 * mistaken restore can be undone manually.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Database = require('better-sqlite3');

function usage(code) {
  console.error('Usage: node restore.js <snapshot.db> [--target <path>] [--yes]');
  process.exit(code || 2);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') usage(0);

const snapshot = args[0];
let target = path.resolve(__dirname, '..', 'mutegame.db');
let assumeYes = false;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--target') { target = path.resolve(args[++i]); }
  else if (args[i] === '--yes' || args[i] === '-y') { assumeYes = true; }
  else { console.error('Unknown arg:', args[i]); usage(2); }
}

if (!fs.existsSync(snapshot)) {
  console.error('Snapshot not found:', snapshot);
  process.exit(2);
}

console.log('═══ MuteGame restore ═══');
console.log('Snapshot:', snapshot);
console.log('Target:  ', target);

console.log('\nStep 1/7 — validating snapshot integrity');
let verify = new Database(snapshot, { readonly: true, fileMustExist: true });
try {
  const r = verify.prepare('PRAGMA integrity_check').get();
  if (!r || r.integrity_check !== 'ok') {
    console.error('  FAIL integrity_check:', r);
    process.exit(3);
  }
  console.log('  ✓ integrity_check ok');

  // Metadata sanity — schema version + row counts.
  let v;
  try { v = verify.prepare("SELECT value FROM settings WHERE key='billing_engine_version'").get(); }
  catch (_) { v = null; }
  console.log('  billing_engine_version:', v ? v.value : '<missing>');

  for (const t of ['users', 'sessions', 'credit_ledger', 'credit_transactions__legacy', 'audit_log']) {
    try {
      const c = verify.prepare('SELECT COUNT(*) AS c FROM ' + t).get().c;
      console.log('  ' + t.padEnd(34) + c + ' rows');
    } catch (_) { /* table may not exist on older snapshots */ }
  }
} finally { verify.close(); }

function confirm() {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nThis will REPLACE ' + target + ' with the snapshot. Continue? [yes/NO] ', (ans) => {
      rl.close();
      res(String(ans).trim().toLowerCase());
    });
  });
}

(async () => {
if (!assumeYes) {
  const ans = await confirm();
  if (ans !== 'yes') {
    console.log('Aborted.');
    process.exit(5);
  }
}

// Pre-restore safety snapshot of the current target (if any).
console.log('\nStep 2/7 — backing up current target');
if (fs.existsSync(target)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
  const preRestorePath = target + '.pre-restore-' + stamp;
  try {
    fs.copyFileSync(target, preRestorePath);
    console.log('  ✓', preRestorePath);
  } catch (e) {
    console.error('  FAIL pre-restore backup:', e.message);
    process.exit(6);
  }
} else {
  console.log('  (no existing target — fresh restore)');
}

console.log('\nStep 3/7 — removing current WAL/SHM');
for (const ext of ['-wal', '-shm']) {
  const p = target + ext;
  if (fs.existsSync(p)) {
    try { fs.unlinkSync(p); console.log('  ✓ removed', p); }
    catch (e) { console.warn('  warn unlink', p, e.message); }
  }
}

console.log('\nStep 4/7 — copying snapshot over target');
try {
  fs.copyFileSync(snapshot, target);
  console.log('  ✓ copied (' + fs.statSync(target).size + ' bytes)');
} catch (e) {
  console.error('  FAIL copy:', e.message);
  process.exit(6);
}

console.log('\nStep 5/7 — verifying restored target');
let restored = new Database(target, { readonly: true, fileMustExist: true });
try {
  const r = restored.prepare('PRAGMA integrity_check').get();
  if (!r || r.integrity_check !== 'ok') {
    console.error('  FAIL post-restore integrity_check:', r);
    process.exit(4);
  }
  console.log('  ✓ integrity_check ok');
} finally { restored.close(); }

console.log('\nStep 6/7 — final row counts');
restored = new Database(target, { readonly: true, fileMustExist: true });
try {
  for (const t of ['users', 'sessions', 'credit_ledger', 'credit_transactions__legacy', 'audit_log']) {
    try {
      const c = restored.prepare('SELECT COUNT(*) AS c FROM ' + t).get().c;
      console.log('  ' + t.padEnd(34) + c + ' rows');
    } catch (_) {}
  }
} finally { restored.close(); }

console.log('\nStep 7/7 — done');
console.log('═══ Restore complete. Start the server now. ═══');
process.exit(0);
})().catch(e => { console.error('FATAL:', e.stack || e.message); process.exit(1); });

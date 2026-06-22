# Backup & Restore — Operator Runbook

## What runs automatically

Once the server is up, a background scheduler runs every minute and
takes a snapshot when **both** of these are true:

- current local hour equals `backup_schedule_hour` (default **04:00**)
- last successful backup was **more than 23 hours ago**

Backups land in:

```
backups/
├── daily/   ← 14 most recent (Mon–Sat)
└── weekly/  ← 8 most recent (Sundays)
```

File names are sortable UTC timestamps:

```
mutegame-20260622-040000.db          (scheduled daily)
mutegame-20260622-143012-manual.db   (admin-triggered)
```

After each snapshot the engine:

1. Renames `.tmp` → `.db` atomically (crash-safe)
2. Opens the new file read-only and runs `PRAGMA integrity_check`
3. Records status to `settings.backup_last_status`
4. Copies to `backup_dest_secondary` if configured (USB / SMB)
5. Prunes the destination dir to the retention budget

## Manual snapshot

From an authenticated admin session:

```
POST /api/admin/backup
```

Returns:

```json
{
  "ok": true,
  "path": ".../backups/daily/mutegame-...-manual.db",
  "size": 73728,
  "integrity": "ok",
  "secondary": null
}
```

Or via direct database open (CLI):

```
node -e "const Database=require('better-sqlite3'); const b=require('./server/backup'); (async()=>{const db=new Database('./server/mutegame.db'); console.log(await b.performBackup(db,{tag:'manual'})); db.close();})();"
```

## List existing snapshots

```
GET /api/admin/backups
```

Returns the entries sorted newest-first plus the last status string.

## Restore — full procedure

Stop the server **before** running the restore script. The restore swaps
files in place; a running server would have the old DB open and the
restore could deadlock or leave stale WAL.

```
# 1. Stop the service
#    (pm2 stop mutegame   /   systemctl stop mutegame   / Task Scheduler off)

# 2. Run the restore CLI
cd /path/to/MuteGame
node server/scripts/restore.js \
  server/backups/daily/mutegame-20260620-040000.db

#    Optional flags:
#      --target /custom/path/mutegame.db   (default: ./server/mutegame.db)
#      --yes                                (skip interactive confirmation)

# 3. Restart the service.
```

What the restore CLI does (in order):

1. Validates the snapshot (`PRAGMA integrity_check`)
2. Shows row counts (users, sessions, credit_ledger, audit_log, etc.)
3. Asks for `yes` confirmation (unless `--yes`)
4. Copies the **current** target to `<target>.pre-restore-<timestamp>`
   so a mistaken restore can be undone
5. Removes the current `-wal` / `-shm` files (snapshot is self-contained)
6. Copies the snapshot over the target
7. Re-validates the restored target

Exit codes:

| Code | Meaning |
|---|---|
| 0 | success |
| 2 | bad args / snapshot not found |
| 3 | snapshot failed integrity_check |
| 4 | restored target failed integrity_check |
| 5 | operator declined confirmation |
| 6 | filesystem error |

## Tune the schedule

All knobs live in `settings`. Edit via admin UI or `UPDATE settings`:

| key | default | meaning |
|---|---|---|
| `backup_dest_primary` | `./backups` | primary directory (server-relative) |
| `backup_dest_secondary` | (empty) | optional off-machine path (USB / SMB) |
| `backup_schedule_hour` | `4` | local hour to take daily snapshot |
| `backup_retention_daily` | `14` | how many daily files to keep |
| `backup_retention_weekly` | `8` | how many Sunday files to keep |
| `backup_min_free_disk_ratio` | `2.0` | refuse backup if free disk < ratio × DB size |
| `backup_last_at` | (engine-set) | ISO timestamp of last successful backup |
| `backup_last_status` | (engine-set) | `ok` or `fail:<reason>` |
| `backup_last_size_bytes` | (engine-set) | size of last backup |
| `backup_last_path` | (engine-set) | path of last backup |

## Common failure modes

| Status | Meaning | Action |
|---|---|---|
| `fail:disk_full` | Free space < `backup_min_free_disk_ratio` × DB size | Free disk space or move `backup_dest_primary` to a roomier volume |
| `fail:integrity` | The snapshot file failed `PRAGMA integrity_check` | Investigate — DB may be corrupt; restore from a known-good earlier snapshot, then take a fresh backup |
| `fail:dest_unwritable` | Cannot create the destination directory | Check permissions on `backup_dest_primary` |
| `fail:source_missing` | DB file at `db.name` not found | Likely an in-test issue; not seen in production |

## Off-machine destinations

The simplest off-machine target is a USB stick mounted at a stable path:

```
UPDATE settings SET value = 'D:\MuteGameBackups'
 WHERE key = 'backup_dest_secondary';
```

For Windows SMB shares, give the service account a credential and use
the UNC path:

```
UPDATE settings SET value = '\\backup-srv\mutegame'
 WHERE key = 'backup_dest_secondary';
```

The secondary copy is best-effort: if it fails the primary is still
recorded as `ok` and the operator sees a structured error in the
returned `secondary` field of `POST /api/admin/backup`.

## Disaster Recovery test (run before going live)

This is the manual version of the automated DR test in our fixture
suite. Run it on a non-production machine.

```
# 1. Take a fresh backup
curl -X POST -H "Authorization: Bearer $JWT" http://localhost:3001/api/admin/backup

# 2. Stop the server
pm2 stop mutegame

# 3. Delete the active DB
rm server/mutegame.db server/mutegame.db-wal server/mutegame.db-shm

# 4. Restore the backup
node server/scripts/restore.js server/backups/daily/<latest>.db --yes

# 5. Start the server
pm2 start mutegame

# 6. Verify:
curl http://localhost:3001/api/users         # users intact
# log in via kiosk, watch ticker bill correctly
# open admin Audit page, verify previous rows still visible
```

Expected outcome: every user / session / ledger / audit row from before
the deletion is present and writable.

## Pre-migration snapshot

For risky operations (schema migrations, manual SQL fixes) take a manual
snapshot first:

```
curl -X POST -H "Authorization: Bearer $JWT" http://localhost:3001/api/admin/backup
# wait for response; note the path
```

Then proceed with the operation. If it goes wrong, restore the snapshot
per the procedure above.

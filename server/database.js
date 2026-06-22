const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

let db;

function getDb() {
  return db;
}

function initDatabase() {
  // Use DB_PATH env var (set by Electron main.js to userData dir on Windows)
  // so we don't try to write inside read-only app.asar.
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'mutegame.db');
  // Make sure parent dir exists (userData might not be created yet on first run)
  try {
    const fs = require('fs');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch {}
  console.log('📂 DB path:', dbPath);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT DEFAULT '',
      family TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      credits REAL DEFAULT 0,
      total_minutes INTEGER DEFAULT 0,
      total_spent REAL DEFAULT 0,
      debt REAL DEFAULT 0,
      debt_since DATETIME,
      discount_percent REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      computer_name TEXT,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      duration INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS shop_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      buy_price REAL DEFAULT 0,
      category TEXT DEFAULT 'food',
      emoji TEXT DEFAULT '🍔',
      stock INTEGER DEFAULT -1,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shop_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      computer_name TEXT,
      items TEXT NOT NULL,
      total REAL NOT NULL,
      payment_method TEXT DEFAULT 'cash',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      exe_name TEXT NOT NULL,
      image_path TEXT DEFAULT '',
      category TEXT DEFAULT 'all',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      hint_path TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS dns_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      primary_dns TEXT NOT NULL,
      secondary_dns TEXT DEFAULT '',
      country TEXT DEFAULT 'IR',
      is_default INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS modems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ip TEXT NOT NULL,
      gateway TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS client_assignments (
      computer_name TEXT PRIMARY KEY,
      modem_id INTEGER,
      dns_id INTEGER,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (modem_id) REFERENCES modems(id),
      FOREIGN KEY (dns_id) REFERENCES dns_servers(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      admin_username TEXT,
      admin_ip TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      details TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Append-only enforcement at the storage layer. The application code
    -- never UPDATEs or DELETEs from audit_log, but nothing in the schema
    -- previously stopped a future bug (or a developer-added "retention
    -- purge") from doing so. These triggers raise ABORT before any mutation
    -- lands, so even a stray DELETE FROM audit_log slip rolls back with a
    -- clear error message.
    --
    -- SQLite has no BEFORE DROP TABLE trigger, so drop protection lives at
    -- the application layer (no route ever issues DROP) plus the boot-time
    -- sqlite_master check below, which refuses to start if these triggers
    -- are missing.
    CREATE TRIGGER IF NOT EXISTS audit_log_no_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only');
    END;
  `);

  // ─── Audit-log integrity verification (boot-time, non-mutating) ──
  // We trust sqlite_master, not a probe write. The previous draft would
  // have INSERTed-then-UPDATEd a row to confirm the trigger fires; that
  // pollutes the log and has its own failure modes. Reading sqlite_master
  // is the canonical SQLite way to confirm trigger existence.
  const auditTriggers = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('audit_log_no_update','audit_log_no_delete')"
  ).all().map(r => r.name);
  const missing = ['audit_log_no_update', 'audit_log_no_delete'].filter(t => !auditTriggers.includes(t));
  if (missing.length) {
    throw new Error(
      `audit_log append-only triggers missing in DB: ${missing.join(', ')}. ` +
      `Refusing to start — the audit log is unprotected. Investigate before restarting.`
    );
  }

  // PRAGMA defensive=ON (SQLite 3.31+) blocks dangerous patterns like writes
  // through fts5 / rtree that can bypass triggers. Read it back — better-sqlite3
  // vendors its own SQLite and the flag may be compile-disabled, in which case
  // the SET is silently no-op'd. We log instead of throwing — triggers are the
  // primary protection; this is defense-in-depth.
  try {
    db.pragma('defensive = ON');
    const v = db.pragma('defensive', { simple: true });
    if (v === 1) console.log('🛡  PRAGMA defensive=ON (audit log hardened)');
    else console.warn('[audit] PRAGMA defensive not effective (value=' + v + '); this SQLite build may have SQLITE_ENABLE_DEFENSIVE disabled. Triggers still active.');
  } catch (e) { console.warn('[audit] PRAGMA defensive not available:', e.message); }

  // Migrate existing tables
  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols.includes('name'))             db.exec("ALTER TABLE users ADD COLUMN name TEXT DEFAULT ''");
  if (!userCols.includes('family'))           db.exec("ALTER TABLE users ADD COLUMN family TEXT DEFAULT ''");
  if (!userCols.includes('phone'))            db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''");
  if (!userCols.includes('is_active'))        db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1");
  if (!userCols.includes('debt'))             db.exec("ALTER TABLE users ADD COLUMN debt REAL DEFAULT 0");
  if (!userCols.includes('debt_since'))       db.exec("ALTER TABLE users ADD COLUMN debt_since DATETIME");
  if (!userCols.includes('discount_percent')) db.exec("ALTER TABLE users ADD COLUMN discount_percent REAL DEFAULT 0");
  // limit_minutes: max session minutes per login (0 = unlimited).
  // allowed_seats: how many simultaneous PCs can use this account; the
  // user's credits are split equally across each active session.
  // post_pay: when true the user can play with negative credit (becomes debt).
  if (!userCols.includes('limit_minutes')) db.exec("ALTER TABLE users ADD COLUMN limit_minutes INTEGER DEFAULT 0");
  if (!userCols.includes('allowed_seats')) db.exec("ALTER TABLE users ADD COLUMN allowed_seats INTEGER DEFAULT 1");
  if (!userCols.includes('post_pay'))      db.exec("ALTER TABLE users ADD COLUMN post_pay INTEGER DEFAULT 0");
  // limit_time: when 1, the user can log in WITHOUT credit and the launcher
  // shows the text "لیمیت تایم" instead of a countdown — used for staff /
  // family / VIP accounts that play freely.
  if (!userCols.includes('limit_time'))    db.exec("ALTER TABLE users ADD COLUMN limit_time INTEGER DEFAULT 0");

  const shopCols = db.prepare("PRAGMA table_info(shop_items)").all().map(c => c.name);
  if (!shopCols.includes('buy_price')) db.exec("ALTER TABLE shop_items ADD COLUMN buy_price REAL DEFAULT 0");

  const orderCols = db.prepare("PRAGMA table_info(shop_orders)").all().map(c => c.name);
  if (!orderCols.includes('status')) db.exec("ALTER TABLE shop_orders ADD COLUMN status TEXT DEFAULT 'pending'");

  // Admin roles & permissions
  const adminCols = db.prepare("PRAGMA table_info(admins)").all().map(c => c.name);
  if (!adminCols.includes('role'))         db.exec("ALTER TABLE admins ADD COLUMN role TEXT DEFAULT 'manager'");
  if (!adminCols.includes('permissions'))  db.exec("ALTER TABLE admins ADD COLUMN permissions TEXT DEFAULT ''"); // JSON array of granted perms; '*' or empty = all (super)
  if (!adminCols.includes('is_active'))    db.exec("ALTER TABLE admins ADD COLUMN is_active INTEGER DEFAULT 1");
  if (!adminCols.includes('display_name')) db.exec("ALTER TABLE admins ADD COLUMN display_name TEXT DEFAULT ''");
  if (!adminCols.includes('last_login'))   db.exec("ALTER TABLE admins ADD COLUMN last_login DATETIME");

  // Games migrations
  const gameCols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);
  if (!gameCols.includes('is_launcher')) db.exec("ALTER TABLE games ADD COLUMN is_launcher INTEGER DEFAULT 0");

  // Promote default admin to super
  db.prepare("UPDATE admins SET role = 'super', permissions = '*' WHERE username = 'admin' AND (role IS NULL OR role = '' OR role = 'manager')").run();
  // Set a friendly default display name for the seed admin so the sidebar
  // doesn't read "admin" forever — operators can override from AdminsPage.
  db.prepare("UPDATE admins SET display_name = 'مدیر سیستم' WHERE username = 'admin' AND (display_name IS NULL OR display_name = '')").run();

  // Default settings
  const defaultSettings = [
    ['gaming_price_per_hour', '30000'],
    ['gaming_peak_multiplier', '1.5'],
    ['gaming_peak_start', '16'],
    ['gaming_peak_end', '24'],
    ['gaming_offpeak_multiplier', '1'],   // ≤1 = discount during quiet hours
    ['gaming_offpeak_start', '0'],
    ['gaming_offpeak_end', '12'],
    ['cafe_name', 'MuteGame'],
    ['cafe_address', ''],
    ['cafe_phone', ''],
    ['currency', 'ریال'],
    ['currency_unit', 'rial'],   // 'rial' | 'toman' — display unit for amounts (1 toman = 10 rial)
    ['tier1_discount', '10'],
    ['tier2_discount', '5'],
    ['tier3_discount', '2'],
    ['bad_payer_days', '7'],
    // Server config
    ['server_port', '3001'],
    ['server_bind_ip', '0.0.0.0'],
    // Time-limit warnings
    ['warn_at_minutes', '10,5,1'],     // comma-separated thresholds (minutes remaining) at which client beeps
    ['warn_sound', 'beep'],             // beep | chime | siren | none
    ['warn_volume', '70'],              // 0..100
    // Default DNS for new clients
    ['default_dns_id', '0'],
  ];
  const upsertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  defaultSettings.forEach(([k, v]) => upsertSetting.run(k, v));

  const adminExists = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run('admin', hash);
    console.log('✅ Default admin: admin / admin123');
  }

  // Seed a couple of test users so the cafe is testable out of the box.
  // Password is the same as username (matches the auto-create flow in users.js).
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (userCount.cnt === 0) {
    const insertUser = db.prepare(
      'INSERT INTO users (username, password, name, family, phone, credits, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
    );
    const seedUsers = [
      // [username, name, family, phone, initial-credits-rial]
      ['1001', 'علی',  'احمدی', '09120000001', 100000],
      ['1002', 'سارا', 'کریمی', '09120000002', 200000],
      ['1003', 'محمد', 'رضایی', '09120000003',  50000],
    ];
    seedUsers.forEach(([username, name, family, phone, credits]) => {
      const hash = bcrypt.hashSync(username, 10);
      insertUser.run(username, hash, name, family, phone, credits);
    });
    console.log(`✅ Default test users seeded (${seedUsers.length}) — login with code as both username & password`);
  }

  // ── Seed default games (only on first init) ──────────────────────
  const gameCount = db.prepare('SELECT COUNT(*) as cnt FROM games').get();
  if (gameCount.cnt === 0) {
    const games = [
      // [name, exe_name, category, sort_order, hint_path, is_launcher]
      // Popular games
      ['Counter-Strike 2',         'cs2.exe',                 'fps',      1, 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe', 0],
      ['Valorant',                 'VALORANT.exe',            'fps',      2, 'C:\\Riot Games\\VALORANT\\live\\VALORANT.exe', 0],
      ['Fortnite',                 'FortniteClient-Win64-Shipping.exe', 'fps', 3, 'C:\\Program Files\\Epic Games\\Fortnite', 0],
      ['Apex Legends',             'r5apex.exe',              'fps',      4, 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Apex Legends', 0],
      ['Call of Duty: Warzone',    'cod.exe',                 'fps',      5, '', 0],
      ['PUBG',                     'TslGame.exe',             'fps',      6, '', 0],
      ['GTA V',                    'GTA5.exe',                'action',   7, 'C:\\Program Files\\Rockstar Games\\Grand Theft Auto V', 0],
      ['Red Dead Redemption 2',    'RDR2.exe',                'action',   8, '', 0],
      ['Minecraft',                'Minecraft.exe',           'sandbox',  9, '', 0],
      ['FIFA 24',                  'FC24.exe',                'sport',   10, '', 0],
      ['eFootball PES',            'efootball.exe',           'sport',   11, '', 0],
      ['Forza Horizon 5',          'ForzaHorizon5.exe',       'racing',  12, '', 0],
      ['Need for Speed',           'NeedForSpeed.exe',        'racing',  13, '', 0],
      ['League of Legends',        'LeagueClient.exe',        'strategy',14, 'C:\\Riot Games\\League of Legends', 0],
      ['Dota 2',                   'dota2.exe',               'strategy',15, '', 0],
      ['The Witcher 3',            'witcher3.exe',            'rpg',     16, '', 0],
      ['Cyberpunk 2077',           'Cyberpunk2077.exe',       'rpg',     17, '', 0],
      // Launcher entries (shown in launcher bar, not games list)
      ['Steam',                    'steam.exe',               'launcher', 1, 'C:\\Program Files (x86)\\Steam\\steam.exe', 1],
      ['Epic Games',               'EpicGamesLauncher.exe',   'launcher', 2, 'C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe', 1],
      ['Battle.net',               'Battle.net.exe',          'launcher', 3, 'C:\\Program Files (x86)\\Battle.net\\Battle.net.exe', 1],
      ['EA App',                   'EADesktop.exe',           'launcher', 4, 'C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe', 1],
      ['Ubisoft Connect',          'upc.exe',                 'launcher', 5, 'C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\upc.exe', 1],
      ['Riot Client',              'RiotClientServices.exe',  'launcher', 6, 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe', 1],
      ['Discord',                  'Discord.exe',             'launcher', 7, '', 1],
      ['Chrome',                   'chrome.exe',              'launcher', 8, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 1],
    ];
    const insertGame = db.prepare(
      'INSERT INTO games (name, exe_name, category, sort_order, hint_path, is_launcher) VALUES (?, ?, ?, ?, ?, ?)'
    );
    games.forEach(g => insertGame.run(...g));
    console.log(`✅ Default games seeded (${games.length})`);
  }

  const itemCount = db.prepare('SELECT COUNT(*) as cnt FROM shop_items').get();
  if (itemCount.cnt === 0) {
    const items = [
      ['ساندویچ مرغ', 25000, 5000, 'food', '🥪', 50],
      ['پیتزا', 45000, 15000, 'food', '🍕', 30],
      ['همبرگر', 35000, 10000, 'food', '🍔', 40],
      ['هات‌داگ', 20000, 6000, 'food', '🌭', 45],
      ['نوشابه', 10000, 3000, 'drink', '🥤', 100],
      ['آب معدنی', 5000, 1500, 'drink', '💧', 200],
      ['دوغ', 8000, 2500, 'drink', '🧋', 80],
      ['قهوه', 20000, 7000, 'drink', '☕', 40],
      ['چای', 8000, 2000, 'drink', '🍵', 100],
      ['انرژی‌زا', 25000, 8000, 'drink', '⚡', 60],
      ['چیپس', 12000, 4000, 'snack', '🍟', 80],
      ['شکلات', 15000, 5000, 'snack', '🍫', 50],
      ['آجیل', 18000, 6000, 'snack', '🥜', 40],
      ['پاپ‌کورن', 10000, 3000, 'snack', '🍿', 60],
    ];
    const insert = db.prepare('INSERT INTO shop_items (name, price, buy_price, category, emoji, stock) VALUES (?, ?, ?, ?, ?, ?)');
    items.forEach(item => insert.run(...item));
    console.log('✅ Default shop items added');
  }

  // Seed Iranian DNS servers (only on first init)
  const dnsCount = db.prepare('SELECT COUNT(*) as cnt FROM dns_servers').get();
  if (dnsCount.cnt === 0) {
    const dnsList = [
      ['شکن (Shecan)',       '178.22.122.100',  '185.51.200.2',    'IR', 1, 'فیلترشکن داخلی محبوب'],
      ['الکترو (Electro)',   '78.157.42.100',   '78.157.42.101',   'IR', 0, 'سریع و قابل اطمینان'],
      ['۴۰۳ آنلاین (403)',    '10.202.10.202',   '10.202.10.102',   'IR', 0, '403.online'],
      ['بگذر (Begzar)',      '185.55.226.26',   '185.55.225.25',   'IR', 0, 'دور زدن فیلترینگ'],
      ['رادار (Radar)',       '10.202.10.10',    '10.202.10.11',    'IR', 0, 'radargame.ir'],
      ['پیشگامان',           '5.202.100.100',   '5.202.100.101',   'IR', 0, 'Pishgaman'],
      ['آسیاتک',             '194.225.62.80',   '194.225.50.80',   'IR', 0, 'AsiaTech'],
      ['شاتل',                '85.15.1.14',      '85.15.1.15',      'IR', 0, 'Shatel'],
      ['Cloudflare',         '1.1.1.1',         '1.0.0.1',         'INT', 0, 'سریع‌ترین DNS بین‌المللی'],
      ['Google',             '8.8.8.8',         '8.8.4.4',         'INT', 0, 'Google Public DNS'],
      ['Quad9',              '9.9.9.9',         '149.112.112.112', 'INT', 0, 'با محافظت امنیتی'],
      ['OpenDNS',            '208.67.222.222',  '208.67.220.220',  'INT', 0, 'Cisco OpenDNS'],
    ];
    const ins = db.prepare('INSERT INTO dns_servers (name, primary_dns, secondary_dns, country, is_default, notes) VALUES (?, ?, ?, ?, ?, ?)');
    dnsList.forEach(d => ins.run(...d));
    console.log('✅ Default DNS list seeded (' + dnsList.length + ')');
  }

  // ─── Billing migration prep (Phase 1) ────────────────────────────────
  // Idempotent data fix that establishes the pre-conditions for the
  // billing v2 schema in Phase 2:
  //   • every orphan session is closed (end_time set) with end_reason
  //     'pre_migration' — Phase 2's UNIQUE INDEX
  //     idx_one_open_session_per_seat would otherwise fail to create.
  //   • users.credits floored at 0; overflow moved to debt — Phase 2 adds
  //     CHECK (credits >= 0) which would otherwise reject the entire
  //     migration.
  //   • users.debt floored at 0 — same CHECK rationale.
  //   • every balance move records a credit_transactions row so the
  //     ledger captures the absorption (it'll be carried into
  //     credit_ledger by Phase 2's import).
  // Idempotent: the WHERE clauses are empty on second run, so re-execution
  // is a no-op. Safe to run on every boot.
  try {
    prepBillingMigration(db);
  } catch (e) { console.error('billing-prep:', e.stack || e.message); throw e; }

  // ─── Billing schema v2 (Phase 2) ─────────────────────────────────────
  // The structural migration. Adds the new sessions columns, the partial
  // UNIQUE INDEX that enforces "one open session per seat", the
  // credit_ledger table with arithmetic CHECKs + append-only triggers,
  // recreates `users` with credits/debt/total CHECKs, and seeds the new
  // billing settings. Idempotent: each step probes current schema state
  // and is a no-op once applied. See section §1 of the Phase 2 spec.
  try {
    applyBillingSchemaV2(db);
  } catch (e) { console.error('billing-schema-v2:', e.stack || e.message); throw e; }

  // ─── Billing migration Phase 3 (credit_transactions → __legacy + VIEW)
  // Renames the legacy credit_transactions table out of the way and
  // installs a VIEW with the same name that projects __legacy ∪
  // credit_ledger rows. Existing INSERT-into-credit_transactions sites
  // (un-refactored routes between C3A and C3B) keep working via an
  // INSTEAD-OF-INSERT trigger that redirects to __legacy. Idempotent
  // via boot guard. See the C3A preflight + safety proof.
  try {
    applyBillingMigrationPhase3(db);
  } catch (e) { console.error('billing-migration-phase3:', e.stack || e.message); throw e; }

  // ─── B2.2 — crash_log schema (idempotent boot probe + create) ────────
  // Append-only table + triggers, same pattern as audit_log. Verified
  // at boot; refuses to start if triggers go missing.
  try {
    applyCrashLogSchema(db);
  } catch (e) { console.error('crash-log-schema:', e.stack || e.message); throw e; }

  console.log('✅ Database ready');
}

/*
 * Phase 1 idempotent billing data fix. Public for testability. Returns a
 * structured report so callers (boot, tests, operator dry-runs) can verify
 * exact rows affected without re-querying the DB.
 *
 * Idempotency: every WHERE clause is empty on subsequent runs because the
 * fix flips the matching predicate to false. Running this on every boot is
 * intentional — a cheap consistency probe.
 *
 * Schema changes here are conservative: only an additive nullable
 * `end_reason TEXT` column on sessions. No data is lost; no existing query
 * breaks. The big schema restructure (CHECK constraints on users, new
 * tables, partial UNIQUE INDEX) lands in Phase 2.
 */
function prepBillingMigration(db) {
  const report = {
    started_at: new Date().toISOString(),
    schema_changes: [],
    sessions_closed: 0,
    sessions_closed_ids: [],
    users_credits_floored: 0,
    users_credits_floored_details: [],
    users_debt_floored: 0,
    users_debt_floored_details: [],
    ledger_writes: 0,
  };

  // (a) Add nullable end_reason column if missing. Idempotent via PRAGMA.
  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
  if (!sessionCols.includes('end_reason')) {
    db.exec('ALTER TABLE sessions ADD COLUMN end_reason TEXT');
    report.schema_changes.push('sessions.end_reason TEXT (added)');
  }

  // (b) Close orphan sessions. COALESCE(start_time, CURRENT_TIMESTAMP):
  // start_time is the conservative choice when last_billed_at doesn't
  // exist yet; duration was already accumulated by the per-minute ticker.
  const orphans = db.prepare('SELECT id FROM sessions WHERE end_time IS NULL').all();
  if (orphans.length > 0) {
    const closeStmt = db.prepare(
      "UPDATE sessions SET end_time = COALESCE(start_time, CURRENT_TIMESTAMP), " +
      "end_reason = COALESCE(end_reason, 'pre_migration') " +
      'WHERE id = ? AND end_time IS NULL'
    );
    for (const o of orphans) {
      closeStmt.run(o.id);
      report.sessions_closed_ids.push(o.id);
    }
    report.sessions_closed = orphans.length;
  }

  // (c) Floor negative credits → debt. Each user fixed in its own
  // transaction so the UPDATE and the ledger INSERT commit together.
  const negCredit = db.prepare('SELECT id, username, credits, debt FROM users WHERE credits < 0').all();
  for (const u of negCredit) {
    const delta = -u.credits;
    db.transaction(() => {
      const r = db.prepare(
        'UPDATE users SET credits = 0, debt = debt + ? WHERE id = ? AND credits < 0'
      ).run(delta, u.id);
      if (r.changes !== 1) {
        throw new Error('prepBillingMigration: negCredit UPDATE matched ' + r.changes + ' rows for user ' + u.id);
      }
      db.prepare(
        'INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)'
      ).run(u.id, delta, 'debt_add', 'pre_migration: negative credits absorbed to debt (delta=' + delta + ')');
      report.ledger_writes += 1;
    })();
    report.users_credits_floored_details.push({ user_id: u.id, username: u.username, credits_before: u.credits, debt_before: u.debt, debt_after: u.debt + delta, delta });
  }
  report.users_credits_floored = negCredit.length;

  // (d) Floor negative debt → 0. Records a 0-amount debt_pay marker so the
  // ledger explains the flip.
  const negDebt = db.prepare('SELECT id, username, debt FROM users WHERE debt < 0').all();
  for (const u of negDebt) {
    const original = u.debt;
    db.transaction(() => {
      const r = db.prepare('UPDATE users SET debt = 0 WHERE id = ? AND debt < 0').run(u.id);
      if (r.changes !== 1) {
        throw new Error('prepBillingMigration: negDebt UPDATE matched ' + r.changes + ' rows for user ' + u.id);
      }
      db.prepare(
        'INSERT INTO credit_transactions (user_id, amount, type, description) VALUES (?, ?, ?, ?)'
      ).run(u.id, 0, 'debt_pay', 'pre_migration: negative debt floored to zero (was=' + original + ')');
      report.ledger_writes += 1;
    })();
    report.users_debt_floored_details.push({ user_id: u.id, username: u.username, original_debt: original });
  }
  report.users_debt_floored = negDebt.length;

  report.completed_at = new Date().toISOString();

  const touched = report.sessions_closed + report.users_credits_floored + report.users_debt_floored + report.schema_changes.length;
  if (touched > 0) {
    console.log('🧹 [billing-prep] applied — ' + JSON.stringify({
      sessions_closed: report.sessions_closed,
      users_credits_floored: report.users_credits_floored,
      users_debt_floored: report.users_debt_floored,
      ledger_writes: report.ledger_writes,
      schema_changes: report.schema_changes,
    }));
  } else {
    console.log('🧹 [billing-prep] no-op (idempotent: all invariants already satisfied)');
  }

  return report;
}

/*
 * Phase 2 — billing-schema-v2. Idempotent structural migration.
 *
 * Each of S1..S7 is gated by a schema-state probe (PRAGMA table_info /
 * sqlite_master / settings key presence) so re-running the function on
 * a fully-migrated DB is a complete no-op. Crashes mid-step roll back
 * atomically via WAL; the next boot resumes from the first not-yet-
 * applied step. See the Phase 2 spec for the locking/runtime matrix.
 *
 * Public for testability — fixture and real-snapshot tests invoke this
 * directly outside of initDatabase().
 */
function applyBillingSchemaV2(db) {
  const report = {
    started_at: new Date().toISOString(),
    sessions_columns_added: [],
    indexes_created: [],
    tables_created: [],
    triggers_created: [],
    users_rebuilt: false,
    users_rebuilt_rows: 0,
    settings_inserted: [],
    clock_warp_probe: 'skipped (empty ledger)',
  };

  // ── S1. Add sessions columns ────────────────────────────────────────
  // Additive ALTERs are individually atomic. Each gate is a column-name
  // probe so partial application (crash mid-list) resumes cleanly.
  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
  const sessionAdds = [
    ['session_uuid',         'TEXT'],
    ['seat_slot',            'INTEGER NOT NULL DEFAULT 0'],
    ['state',                "TEXT NOT NULL DEFAULT 'closed'"],
    ['last_billed_at',       'DATETIME'],
    ['unpaid_micros',        'INTEGER NOT NULL DEFAULT 0'],
    ['locked_rate_per_hour', 'REAL'],
    ['closed_by_admin_id',   'INTEGER'],
  ];
  for (const [name, decl] of sessionAdds) {
    if (!sessionCols.includes(name)) {
      db.exec('ALTER TABLE sessions ADD COLUMN ' + name + ' ' + decl);
      report.sessions_columns_added.push(name);
    }
  }

  // ── S2. Partial UNIQUE INDEX on open sessions ───────────────────────
  // Pre-assert Phase 1's invariant. If anyone bypassed Phase 1 and we
  // have open sessions, the UNIQUE INDEX build could either silently
  // succeed (one-row case) or fail with SQLITE_CONSTRAINT_UNIQUE (multi
  // open per seat). Surface the misconfiguration explicitly instead.
  const stillOpen = db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE end_time IS NULL').get().c;
  if (stillOpen > 0) {
    throw new Error(
      'billing-schema-v2: refusing to create idx_one_open_session_per_seat — ' +
      stillOpen + ' open sessions still present. Phase 1 (prepBillingMigration) ' +
      'must have closed all open sessions. Investigate before retrying.'
    );
  }
  const hadIdx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_one_open_session_per_seat'"
  ).get();
  if (!hadIdx) {
    db.exec(
      'CREATE UNIQUE INDEX idx_one_open_session_per_seat ' +
      'ON sessions (computer_name, seat_slot) WHERE end_time IS NULL'
    );
    report.indexes_created.push('idx_one_open_session_per_seat');
  }

  // ── S3. credit_ledger + supporting indexes ──────────────────────────
  // CHECK constraints encode the arithmetic invariant. credits/debt
  // balances are reconstructible from this table alone:
  //   users.credits == initial + Σ amount_credits  per user_id
  // event_type is a CHECK enum — new types require a versioned migration.
  // session_id FK to sessions(id) — currently metadata-only (PRAGMA
  // foreign_keys is OFF on this DB); becomes enforced when FKs are
  // globally enabled (planned Phase 6).
  const hadLedger = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='credit_ledger'"
  ).get();
  if (!hadLedger) {
    db.exec(`
      CREATE TABLE credit_ledger (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL,
        session_id      INTEGER REFERENCES sessions(id),
        event_type      TEXT    NOT NULL CHECK (event_type IN (
                          'tick','recharge','debt_pay','debt_add','shop',
                          'manual_credit','manual_debit','reconciliation'
                        )),
        amount_credits  REAL    NOT NULL,
        amount_debt     REAL    NOT NULL DEFAULT 0,
        credits_before  REAL    NOT NULL,
        credits_after   REAL    NOT NULL,
        debt_before     REAL    NOT NULL,
        debt_after      REAL    NOT NULL,
        rate_per_hour   REAL,
        multiplier      REAL,
        tick_seconds    INTEGER,
        admin_id        INTEGER,
        description     TEXT,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (credits_before + amount_credits = credits_after),
        CHECK (debt_before    + amount_debt    = debt_after),
        CHECK (credits_after >= 0),
        CHECK (debt_after    >= 0),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
    `);
    report.tables_created.push('credit_ledger');
  }
  const ledgerIndexes = [
    ['idx_credit_ledger_user_time',
      'CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_time ON credit_ledger (user_id, created_at)'],
    ['idx_credit_ledger_session',
      'CREATE INDEX IF NOT EXISTS idx_credit_ledger_session ON credit_ledger (session_id) WHERE session_id IS NOT NULL'],
    ['idx_credit_ledger_event_time',
      'CREATE INDEX IF NOT EXISTS idx_credit_ledger_event_time ON credit_ledger (event_type, created_at)'],
  ];
  for (const [name, sql] of ledgerIndexes) {
    const had = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
    db.exec(sql);
    if (!had) report.indexes_created.push(name);
  }

  // ── S4. credit_ledger append-only triggers + boot verification ──────
  // Same pattern as audit_log_no_update / no_delete. Schema-layer
  // enforcement that survives application bugs and operator typos.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS credit_ledger_no_update
    BEFORE UPDATE ON credit_ledger
    BEGIN
      SELECT RAISE(ABORT, 'credit_ledger is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS credit_ledger_no_delete
    BEFORE DELETE ON credit_ledger
    BEGIN
      SELECT RAISE(ABORT, 'credit_ledger is append-only');
    END;
  `);
  const wantTriggers = ['credit_ledger_no_update', 'credit_ledger_no_delete'];
  const haveTriggers = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('credit_ledger_no_update','credit_ledger_no_delete')"
  ).all().map(r => r.name);
  const missingTriggers = wantTriggers.filter(t => !haveTriggers.includes(t));
  if (missingTriggers.length) {
    throw new Error(
      'billing-schema-v2: credit_ledger append-only triggers missing after CREATE: ' +
      missingTriggers.join(', ') + '. Refusing to continue.'
    );
  }
  for (const t of wantTriggers) {
    if (!report.triggers_created.includes(t)) report.triggers_created.push(t);
  }

  // ── S5. Rebuild users with CHECK constraints ────────────────────────
  // SQLite cannot add a CHECK to an existing table. Use the canonical
  // 12-step pattern. Guard by sqlite_master SQL probe so re-runs are
  // no-ops once the rebuild has landed.
  const usersSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
  ).get().sql || '';
  const usersHasCheck = /CHECK\s*\(\s*credits\s*>=\s*0\s*\)/i.test(usersSql);
  if (!usersHasCheck) {
    // PRAGMA foreign_keys cannot be toggled inside a transaction; the
    // canonical sequence is: disable FKs → BEGIN → swap → COMMIT → re-enable.
    // We additionally run PRAGMA foreign_key_check inside the txn so any
    // orphan in a child table (sessions/credit_transactions/shop_orders/
    // client_assignments) blocks the COMMIT instead of silently surviving.
    const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
    db.pragma('foreign_keys = OFF');
    let inTxn = false;
    try {
      const srcCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
      db.exec('BEGIN');
      inTxn = true;
      db.exec(`
        CREATE TABLE users__new (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          username         TEXT    UNIQUE NOT NULL,
          password         TEXT    NOT NULL,
          name             TEXT    DEFAULT '',
          family           TEXT    DEFAULT '',
          phone            TEXT    DEFAULT '',
          is_active        INTEGER DEFAULT 1,
          credits          REAL    NOT NULL DEFAULT 0 CHECK (credits >= 0),
          total_minutes    INTEGER NOT NULL DEFAULT 0 CHECK (total_minutes >= 0),
          total_spent      REAL    NOT NULL DEFAULT 0 CHECK (total_spent   >= 0),
          debt             REAL    NOT NULL DEFAULT 0 CHECK (debt          >= 0),
          debt_since       DATETIME,
          discount_percent REAL    DEFAULT 0,
          created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_login       DATETIME,
          limit_minutes    INTEGER DEFAULT 0,
          allowed_seats    INTEGER DEFAULT 1,
          post_pay         INTEGER DEFAULT 0,
          limit_time       INTEGER DEFAULT 0
        );
      `);
      db.exec(`
        INSERT INTO users__new (
          id, username, password, name, family, phone, is_active,
          credits, total_minutes, total_spent, debt, debt_since,
          discount_percent, created_at, last_login,
          limit_minutes, allowed_seats, post_pay, limit_time
        )
        SELECT
          id, username, password, name, family, phone, is_active,
          credits,
          COALESCE(total_minutes, 0),
          COALESCE(total_spent,   0),
          debt, debt_since,
          discount_percent, created_at, last_login,
          COALESCE(limit_minutes, 0),
          COALESCE(allowed_seats, 1),
          COALESCE(post_pay,      0),
          COALESCE(limit_time,    0)
        FROM users;
      `);
      const dstCount = db.prepare('SELECT COUNT(*) AS c FROM users__new').get().c;
      if (dstCount !== srcCount) {
        throw new Error(
          'users rebuild row-count mismatch: src=' + srcCount + ' dst=' + dstCount
        );
      }
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users__new RENAME TO users');
      const fkProblems = db.prepare('PRAGMA foreign_key_check').all();
      if (fkProblems.length) {
        throw new Error(
          'users rebuild produced FK orphans: ' + JSON.stringify(fkProblems)
        );
      }
      db.exec('COMMIT');
      inTxn = false;
      report.users_rebuilt = true;
      report.users_rebuilt_rows = dstCount;
    } catch (e) {
      if (inTxn) {
        try { db.exec('ROLLBACK'); } catch (_) { /* already rolled */ }
      }
      throw e;
    } finally {
      // Restore the prior FK state regardless of success/failure.
      if (fkWasOn) db.pragma('foreign_keys = ON');
    }
  }

  // ── S6. Settings ────────────────────────────────────────────────────
  const settingDefaults = [
    ['billing_engine_version',           '2'],
    ['billing_recovery_grace_seconds',   '120'],
    ['billing_kiosk_lockout_level',      'medium'],
    ['billing_clock_warp_tolerance_s',   '60'],
    // Phase 4 addition (piggybacks on Phase 2's idempotent settings
    // sweep). Maximum age in seconds for client:resume / boot recovery
    // young-session transition. Sessions whose last_billed_at is older
    // than this are no longer recoverable; resume returns
    // recovery_max_age_exceeded and boot sweep closes them as
    // boot_recovery_age. Default: 10 minutes.
    ['billing_resume_max_age_seconds',   '600'],
    // B2.1 — backup/restore engine settings. Daily snapshot at the
    // scheduled hour (default 04:00 local); 14 daily + 8 weekly
    // retention; min free disk ratio 2.0 (refuse if free < 2× DB size).
    // backup_dest_primary is relative to server/ directory. Operator
    // can set backup_dest_secondary to a USB / SMB / network path for
    // off-machine copies.
    ['backup_dest_primary',              './backups'],
    ['backup_dest_secondary',            ''],
    ['backup_schedule_hour',             '4'],
    ['backup_retention_daily',           '14'],
    ['backup_retention_weekly',          '8'],
    ['backup_min_free_disk_ratio',       '2.0'],
    ['backup_last_at',                   ''],
    ['backup_last_status',               ''],
    ['backup_last_size_bytes',           '0'],
    ['backup_last_path',                 ''],
    // B2.2 — crash reporter settings.
    ['crash_dump_dir',                   './crashes'],
    ['crash_dump_retention_count',       '50'],
    ['crash_report_upload_url',          ''],
  ];
  const upsert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of settingDefaults) {
    const r = upsert.run(k, v);
    if (r.changes === 1) report.settings_inserted.push(k);
  }

  // ── S7. Clock-warp boot probe ───────────────────────────────────────
  // Spec: refuse to start if now < MAX(credit_ledger.created_at) +
  // billing_clock_warp_tolerance_s. Catches both (a) restarting too
  // soon after a tick (in-flight write race) and (b) system clock
  // warped backward (would invalidate every credits/debt arithmetic
  // invariant going forward).
  //
  // At Phase 2 boot the ledger is empty → MAX() is NULL → probe skips.
  // The probe is "armed" from Phase 3 onward when tick rows begin.
  const lastEventRow = db.prepare(
    'SELECT MAX(created_at) AS t FROM credit_ledger'
  ).get();
  if (lastEventRow && lastEventRow.t) {
    const tolRow = db.prepare("SELECT value FROM settings WHERE key = 'billing_clock_warp_tolerance_s'").get();
    const toleranceS = Number((tolRow && tolRow.value) || 60);
    // SQLite stores naive DATETIME in UTC; Date.parse on "YYYY-MM-DD HH:MM:SS"
    // is browser-dependent. Force UTC interpretation by appending Z to the
    // ISO-ish form ("YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SSZ").
    const iso = String(lastEventRow.t).replace(' ', 'T') + 'Z';
    const lastMs = Date.parse(iso);
    if (!Number.isFinite(lastMs)) {
      throw new Error('clock-warp probe: unparseable MAX(credit_ledger.created_at) = ' + lastEventRow.t);
    }
    const nowMs = Date.now();
    const gapS = (nowMs - lastMs) / 1000;
    if (gapS < toleranceS) {
      throw new Error(
        'clock-warp probe: refusing to start. now is only ' + gapS.toFixed(1) +
        's after latest ledger event (' + lastEventRow.t + '); ' +
        'tolerance = ' + toleranceS + 's. ' +
        'Either wait ' + Math.ceil(toleranceS - gapS) + 's, or fix the system clock.'
      );
    }
    report.clock_warp_probe = 'ok (gap ' + gapS.toFixed(1) + 's >= ' + toleranceS + 's)';
  }

  report.completed_at = new Date().toISOString();

  const touched =
    report.sessions_columns_added.length +
    report.indexes_created.length +
    report.tables_created.length +
    report.triggers_created.filter(t => report.tables_created.includes('credit_ledger')).length +
    (report.users_rebuilt ? 1 : 0) +
    report.settings_inserted.length;
  if (touched > 0 || report.users_rebuilt) {
    console.log('🧱 [billing-schema-v2] applied — ' + JSON.stringify({
      sessions_columns_added: report.sessions_columns_added,
      indexes_created: report.indexes_created,
      tables_created: report.tables_created,
      users_rebuilt: report.users_rebuilt,
      users_rebuilt_rows: report.users_rebuilt_rows,
      settings_inserted: report.settings_inserted,
      clock_warp_probe: report.clock_warp_probe,
    }));
  } else {
    console.log('🧱 [billing-schema-v2] no-op (idempotent: schema already at v2)');
  }
  console.log('🛡  credit_ledger append-only triggers verified');

  return report;
}

/*
 * Phase 3 (C3A) — credit_transactions migration bridge.
 *
 * Three atomic DDLs wrapped in one IMMEDIATE transaction:
 *   1. ALTER TABLE credit_transactions RENAME TO credit_transactions__legacy
 *   2. CREATE VIEW credit_transactions AS legacy UNION ALL projected-ledger
 *   3. CREATE TRIGGER credit_transactions_insert_redirect INSTEAD OF INSERT
 *
 * All three operations are metadata-only — they touch sqlite_master rows,
 * not data pages. Wall time is < 50 ms regardless of legacy row count.
 *
 * Boot guard:
 *   • fresh (origTable present, others absent) → apply
 *   • migrated (all three of {legacy, view, trigger} present, origTable
 *     is a view not a table) → skip
 *   • partial (impossible with single-txn wrapping) → throw, refuse boot
 *
 * Returns { applied: bool, elapsed_ms?: number, reason?: string }.
 */
function applyBillingMigrationPhase3(db) {
  const probe = (type, name) => db.prepare(
    "SELECT name FROM sqlite_master WHERE type=? AND name=?"
  ).get(type, name);

  const has = {
    legacyTable: !!probe('table', 'credit_transactions__legacy'),
    view:        !!probe('view',  'credit_transactions'),
    trigger:     !!probe('trigger', 'credit_transactions_insert_redirect'),
    origTable:   !!probe('table', 'credit_transactions'),
  };

  // Fully migrated state.
  if (has.legacyTable && has.view && has.trigger && !has.origTable) {
    return { applied: false, reason: 'already_migrated' };
  }
  // Fresh state — apply.
  if (has.origTable && !has.legacyTable && !has.view && !has.trigger) {
    const t0 = Date.now();
    db.transaction(() => {
      db.exec("ALTER TABLE credit_transactions RENAME TO credit_transactions__legacy");
      db.exec(
        "CREATE VIEW credit_transactions AS "
        + "SELECT id, user_id, amount, type, description, created_at "
        + "  FROM credit_transactions__legacy "
        + "UNION ALL "
        + "SELECT "
        + "  -id AS id, "                                    // negative id namespace for ledger rows
        + "  user_id, "
        + "  CASE event_type "
        + "    WHEN 'recharge'       THEN amount_credits + (-amount_debt) "
        + "    WHEN 'tick'           THEN amount_credits "
        + "    WHEN 'shop'           THEN amount_credits "
        + "    WHEN 'debt_add'       THEN amount_debt "
        + "    WHEN 'debt_pay'       THEN amount_debt "
        + "    WHEN 'manual_credit'  THEN amount_credits "
        + "    WHEN 'manual_debit'   THEN amount_credits "
        + "    WHEN 'reconciliation' THEN amount_credits + amount_debt "
        + "  END AS amount, "
        + "  CASE event_type "
        + "    WHEN 'recharge'       THEN 'charge' "
        + "    WHEN 'tick'           THEN 'tick' "
        + "    WHEN 'shop'           THEN 'shop' "
        + "    WHEN 'debt_add'       THEN 'debt_add' "
        + "    WHEN 'debt_pay'       THEN 'debt_pay' "
        + "    WHEN 'manual_credit'  THEN 'free_gift' "
        + "    WHEN 'manual_debit'   THEN 'decharge' "
        + "    WHEN 'reconciliation' THEN 'reconciliation' "
        + "  END AS type, "
        + "  description, "
        + "  created_at "
        + "FROM credit_ledger"
      );
      db.exec(
        "CREATE TRIGGER credit_transactions_insert_redirect "
        + "INSTEAD OF INSERT ON credit_transactions "
        + "BEGIN "
        + "  INSERT INTO credit_transactions__legacy (user_id, amount, type, description, created_at) "
        + "  VALUES (NEW.user_id, NEW.amount, NEW.type, NEW.description, COALESCE(NEW.created_at, CURRENT_TIMESTAMP)); "
        + "END"
      );
    }).immediate();
    const elapsed_ms = Date.now() - t0;
    console.log('🌉 [billing-migration-phase3] applied in ' + elapsed_ms + 'ms');
    return { applied: true, elapsed_ms };
  }
  // Partial state — fail loud.
  throw new Error(
    'partial credit_transactions migration detected: ' + JSON.stringify(has)
    + ' — refusing to start. Investigate sqlite_master before retry.'
  );
}

/*
 * B2.2 — append-only crash_log table + triggers. Idempotent: creates
 * on first boot; verifies triggers on subsequent boots; throws if a
 * trigger was dropped out-of-band.
 */
function applyCrashLogSchema(db) {
  const tableRow = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='crash_log'"
  ).get();
  if (tableRow) {
    // Already exists — verify triggers + index.
    const wantTriggers = ['crash_log_no_update', 'crash_log_no_delete'];
    const haveTriggers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('crash_log_no_update','crash_log_no_delete')"
    ).all().map(r => r.name);
    const missing = wantTriggers.filter(t => !haveTriggers.includes(t));
    if (missing.length) {
      throw new Error(
        'crash_log append-only triggers missing: ' + missing.join(', ') + '. Refusing to start.'
      );
    }
    return { applied: false, reason: 'already_present' };
  }
  db.exec(
    "CREATE TABLE crash_log ("
    + "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
    + "  source TEXT NOT NULL CHECK (source IN ('server','client_main','client_renderer','client_native')),"
    + "  computer_name TEXT,"
    + "  version TEXT,"
    + "  message TEXT,"
    + "  stack TEXT,"
    + "  details TEXT,"
    + "  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
    + ");"
    + "CREATE INDEX idx_crash_log_time ON crash_log (created_at);"
    + "CREATE TRIGGER crash_log_no_update BEFORE UPDATE ON crash_log "
    + "BEGIN SELECT RAISE(ABORT, 'crash_log is append-only'); END;"
    + "CREATE TRIGGER crash_log_no_delete BEFORE DELETE ON crash_log "
    + "BEGIN SELECT RAISE(ABORT, 'crash_log is append-only'); END;"
  );
  console.log('💥 [crash-log-schema] applied');
  return { applied: true };
}

module.exports = { initDatabase, getDb, prepBillingMigration, applyBillingSchemaV2, applyBillingMigrationPhase3, applyCrashLogSchema };

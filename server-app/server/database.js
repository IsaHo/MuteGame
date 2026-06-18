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

    -- Append-only enforcement at the storage layer; mirrors server/database.js.
    -- The application never UPDATEs or DELETEs audit_log; these triggers stop
    -- a future bug or stray migration from doing so silently.
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

  // Boot-time integrity verification — refuses to start if the protective
  // triggers are missing.
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

  // Close any orphan sessions left open by a previous (crashed/killed) server run.
  // Without this, those rows have no end_time and the dashboard keeps showing
  // them as "in progress" indefinitely after the user has logged out.
  try {
    const orphan = db.prepare("UPDATE sessions SET end_time = CURRENT_TIMESTAMP WHERE end_time IS NULL").run();
    if (orphan.changes > 0) console.log(`🧹 Closed ${orphan.changes} orphan session(s) from previous run`);
  } catch (e) { console.error('orphan-cleanup:', e.message); }

  console.log('✅ Database ready');
}

module.exports = { initDatabase, getDb };

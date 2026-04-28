const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

let db;

function getDb() {
  return db;
}

function initDatabase() {
  db = new Database(path.join(__dirname, 'mutegame.db'));
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
  `);

  // Migrate existing tables
  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols.includes('name'))             db.exec("ALTER TABLE users ADD COLUMN name TEXT DEFAULT ''");
  if (!userCols.includes('family'))           db.exec("ALTER TABLE users ADD COLUMN family TEXT DEFAULT ''");
  if (!userCols.includes('phone'))            db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''");
  if (!userCols.includes('is_active'))        db.exec("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1");
  if (!userCols.includes('debt'))             db.exec("ALTER TABLE users ADD COLUMN debt REAL DEFAULT 0");
  if (!userCols.includes('debt_since'))       db.exec("ALTER TABLE users ADD COLUMN debt_since DATETIME");
  if (!userCols.includes('discount_percent')) db.exec("ALTER TABLE users ADD COLUMN discount_percent REAL DEFAULT 0");

  const shopCols = db.prepare("PRAGMA table_info(shop_items)").all().map(c => c.name);
  if (!shopCols.includes('buy_price')) db.exec("ALTER TABLE shop_items ADD COLUMN buy_price REAL DEFAULT 0");

  const orderCols = db.prepare("PRAGMA table_info(shop_orders)").all().map(c => c.name);
  if (!orderCols.includes('status')) db.exec("ALTER TABLE shop_orders ADD COLUMN status TEXT DEFAULT 'pending'");

  // Default settings
  const defaultSettings = [
    ['gaming_price_per_hour', '30000'],
    ['gaming_peak_multiplier', '1.5'],
    ['gaming_peak_start', '16'],
    ['gaming_peak_end', '24'],
    ['cafe_name', 'MuteGame'],
    ['cafe_address', ''],
    ['cafe_phone', ''],
    ['currency', 'ریال'],
    ['tier1_discount', '10'],
    ['tier2_discount', '5'],
    ['tier3_discount', '2'],
    ['bad_payer_days', '7'],
  ];
  const upsertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  defaultSettings.forEach(([k, v]) => upsertSetting.run(k, v));

  const adminExists = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run('admin', hash);
    console.log('✅ Default admin: admin / admin123');
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

  console.log('✅ Database ready');
}

module.exports = { initDatabase, getDb };

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = path.join(__dirname, '..', 'data');
export const backupsDir = path.join(dataDir, 'backups');
export const dbPath = path.join(dataDir, 'mt-billing.db');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

// If a restore was requested, apply the pending database file before opening
// the connection (safe: the live DB is never overwritten while it is open).
const pendingPath = `${dbPath}.pending`;
if (fs.existsSync(pendingPath)) {
  try {
    if (fs.existsSync(dbPath)) fs.renameSync(dbPath, path.join(backupsDir, `prerestore-${Date.now()}.db`));
    for (const ext of ['-wal', '-shm']) {
      const p = `${dbPath}${ext}`;
      if (fs.existsSync(p)) fs.rmSync(p);
    }
    fs.renameSync(pendingPath, dbPath);
  } catch {
    /* ignore and boot with existing db */
  }
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS routers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT,
      port INTEGER DEFAULT 8728,
      ssh_port INTEGER DEFAULT 22,
      api_user TEXT,
      api_pass TEXT,
      board TEXT,
      type TEXT DEFAULT 'pppoe',
      status TEXT DEFAULT 'online'
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rate_limit TEXT,
      price REAL DEFAULT 0,
      type TEXT DEFAULT 'pppoe'
    );

    CREATE TABLE IF NOT EXISTS pppoe_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      customer_name TEXT,
      account_number TEXT,
      profile TEXT,
      status TEXT DEFAULT 'Active',
      subscription_due TEXT,
      price REAL DEFAULT 0,
      router_id INTEGER,
      address TEXT,
      lat REAL,
      lng REAL,
      nap_id INTEGER,
      service TEXT DEFAULT 'pppoe',
      online INTEGER DEFAULT 1,
      password TEXT,
      expiration_profile TEXT DEFAULT 'default',
      contact TEXT,
      email TEXT,
      plc_port TEXT
    );

    CREATE TABLE IF NOT EXISTS naps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT DEFAULT 'nap',
      lat REAL,
      lng REAL,
      ports INTEGER DEFAULT 8,
      parent_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pppoe_user_id INTEGER,
      customer_name TEXT,
      amount REAL NOT NULL,
      type TEXT DEFAULT 'payment',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS queues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      avg_rate REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      sku TEXT,
      quantity INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      status TEXT DEFAULT 'In Stock'
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT DEFAULT 'info',
      source TEXT,
      message TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS company (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      currency TEXT DEFAULT 'PHP'
    );

    CREATE TABLE IF NOT EXISTS notify_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      reminder_enabled INTEGER DEFAULT 1,
      days_before INTEGER DEFAULT 3,
      email_enabled INTEGER DEFAULT 1,
      sms_enabled INTEGER DEFAULT 1,
      autodisable_enabled INTEGER DEFAULT 1,
      autodisable_hours INTEGER DEFAULT 24,
      email_from TEXT DEFAULT 'billing@pa-north.net',
      sms_sender TEXT DEFAULT 'PA-NORTH'
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      recipient TEXT,
      client_id INTEGER,
      customer_name TEXT,
      subject TEXT,
      message TEXT,
      type TEXT DEFAULT 'manual',
      status TEXT DEFAULT 'sent',
      detail TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      theme TEXT DEFAULT 'system',
      language TEXT DEFAULT 'en',
      currency TEXT DEFAULT 'PHP',
      ngrok_enabled INTEGER DEFAULT 0,
      ngrok_authtoken TEXT,
      ngrok_region TEXT DEFAULT 'ap',
      ngrok_port INTEGER DEFAULT 5173,
      ngrok_status TEXT DEFAULT 'stopped',
      ngrok_url TEXT,
      ai_provider TEXT DEFAULT 'anthropic',
      ai_api_key TEXT,
      ai_model TEXT DEFAULT 'claude-sonnet-4-20250514',
      ai_enabled INTEGER DEFAULT 0,
      cursor_api_key TEXT,
      cursor_model TEXT DEFAULT 'composer-2',
      cursor_repo_url TEXT,
      tz TEXT DEFAULT 'Asia/Manila',
      ntp_server TEXT DEFAULT 'time.cloudflare.com'
    );

    CREATE TABLE IF NOT EXISTS ai_scripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT,
      model TEXT,
      prompt TEXT,
      script TEXT,
      router_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function count(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

function columnExists(table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === col);
}

/** Idempotent migrations for databases created before a column existed. */
export function migrate() {
  if (!columnExists('pppoe_users', 'online')) {
    db.exec('ALTER TABLE pppoe_users ADD COLUMN online INTEGER DEFAULT 1');
    setOnlineStates();
  }
  const addCols: [string, string][] = [
    ['password', 'TEXT'],
    ['expiration_profile', "TEXT DEFAULT 'default'"],
    ['contact', 'TEXT'],
    ['email', 'TEXT'],
    ['plc_port', 'TEXT'],
    ['nonpayment_since', 'TEXT'],
    ['reminder_sent', 'TEXT'],
    ['expire_applied', 'TEXT'],
  ];
  for (const [col, type] of addCols) {
    if (!columnExists('pppoe_users', col)) {
      db.exec(`ALTER TABLE pppoe_users ADD COLUMN ${col} ${type}`);
    }
  }
  ensureBillingPlans();
  ensureNotifySettings();

  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pppoe_servers'").get()) {
    db.exec(`
      CREATE TABLE pppoe_servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        router_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        interface_name TEXT,
        max_sessions INTEGER,
        service TEXT DEFAULT 'pppoe',
        authentication TEXT,
        status TEXT DEFAULT 'running'
      );
    `);
  }

  // Gateway configuration columns (added over time).
  const notifyCols: [string, string][] = [
    ['smtp_host', 'TEXT'],
    ['smtp_port', 'INTEGER DEFAULT 587'],
    ['smtp_secure', 'INTEGER DEFAULT 0'],
    ['smtp_user', 'TEXT'],
    ['smtp_pass', 'TEXT'],
    ['smtp_from', 'TEXT'],
    ['sms_api_url', "TEXT DEFAULT 'https://smtpapi.vocotext.com/isms_send_all_id.php'"],
    ['sms_api_user', 'TEXT'],
    ['sms_api_pass', 'TEXT'],
    ['sms_type', 'INTEGER DEFAULT 1'],
  ];
  for (const [col, type] of notifyCols) {
    if (!columnExists('notify_settings', col)) db.exec(`ALTER TABLE notify_settings ADD COLUMN ${col} ${type}`);
  }
  if (!columnExists('company', 'logo')) db.exec('ALTER TABLE company ADD COLUMN logo TEXT');

  if (count('app_settings') === 0) {
    db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  }

  const appCols: [string, string][] = [
    ['cursor_api_key', 'TEXT'],
    ['cursor_model', "TEXT DEFAULT 'composer-2'"],
    ['cursor_repo_url', 'TEXT'],
  ];
  for (const [col, type] of appCols) {
    if (!columnExists('app_settings', col)) db.exec(`ALTER TABLE app_settings ADD COLUMN ${col} ${type}`);
  }
  if (!columnExists('routers', 'ssh_port')) {
    db.exec('ALTER TABLE routers ADD COLUMN ssh_port INTEGER DEFAULT 22');
  }

  db.prepare("UPDATE naps SET name = 'OLT Main Server' WHERE kind = 'olt' AND name = 'OLT-1'").run();
}

/** Single-row notification settings, created with sensible defaults. */
function ensureNotifySettings() {
  if (count('notify_settings') === 0) {
    db.prepare(
      `INSERT INTO notify_settings
        (id, reminder_enabled, days_before, email_enabled, sms_enabled, autodisable_enabled, autodisable_hours, email_from, sms_sender)
       VALUES (1, 1, 3, 1, 1, 1, 24, 'billing@pa-north.net', 'PA-NORTH')`
    ).run();
  }
}

/** Ensure the UNLI billing plans referenced by the Add-User template exist. */
function ensureBillingPlans() {
  const plans: [string, string, number][] = [
    ['UNLI500', '30M/30M', 500],
    ['UNLI700', '50M/50M', 700],
    ['UNLI1000', '100M/100M', 1000],
  ];
  const has = db.prepare('SELECT 1 FROM profiles WHERE name = ?');
  const ins = db.prepare('INSERT INTO profiles (name, rate_limit, price, type) VALUES (?, ?, ?, ?)');
  for (const [name, rate, price] of plans) {
    if (!has.get(name)) ins.run(name, rate, price, 'pppoe');
  }
}

/** Derive a realistic ONU online/offline state from subscriber status. */
function setOnlineStates() {
  db.exec("UPDATE pppoe_users SET online = 0 WHERE status != 'Active'");
  db.exec("UPDATE pppoe_users SET online = CASE WHEN (id % 7 = 0) THEN 0 ELSE 1 END WHERE status = 'Active'");
}

const FIRST = ['Jonathan', 'Licerio', 'Lizel', 'Johnny', 'Magno', 'Gino', 'Leony', 'Lito', 'Denver', 'Eric', 'Lisa', 'Adela', 'Bernardo', 'Vic', 'Lucille', 'Glaiza', 'Marlon', 'Rowena', 'Ferdinand', 'Cristina', 'Ramon', 'Teresita', 'Danilo', 'Marites', 'Rodel', 'Jocelyn', 'Arnel', 'Editha', 'Reynaldo', 'Marilou'];
const LAST = ['Castillano', 'Anonuevo', 'Cortina', 'Malabanan', 'Tanglang', 'Agapito', 'Badal', 'Aday', 'Reyes', 'Cabrera', 'Nohay', 'Desepeda', 'Grajo', 'Santos', 'Delacruz', 'Ramirez', 'Mercado', 'Villanueva', 'Aquino', 'Bautista', 'Gonzales', 'Torres', 'Flores', 'Rivera', 'Navarro'];
const PROFILES = [
  { name: '15mbps', rate: '15M/15M', price: 999 },
  { name: '25mbps', rate: '25M/25M', price: 1299 },
  { name: '50mbps', rate: '50M/50M', price: 1699 },
  { name: 'non-payments', rate: '1M/1M', price: 0 },
];

function pad(n: number, len: number) {
  return String(n).padStart(len, '0');
}

export function seed() {
  // Admin user
  if (count('users') === 0) {
    const user = process.env.ADMIN_USER || 'admin';
    const pass = process.env.ADMIN_PASS || 'admin123';
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      user,
      bcrypt.hashSync(pass, 10),
      'superadmin'
    );
  }

  if (count('company') === 0) {
    db.prepare('INSERT INTO company (id, name, address, phone, email, currency) VALUES (1, ?, ?, ?, ?, ?)').run(
      'Pa-North Fiber Internet',
      'Santa Cruz, North District',
      '+63 900 000 0000',
      'support@pa-north.net',
      'PHP'
    );
  }

  if (count('routers') === 0) {
    db.prepare('INSERT INTO routers (name, host, port, board, type, status) VALUES (?, ?, ?, ?, ?, ?)').run(
      'PPPoE MT Router', '192.168.88.1', 8728, 'x86 YANLING YL-CLU6L-V1', 'pppoe', 'online'
    );
    db.prepare('INSERT INTO routers (name, host, port, board, type, status) VALUES (?, ?, ?, ?, ?, ?)').run(
      'IPoE MT Router', '192.168.89.1', 8728, 'RB5009UG+S+IN', 'ipoe', 'online'
    );
  }

  if (count('profiles') === 0) {
    const ins = db.prepare('INSERT INTO profiles (name, rate_limit, price, type) VALUES (?, ?, ?, ?)');
    for (const p of PROFILES) ins.run(p.name, p.rate, p.price, 'pppoe');
  }

  // NAPs and OLT
  if (count('naps') === 0) {
    const baseLat = 15.1785;
    const baseLng = 120.5945;
    const insNap = db.prepare('INSERT INTO naps (name, kind, lat, lng, ports, parent_id) VALUES (?, ?, ?, ?, ?, ?)');
    const oltId = insNap.run('OLT Main Server', 'olt', baseLat, baseLng, 128, null).lastInsertRowid as number;
    for (let i = 1; i <= 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      const radius = 0.006 + (i % 4) * 0.0018;
      const lat = baseLat + Math.sin(angle) * radius;
      const lng = baseLng + Math.cos(angle) * radius * 1.3;
      insNap.run(`NAP${i}`, 'nap', lat, lng, 8, oltId);
    }
  }

  // PPPoE users
  if (count('pppoe_users') === 0) {
    const naps = db.prepare("SELECT id, lat, lng FROM naps WHERE kind = 'nap'").all() as { id: number; lat: number; lng: number }[];
    const ins = db.prepare(`INSERT INTO pppoe_users
      (username, customer_name, account_number, profile, status, subscription_due, price, router_id, address, lat, lng, nap_id, service)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let n = 0;
    const total = 72;
    for (let i = 0; i < total; i++) {
      const first = FIRST[i % FIRST.length];
      const last = LAST[(i * 3) % LAST.length];
      const customer = `${first} ${last}`;
      const username = `${first}${last}`;
      const account = `${pad(Math.floor(Math.random() * 900000) + 100000, 6)}${pad(Math.floor(Math.random() * 900000) + 100000, 6)}`;
      let profile: string, status: string, price: number;
      if (i < 6) {
        profile = 'non-payments'; status = 'inactive'; price = 0;
      } else {
        const p = PROFILES[i % 3];
        profile = p.name; price = p.price;
        status = i % 11 === 0 ? 'expired' : 'Active';
      }
      const due = new Date();
      due.setDate(due.getDate() + ((i % 30) - 5));
      const nap = naps[i % naps.length];
      const jitterLat = (Math.random() - 0.5) * 0.0016;
      const jitterLng = (Math.random() - 0.5) * 0.0016;
      const hasLocation = i % 15 !== 0; // ~5 without location, like screenshot
      ins.run(
        username, customer, account, profile, status,
        due.toISOString().slice(0, 10), price, 1,
        `Purok ${1 + (i % 7)}, North District`,
        hasLocation ? nap.lat + jitterLat : null,
        hasLocation ? nap.lng + jitterLng : null,
        nap.id, 'pppoe'
      );
      n++;
    }

    // A few IPoE users on router 2
    for (let i = 0; i < 12; i++) {
      const first = FIRST[(i + 5) % FIRST.length];
      const last = LAST[(i + 2) % LAST.length];
      const nap = naps[i % naps.length];
      ins.run(
        `${first}${last}IP`, `${first} ${last}`, `${pad(400000 + i, 6)}${pad(100000 + i, 6)}`,
        '25mbps', 'Active', new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
        1299, 2, `Purok ${1 + (i % 7)}, North District`,
        nap.lat + 0.0005, nap.lng + 0.0005, nap.id, 'ipoe'
      );
    }

    setOnlineStates();
  }

  // Transactions for the last 7 days (shaped like screenshot peak at day 3)
  if (count('transactions') === 0) {
    const shape = [0, 800, 2100, 27100, 0, 0, 0]; // recent 7 days, index 0 = 6 days ago
    const ins = db.prepare('INSERT INTO transactions (customer_name, amount, type, created_at) VALUES (?, ?, ?, ?)');
    for (let d = 0; d < 7; d++) {
      const day = new Date();
      day.setDate(day.getDate() - (6 - d));
      let remaining = shape[d];
      let guard = 0;
      while (remaining > 0 && guard < 40) {
        const amt = Math.min(remaining, [999, 1299, 1699][guard % 3]);
        const cust = `${FIRST[guard % FIRST.length]} ${LAST[guard % LAST.length]}`;
        ins.run(cust, amt, 'payment', day.toISOString());
        remaining -= amt;
        guard++;
      }
    }
    // add older history for month/year views
    for (let m = 1; m < 60; m++) {
      const day = new Date();
      day.setDate(day.getDate() - m * 3);
      const cust = `${FIRST[m % FIRST.length]} ${LAST[m % LAST.length]}`;
      ins.run(cust, [999, 1299, 1699][m % 3], 'payment', day.toISOString());
    }
  }

  if (count('queues') === 0) {
    const q = db.prepare('INSERT INTO queues (name, avg_rate) VALUES (?, ?)');
    const rows: [string, number][] = [
      ['Downstream 2024', 40.94],
      ['Roblox PC', 30.08],
      ['t. Total Download', 8.61],
      ['Streaming Connections Down', 7.42],
      ['Point Blank', 2.18],
      ['Downloading Connections Down', 0.894],
      ['Browsing Connections Down', 0.158],
    ];
    for (const r of rows) q.run(r[0], r[1]);
  }

  if (count('inventory') === 0) {
    const ins = db.prepare('INSERT INTO inventory (name, category, sku, quantity, unit_price, status) VALUES (?, ?, ?, ?, ?, ?)');
    const items: [string, string, string, number, number, string][] = [
      ['Huawei ONT HG8145V5', 'ONU/ONT', 'ONT-HG8145', 42, 850, 'In Stock'],
      ['Fiber Drop Cable 1F (300m)', 'Cable', 'FDC-1F-300', 15, 2100, 'In Stock'],
      ['SC/APC Fast Connector', 'Connector', 'SCAPC-FC', 320, 25, 'In Stock'],
      ['NAP Box 1x8 PLC Splitter', 'Splitter', 'NAP-8-PLC', 6, 1200, 'Low Stock'],
      ['MikroTik hAP ax3', 'Router', 'MT-HAPAX3', 3, 4500, 'Low Stock'],
      ['Pole Bracket Clamp', 'Accessory', 'PBC-01', 0, 45, 'Out of Stock'],
    ];
    for (const it of items) ins.run(...it);
  }

  if (count('logs') === 0) {
    const ins = db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)');
    ins.run('info', 'system', 'MT-Billing panel started');
    ins.run('info', 'pppoe', 'Synced 72 PPPoE secrets from PPPoE MT Router');
    ins.run('warning', 'router', 'IPoE MT Router API latency high (240ms)');
    ins.run('info', 'billing', 'Generated 54 invoices for the current cycle');
  }
}

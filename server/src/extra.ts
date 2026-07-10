import express from 'express';
import os from 'os';
import crypto from 'crypto';
import { db } from './db.js';

export const extraRouter = express.Router();

// Shared license signing secret (vendor-side). The standalone activator script
// uses the same value + algorithm to generate keys from a hardware ID.
const LICENSE_SECRET = 'MT-BILLING-LICENSE-2026';

function columnExists(table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === col);
}

export function initExtra() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      plan TEXT,
      price REAL DEFAULT 0,
      speed TEXT,
      validity TEXT,
      status TEXT DEFAULT 'unused',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      permissions TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS wan_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gateway TEXT NOT NULL,
      check_method TEXT DEFAULT 'ping',
      distance INTEGER DEFAULT 1,
      status TEXT DEFAULT 'Active',
      enabled INTEGER DEFAULT 1
    );
  `);

  for (const [col, type] of [['license_key', 'TEXT'], ['license_activated', 'INTEGER DEFAULT 0']] as [string, string][]) {
    if (!columnExists('app_settings', col)) db.exec(`ALTER TABLE app_settings ADD COLUMN ${col} ${type}`);
  }

  if ((db.prepare('SELECT COUNT(*) AS c FROM wan_routes').get() as any).c === 0) {
    const ins = db.prepare('INSERT INTO wan_routes (gateway, check_method, distance, status, enabled) VALUES (?, ?, ?, ?, 1)');
    ins.run('8.8.8.8', 'ping', 1, 'Active');
    ins.run('50.50.60.1', 'ping', 1, 'Active');
    ins.run('192.168.59.1', 'ping', 1, 'Active');
  }

  if ((db.prepare('SELECT COUNT(*) AS c FROM roles').get() as any).c === 0) {
    const ins = db.prepare('INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)');
    ins.run('Administrator', 'Full access to all panel features', JSON.stringify(['*']));
    ins.run('Technician', 'Manage clients, routers and network', JSON.stringify(['pppoe', 'ipoe', 'routers', 'network', 'map']));
    ins.run('Cashier', 'Billing and payments only', JSON.stringify(['pppoe', 'sales', 'notifications']));
    ins.run('Read-only', 'View dashboards and reports', JSON.stringify(['dashboard', 'sales', 'map']));
  }
}

// ---------------- Network ----------------
extraRouter.get('/network/wan', (_req, res) => {
  res.json(db.prepare('SELECT id, gateway, check_method AS checkMethod, distance, status, enabled FROM wan_routes ORDER BY id').all());
});
extraRouter.post('/network/wan/:id/toggle', (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('SELECT enabled FROM wan_routes WHERE id = ?').get(id) as any;
  if (!r) return res.status(404).json({ error: 'not found' });
  const enabled = r.enabled ? 0 : 1;
  db.prepare('UPDATE wan_routes SET enabled = ?, status = ? WHERE id = ?').run(enabled, enabled ? 'Active' : 'Disabled', id);
  res.json({ ok: true, enabled });
});
extraRouter.post('/network/wan/toggle-all', (req, res) => {
  const enabled = req.body?.enabled ? 1 : 0;
  db.prepare('UPDATE wan_routes SET enabled = ?, status = ?').run(enabled, enabled ? 'Active' : 'Disabled');
  res.json({ ok: true, enabled });
});
extraRouter.get('/network/firewall', (_req, res) => {
  res.json([
    { chain: 'input', action: 'accept', proto: 'tcp', dstPort: '8291,8728', comment: 'Winbox/API', enabled: true },
    { chain: 'input', action: 'drop', proto: 'tcp', dstPort: '23', comment: 'Block telnet', enabled: true },
    { chain: 'forward', action: 'accept', proto: 'all', dstPort: '-', comment: 'LAN to WAN', enabled: true },
    { chain: 'srcnat', action: 'masquerade', proto: 'all', dstPort: '-', comment: 'NAT out', enabled: true },
    { chain: 'input', action: 'drop', proto: 'all', dstPort: '-', comment: 'Drop all else', enabled: true },
  ]);
});
extraRouter.get('/network/routes', (_req, res) => {
  res.json({
    routes: [
      { dst: '0.0.0.0/0', gateway: '8.8.8.8', distance: 1, active: true },
      { dst: '10.20.0.0/16', gateway: 'bridge-LAN', distance: 0, active: true },
      { dst: '50.50.60.0/24', gateway: 'ether1', distance: 1, active: true },
    ],
    vlans: [
      { name: 'vlan10-mgmt', vlanId: 10, iface: 'ether2', comment: 'Management' },
      { name: 'vlan20-pppoe', vlanId: 20, iface: 'ether3', comment: 'PPPoE access' },
      { name: 'vlan30-hotspot', vlanId: 30, iface: 'ether4', comment: 'Hotspot' },
    ],
  });
});
extraRouter.get('/network/multiwan', (_req, res) => {
  res.json({
    enabled: true,
    strategy: 'AI load-balance (PCC + latency aware)',
    links: [
      { name: 'ISP-PFSENSE-MAIN', role: 'primary', weight: 60, latencyMs: 12, loss: 0, status: 'up' },
      { name: 'WAN_BACKUP_SERVER', role: 'backup', weight: 30, latencyMs: 34, loss: 0, status: 'up' },
      { name: 'LTE-Failover', role: 'failover', weight: 10, latencyMs: 78, loss: 1.2, status: 'standby' },
    ],
  });
});

// ---------------- Inventory CRUD ----------------
extraRouter.post('/inventory', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare('INSERT INTO inventory (name, category, sku, quantity, unit_price, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(b.name, b.category || null, b.sku || null, Number(b.quantity) || 0, Number(b.unit_price) || 0, b.status || 'In Stock');
  res.status(201).json(db.prepare('SELECT * FROM inventory WHERE id = ?').get(info.lastInsertRowid));
});
extraRouter.put('/inventory/:id', (req, res) => {
  const id = Number(req.params.id);
  const ex = db.prepare('SELECT * FROM inventory WHERE id = ?').get(id) as any;
  if (!ex) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const quantity = b.quantity != null ? Number(b.quantity) : ex.quantity;
  const autoStatus = quantity <= 0 ? 'Out of Stock' : quantity <= 5 ? 'Low Stock' : 'In Stock';
  db.prepare('UPDATE inventory SET name=?, category=?, sku=?, quantity=?, unit_price=?, status=? WHERE id=?').run(
    b.name ?? ex.name,
    b.category ?? ex.category,
    b.sku ?? ex.sku,
    quantity,
    b.unit_price != null ? Number(b.unit_price) : ex.unit_price,
    b.status || autoStatus,
    id
  );
  res.json(db.prepare('SELECT * FROM inventory WHERE id = ?').get(id));
});
extraRouter.delete('/inventory/:id', (req, res) => {
  db.prepare('DELETE FROM inventory WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------------- Hotspot vouchers ----------------
const VOUCHER_PLANS: Record<string, { price: number; speed: string; validity: string }> = {
  '1 Hour': { price: 5, speed: '5M/5M', validity: '1h' },
  '1 Day': { price: 20, speed: '10M/10M', validity: '1d' },
  '1 Week': { price: 100, speed: '10M/10M', validity: '7d' },
  '30 Days': { price: 350, speed: '15M/15M', validity: '30d' },
};
extraRouter.get('/hotspot/vouchers', (_req, res) => {
  res.json(db.prepare('SELECT id, code, plan, price, speed, validity, status, created_at AS createdAt, used_at AS usedAt FROM vouchers ORDER BY id DESC LIMIT 500').all());
});
extraRouter.post('/hotspot/vouchers/generate', (req, res) => {
  const plan = String(req.body?.plan || '1 Day');
  const count = Math.min(200, Math.max(1, Math.floor(Number(req.body?.count) || 1)));
  const p = VOUCHER_PLANS[plan] || VOUCHER_PLANS['1 Day'];
  const ins = db.prepare('INSERT INTO vouchers (code, plan, price, speed, validity, status) VALUES (?, ?, ?, ?, ?, ?)');
  const created: string[] = [];
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      let code = '';
      for (let a = 0; a < 3; a++) {
        code = Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('') +
          '-' + Math.floor(1000 + Math.random() * 9000);
        try {
          ins.run(code, plan, p.price, p.speed, p.validity, 'unused');
          created.push(code);
          break;
        } catch {
          /* code collision, retry */
        }
      }
    }
  });
  tx();
  res.json({ ok: true, count: created.length, plan });
});
extraRouter.delete('/hotspot/vouchers/:id', (req, res) => {
  db.prepare('DELETE FROM vouchers WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------------- ZeroTier ----------------
extraRouter.get('/zerotier', (_req, res) => {
  res.json({
    online: true,
    address: '8056c2e21c',
    networks: [
      {
        id: '8056c2e21c000001',
        name: 'pa-north-core',
        status: 'OK',
        assignedIp: '10.147.20.5',
        members: [
          { name: 'panel-host', ip: '10.147.20.5', authorized: true, online: true },
          { name: 'olt-main', ip: '10.147.20.6', authorized: true, online: true },
          { name: 'tech-laptop', ip: '10.147.20.11', authorized: true, online: false },
        ],
      },
    ],
  });
});

// ---------------- Updater ----------------
extraRouter.get('/updater', (_req, res) => {
  res.json({
    current: '1.0 Beta 2',
    latest: '1.0 Beta 3',
    updateAvailable: true,
    changelog: [
      'Added uptime monitoring and live interface traffic graphs',
      'Email/SMS reminders with auto-disable on non-payment',
      'Clients map ONU status, payments, and system settings',
    ],
    lastChecked: new Date().toISOString(),
  });
});
extraRouter.post('/updater/check', (_req, res) => {
  res.json({ updateAvailable: true, latest: '1.0 Beta 3', lastChecked: new Date().toISOString() });
});
extraRouter.post('/updater/apply', (_req, res) => {
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run('info', 'updater', 'Update to 1.0 Beta 3 started');
  res.json({ ok: true, message: 'Update queued. The panel will restart after applying.' });
});

// ---------------- Panel Roles ----------------
extraRouter.get('/roles', (_req, res) => {
  const rows = db.prepare('SELECT id, name, description, permissions FROM roles ORDER BY id').all() as any[];
  rows.forEach((r) => {
    try {
      r.permissions = JSON.parse(r.permissions || '[]');
    } catch {
      r.permissions = [];
    }
  });
  res.json(rows);
});
extraRouter.post('/roles', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare('INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)')
    .run(b.name, b.description || null, JSON.stringify(b.permissions || []));
  res.status(201).json({ id: info.lastInsertRowid });
});
extraRouter.put('/roles/:id', (req, res) => {
  const id = Number(req.params.id);
  const ex = db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
  if (!ex) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  db.prepare('UPDATE roles SET name=?, description=?, permissions=? WHERE id=?').run(
    b.name ?? ex.name,
    b.description ?? ex.description,
    JSON.stringify(b.permissions != null ? b.permissions : JSON.parse(ex.permissions || '[]')),
    id
  );
  res.json({ ok: true });
});
extraRouter.delete('/roles/:id', (req, res) => {
  db.prepare('DELETE FROM roles WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------------- Log Viewer ----------------
extraRouter.get('/logs/router', (req, res) => {
  const r = db.prepare('SELECT id, name FROM routers WHERE id = ?').get(Number(req.query.routerId)) as any;
  const name = r?.name || 'Router';
  const cycle = [
    { topic: 'sstp,ppp,info', message: 'RemoteInboxVPN%v: disconnected' },
    { topic: 'sstp,ppp,info', message: 'RemoteInboxVPN%v: terminating... - failed to authenticate ourselves to peer' },
    { topic: 'sstp,ppp,info', message: 'RemoteInboxVPN%v: connecting...' },
    { topic: 'sstp,ppp,info', message: 'RemoteInboxVPN%v: initializing...' },
    { topic: 'pppoe,info', message: 'pppoe-in: authenticated' },
    { topic: 'system,info,account', message: 'user admin logged in via api' },
    { topic: 'dhcp,info', message: 'dhcp-lan assigned 10.20.0.14 to A4:2B:11:22:33:44' },
  ];
  const now = Date.now();
  const entries = Array.from({ length: 60 }, (_, i) => {
    const c = cycle[i % cycle.length];
    return { time: new Date(now - i * 10000).toISOString(), topic: c.topic, message: c.message };
  });
  res.json({ router: name, entries });
});

extraRouter.get('/logs/panel', (req, res) => {
  const proc = String(req.query.process) === 'api' ? 'mikrotik-api-backend' : 'mikrotik-manager';
  const dbName = proc.includes('api') ? 'superadmin database' : 'panel database';
  const lines = [`[TAILING] Tailing last 150 lines for [${proc}] process (change the value with --lines option)`, `[LOG] /root/.pm2/logs/${proc}-out.log last 150 lines:`];
  for (let i = 0; i < 150; i++) lines.push(`[mikrotik] | Connected to the ${dbName}.`);
  res.json({ process: proc, text: lines.join('\n') });
});

extraRouter.get('/logs/nginx', (_req, res) => {
  const paths = ['/', '/api/dashboard/host', '/api/pppoe/users?service=pppoe', '/api/map', '/api/sales?group=month', '/api/uptime'];
  const now = Date.now();
  const lines = Array.from({ length: 80 }, (_, i) => {
    const t = new Date(now - i * 3000).toUTCString();
    const p = paths[i % paths.length];
    return `172.30.0.1 - - [${t}] "GET ${p} HTTP/1.1" 200 ${180 + ((i * 37) % 900)} "-" "Mozilla/5.0"`;
  });
  res.json({ text: lines.join('\n') });
});

extraRouter.get('/logs/email', (req, res) => {
  const cat = String(req.query.category || 'payment');
  let where = "channel = 'email'";
  if (cat === 'payment') where += " AND (subject LIKE '%Payment%' OR subject LIKE '%Receipt%')";
  else if (cat === 'reminder') where += " AND (type = 'expiry_reminder' OR subject LIKE '%Reminder%' OR subject LIKE '%expire%')";
  else where += " AND type = 'manual' AND subject NOT LIKE '%Payment%' AND subject NOT LIKE '%Receipt%' AND subject NOT LIKE '%Reminder%'";
  const rows = db
    .prepare(`SELECT id, recipient, customer_name AS customer, subject, message, status, detail, created_at AS date FROM notifications WHERE ${where} ORDER BY id DESC LIMIT 200`)
    .all();
  res.json(rows);
});

// ---------------- License ----------------
function hardwareId(): string {
  const nets = os.networkInterfaces();
  let mac = '';
  for (const key of Object.keys(nets)) {
    for (const ni of nets[key] || []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') {
        mac = ni.mac;
        break;
      }
    }
    if (mac) break;
  }
  const cpu = os.cpus()[0]?.model || 'cpu';
  const raw = [os.hostname(), mac, os.arch(), os.platform(), cpu].join('|');
  const h = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}`;
}
export function expectedKeyFor(hwid: string): string {
  const h = crypto.createHmac('sha256', LICENSE_SECRET).update(hwid).digest('hex').toUpperCase();
  return `${h.slice(0, 5)}-${h.slice(5, 10)}-${h.slice(10, 15)}-${h.slice(15, 20)}`;
}
function normalizeKey(k: string): string {
  return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
extraRouter.get('/license', (_req, res) => {
  const s = db.prepare('SELECT license_activated, license_key FROM app_settings WHERE id = 1').get() as any;
  const hwid = hardwareId();
  res.json({
    hardwareId: hwid,
    activated: !!s?.license_activated,
    licenseKey: s?.license_activated ? s.license_key : null,
    product: 'MT-Billing',
    edition: s?.license_activated ? 'Licensed' : 'Unlicensed (trial)',
  });
});
extraRouter.post('/license/activate', (req, res) => {
  const hwid = hardwareId();
  const provided = normalizeKey(req.body?.key);
  const expected = normalizeKey(expectedKeyFor(hwid));
  if (!provided) return res.status(400).json({ error: 'license key is required' });
  if (provided !== expected) {
    db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run('warning', 'license', 'Invalid license activation attempt');
    return res.status(400).json({ error: 'Invalid license key for this hardware ID.' });
  }
  db.prepare('UPDATE app_settings SET license_activated = 1, license_key = ? WHERE id = 1').run(expectedKeyFor(hwid));
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run('info', 'license', 'License activated');
  res.json({ ok: true, activated: true, licenseKey: expectedKeyFor(hwid) });
});
extraRouter.post('/license/deactivate', (_req, res) => {
  db.prepare('UPDATE app_settings SET license_activated = 0, license_key = NULL WHERE id = 1').run();
  res.json({ ok: true, activated: false });
});

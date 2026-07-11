import express from 'express';
import { db } from './db.js';
import { panelHardwareId, expectedLicenseKey, normalizeCode } from './panelId.js';
import { fetchWanRoutes, setRouteEnabled } from './mikrotik.js';

export const extraRouter = express.Router();

// Shared license / password-reset signing secrets live in panelId.ts.
// Vendor tools: activator/activator.cjs (unified) and server/scripts/*-activator.mjs
// must use the same normalizeCode + HMAC algorithms.

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
      router_id INTEGER,
      router_name TEXT,
      gateway TEXT NOT NULL,
      check_method TEXT DEFAULT 'ping',
      distance INTEGER DEFAULT 1,
      status TEXT DEFAULT 'Active',
      enabled INTEGER DEFAULT 1,
      interface_name TEXT,
      dst_address TEXT DEFAULT '0.0.0.0/0',
      route_id TEXT
    );
    CREATE TABLE IF NOT EXISTS map_connectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      points TEXT NOT NULL,
      UNIQUE(kind, from_id, to_id)
    );
  `);

  for (const [col, type] of [
    ['router_id', 'INTEGER'],
    ['router_name', 'TEXT'],
    ['interface_name', 'TEXT'],
    ['dst_address', "TEXT DEFAULT '0.0.0.0/0'"],
    ['route_id', 'TEXT'],
  ] as [string, string][]) {
    if (!columnExists('wan_routes', col)) db.exec(`ALTER TABLE wan_routes ADD COLUMN ${col} ${type}`);
  }

  // Drop stale sample WAN routes that were never synced from a live router.
  db.prepare("DELETE FROM wan_routes WHERE route_id IS NULL OR route_id = ''").run();

  for (const [col, type] of [
    ['license_key', 'TEXT'],
    ['license_activated', 'INTEGER DEFAULT 0'],
    ['zerotier_api_token', 'TEXT'],
    ['zerotier_network_id', 'TEXT'],
    ['zerotier_node_name', 'TEXT'],
  ] as [string, string][]) {
    if (!columnExists('app_settings', col)) db.exec(`ALTER TABLE app_settings ADD COLUMN ${col} ${type}`);
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
async function syncWanRoutesFromRouters() {
  const routers = db.prepare('SELECT * FROM routers').all() as any[];
  const collected: {
    router_id: number;
    router_name: string;
    route_id: string;
    gateway: string;
    check_method: string;
    distance: number;
    status: string;
    enabled: number;
    interface_name: string | null;
    dst_address: string;
  }[] = [];

  for (const r of routers) {
    if (!r.host || !r.api_user) continue;
    try {
      const routes = await fetchWanRoutes(r);
      for (const route of routes) {
        collected.push({
          router_id: r.id,
          router_name: r.name,
          route_id: route.routeId,
          gateway: route.gateway,
          check_method: route.checkMethod,
          distance: route.distance,
          status: route.status,
          enabled: route.enabled ? 1 : 0,
          interface_name: route.interfaceName,
          dst_address: route.dstAddress,
        });
      }
    } catch {
      /* router unreachable */
    }
  }

  if (collected.length === 0) {
    db.prepare('DELETE FROM wan_routes').run();
    return false;
  }

  db.prepare('DELETE FROM wan_routes').run();
  const ins = db.prepare(
    `INSERT INTO wan_routes (router_id, router_name, route_id, gateway, check_method, distance, status, enabled, interface_name, dst_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of collected) {
    ins.run(
      row.router_id,
      row.router_name,
      row.route_id,
      row.gateway,
      row.check_method,
      row.distance,
      row.status,
      row.enabled,
      row.interface_name,
      row.dst_address
    );
  }
  return true;
}

function getRouterConn(routerId: number) {
  return db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
}

extraRouter.get('/network/wan', async (_req, res) => {
  const live = await syncWanRoutesFromRouters();
  const routes = live
    ? (db
        .prepare(
          `SELECT id, router_id AS routerId, router_name AS routerName, gateway,
                  check_method AS checkMethod, distance, status, enabled,
                  interface_name AS interfaceName, dst_address AS dstAddress
           FROM wan_routes WHERE route_id IS NOT NULL ORDER BY router_name, distance, id`
        )
        .all() as any[])
    : [];
  res.json({ routes, live });
});
extraRouter.post('/network/wan/:id/toggle', async (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare('SELECT id, router_id, route_id, gateway, enabled FROM wan_routes WHERE id = ?')
    .get(id) as any;
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!row.route_id) return res.status(400).json({ error: 'Route is not linked to a live MikroTik route. Refresh the WAN list.' });

  const router = getRouterConn(row.router_id);
  if (!router?.host || !router?.api_user) {
    return res.status(400).json({ error: 'Router API credentials not configured.' });
  }

  const enable = !row.enabled;
  try {
    await setRouteEnabled(router, row.route_id, enable);
    db.prepare('UPDATE wan_routes SET enabled = ?, status = ? WHERE id = ?').run(
      enable ? 1 : 0,
      enable ? 'Active' : 'Disabled',
      id
    );
    db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
      'info',
      'network',
      `${enable ? 'Enabled' : 'Disabled'} WAN route ${row.gateway} on ${router.name}`
    );
    res.json({ ok: true, enabled: enable });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Could not update route on MikroTik router' });
  }
});

extraRouter.post('/network/wan/toggle-all', async (req, res) => {
  const enable = !!req.body?.enabled;
  const rows = db
    .prepare('SELECT id, router_id, route_id, gateway FROM wan_routes WHERE route_id IS NOT NULL')
    .all() as { id: number; router_id: number; route_id: string; gateway: string }[];

  if (rows.length === 0) {
    return res.status(400).json({ error: 'No live WAN routes to update. Add routers and refresh.' });
  }

  const errors: string[] = [];
  for (const row of rows) {
    const router = getRouterConn(row.router_id);
    if (!router?.host || !router?.api_user) continue;
    try {
      await setRouteEnabled(router, row.route_id, enable);
      db.prepare('UPDATE wan_routes SET enabled = ?, status = ? WHERE id = ?').run(
        enable ? 1 : 0,
        enable ? 'Active' : 'Disabled',
        row.id
      );
    } catch (e: any) {
      errors.push(`${router.name} ${row.gateway}: ${e?.message || 'failed'}`);
    }
  }

  if (errors.length === rows.length) {
    return res.status(502).json({ error: errors[0] || 'Could not update routes on MikroTik' });
  }

  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'info',
    'network',
    `${enable ? 'Enabled' : 'Disabled'} all WAN routes (${rows.length - errors.length}/${rows.length})`
  );
  res.json({ ok: true, enabled: enable, errors: errors.length ? errors : undefined });
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
function getZtSettings() {
  return db.prepare('SELECT zerotier_api_token, zerotier_network_id, zerotier_node_name FROM app_settings WHERE id = 1').get() as any;
}

extraRouter.get('/zerotier/settings', (_req, res) => {
  const s = getZtSettings() || {};
  res.json({
    apiTokenSet: !!s.zerotier_api_token,
    networkId: s.zerotier_network_id || '',
    nodeName: s.zerotier_node_name || '',
  });
});

extraRouter.put('/zerotier/settings', (req, res) => {
  const b = req.body || {};
  const cur = getZtSettings() || {};
  const token = b.apiToken != null && b.apiToken !== '' ? String(b.apiToken) : cur.zerotier_api_token;
  const networkId = b.networkId != null ? String(b.networkId) : cur.zerotier_network_id;
  const nodeName = b.nodeName != null ? String(b.nodeName) : cur.zerotier_node_name;
  db.prepare('UPDATE app_settings SET zerotier_api_token=?, zerotier_network_id=?, zerotier_node_name=? WHERE id=1').run(
    token || null,
    networkId || null,
    nodeName || null
  );
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run('info', 'zerotier', 'ZeroTier settings updated');
  res.json({ ok: true, apiTokenSet: !!token, networkId: networkId || '', nodeName: nodeName || '' });
});

extraRouter.get('/zerotier', (_req, res) => {
  const s = getZtSettings() || {};
  const configured = !!(s.zerotier_api_token && s.zerotier_network_id);
  if (!configured) {
    return res.json({
      configured: false,
      online: false,
      address: s.zerotier_node_name || 'not-configured',
      networks: [],
      message: 'Configure ZeroTier API token and Network ID in Setup below.',
    });
  }
  res.json({
    configured: true,
    online: true,
    address: s.zerotier_node_name || 'local-node',
    networks: [
      {
        id: s.zerotier_network_id,
        name: s.zerotier_network_id,
        status: 'OK',
        assignedIp: '—',
        members: [
          { name: s.zerotier_node_name || 'panel-host', ip: '—', authorized: true, online: true },
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
  return panelHardwareId();
}
export function expectedKeyFor(hwid: string): string {
  return expectedLicenseKey(hwid);
}
function normalizeKey(k: string): string {
  return normalizeCode(k);
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

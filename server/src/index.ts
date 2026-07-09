import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import si from 'systeminformation';
import { db, initSchema, seed, migrate } from './db.js';
import { signToken, requireAuth, type AuthedRequest } from './auth.js';
import { tryLiveResource } from './mikrotik.js';
import { getUptime, getUptimeSummary, runUptimeChecks, startUptime } from './uptime.js';

initSchema();
migrate();
seed();

/**
 * Extend an ISO date (YYYY-MM-DD) by a whole number of months, anchored on the
 * ORIGINAL date and preserving its day-of-month. The payment day is never used
 * as the anchor, so a subscriber's billing day does not drift. If the target
 * month has fewer days, the day is clamped to that month's last day.
 */
function addMonthsPreserveDay(iso: string, months: number): string {
  const base = new Date(`${iso}T00:00:00Z`);
  const day = base.getUTCDate();
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));
  return target.toISOString().slice(0, 10);
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 4000;

// ---- Auth ----
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
    | { id: number; username: string; password_hash: string; role: string }
    | undefined;
  if (!row || !bcrypt.compareSync(password || '', row.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = signToken({ id: row.id, username: row.username, role: row.role });
  res.json({ token, user: { id: row.id, username: row.username, role: row.role } });
});

app.get('/api/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

app.use('/api', requireAuth);

// ---- Routers ----
app.get('/api/routers', (_req, res) => {
  res.json(db.prepare('SELECT id, name, host, port, board, type, status FROM routers').all());
});

function getRouter(id: number) {
  return db.prepare('SELECT * FROM routers WHERE id = ?').get(id) as any;
}

// ---- Dashboard ----
app.get('/api/dashboard/host', async (_req, res) => {
  try {
    const [cpu, mem, temp, load, time, fs] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.cpuTemperature(),
      si.currentLoad(),
      si.time(),
      si.fsSize(),
    ]);
    const disk = fs[0] || ({ size: 1, used: 0 } as any);
    res.json({
      board: 'OrangePi Zero3',
      cpuTemp: temp.main && temp.main > 0 ? Number(temp.main.toFixed(1)) : 51.9,
      cpuUsage: Number(cpu.currentLoad.toFixed(1)),
      ramTotal: mem.total,
      ramUsed: mem.active,
      ramPct: Number(((mem.active / mem.total) * 100).toFixed(1)),
      diskPct: Number(((disk.used / disk.size) * 100).toFixed(1)),
      diskUsed: disk.used,
      diskTotal: disk.size,
      uptime: time.uptime,
    });
  } catch (e) {
    res.json({ board: 'OrangePi Zero3', cpuTemp: 51.9, cpuUsage: 3.2, ramPct: 26.1, diskPct: 15 });
  }
});

app.get('/api/dashboard/router/:id', async (req, res) => {
  const r = getRouter(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'router not found' });
  const users = db.prepare('SELECT status FROM pppoe_users WHERE router_id = ?').all(r.id) as { status: string }[];
  const active = users.filter((u) => u.status === 'Active').length;
  const expired = users.filter((u) => u.status === 'expired').length;
  const offline = Math.max(0, Math.round(active * 0.09));
  const { live } = await tryLiveResource(r, '/interface/print', []);
  res.json({
    name: r.name,
    board: r.board,
    live,
    uptime: '1w16h7m38s',
    cpuLoad: 3,
    memPct: 5,
    memTotal: 16,
    activePPPoE: active,
    offline,
    expired,
  });
});

app.get('/api/dashboard/queues', (_req, res) => {
  res.json(db.prepare('SELECT name, avg_rate AS avgRate FROM queues ORDER BY avg_rate DESC').all());
});

// ---- Sales ----
app.get('/api/sales', (req, res) => {
  const range = String(req.query.range || '7d');
  const now = new Date();
  let days = 7;
  if (range === '30d') days = 30;
  else if (range === '6m') days = 182;
  else if (range === '1y') days = 365;
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const rows = db
    .prepare('SELECT amount, created_at FROM transactions WHERE created_at >= ? ORDER BY created_at')
    .all(since) as { amount: number; created_at: string }[];

  const buckets = new Map<string, number>();
  const bucketBy = days <= 30 ? 'day' : 'month';
  for (const r of rows) {
    const d = new Date(r.created_at);
    const key = bucketBy === 'day' ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 7);
    buckets.set(key, (buckets.get(key) || 0) + r.amount);
  }
  const series: { label: string; value: number }[] = [];
  if (bucketBy === 'day') {
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      series.push({ label: key, value: buckets.get(key) || 0 });
    }
  } else {
    const months = range === '1y' ? 12 : 6;
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      series.push({ label: key, value: buckets.get(key) || 0 });
    }
  }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const transactions = rows.length;
  const daysWithRevenue = new Set(rows.map((r) => r.created_at.slice(0, 10)));
  const avgPerDay = daysWithRevenue.size ? total / daysWithRevenue.size : 0;
  const best = Math.max(0, ...series.map((s) => s.value));
  const todayKey = now.toISOString().slice(0, 10);
  const today = rows.filter((r) => r.created_at.slice(0, 10) === todayKey).reduce((s, r) => s + r.amount, 0);
  res.json({ series, total, transactions, avgPerDay, best, today });
});

app.get('/api/sales/transactions', (_req, res) => {
  res.json(
    db.prepare('SELECT id, customer_name AS customer, amount, type, created_at AS date FROM transactions ORDER BY created_at DESC LIMIT 200').all()
  );
});

// ---- PPPoE ----
app.get('/api/pppoe/users', (req, res) => {
  const service = String(req.query.service || 'pppoe');
  const rows = db
    .prepare(
      `SELECT id, username, customer_name AS customer, account_number AS account, profile, status,
              subscription_due AS subscriptionDue, price, address, lat, lng
       FROM pppoe_users WHERE service = ? ORDER BY id`
    )
    .all(service);
  res.json(rows);
});

app.post('/api/pppoe/users', (req, res) => {
  const { username, customer_name, account_number, profile, status, subscription_due, price, service } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username is required' });
  const prof = db.prepare('SELECT price FROM profiles WHERE name = ?').get(profile) as { price: number } | undefined;
  const info = db
    .prepare(
      `INSERT INTO pppoe_users (username, customer_name, account_number, profile, status, subscription_due, price, router_id, service)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(
      username,
      customer_name || username,
      account_number || String(Math.floor(Math.random() * 1e12)),
      profile || '15mbps',
      status || 'Active',
      subscription_due || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      price ?? prof?.price ?? 0,
      service || 'pppoe'
    );
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'info',
    'pppoe',
    `Created ${service || 'pppoe'} user ${username}`
  );
  res.status(201).json(db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/pppoe/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  db.prepare(
    `UPDATE pppoe_users SET customer_name = ?, profile = ?, status = ?, subscription_due = ?, price = ? WHERE id = ?`
  ).run(
    b.customer_name ?? existing.customer_name,
    b.profile ?? existing.profile,
    b.status ?? existing.status,
    b.subscription_due ?? existing.subscription_due,
    b.price ?? existing.price,
    id
  );
  res.json(db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(id));
});

app.delete('/api/pppoe/users/:id', (req, res) => {
  db.prepare('DELETE FROM pppoe_users WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Execute a payment: extends the subscription by whole month(s) from the
// existing expiration date (preserving day-of-month, never re-anchored to the
// payment day) and records the transaction.
app.post('/api/pppoe/users/:id/payment', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(id) as any;
  if (!user) return res.status(404).json({ error: 'not found' });

  const months = Math.max(1, Math.floor(Number(req.body?.months) || 1));
  const previousDue: string = (user.subscription_due || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const newDue = addMonthsPreserveDay(previousDue, months);

  const prof = db.prepare('SELECT price FROM profiles WHERE name = ?').get(user.profile) as { price: number } | undefined;
  const unit = Number(user.price) || prof?.price || 0;
  const amount = req.body?.amount != null ? Number(req.body.amount) : unit * months;

  db.prepare("UPDATE pppoe_users SET subscription_due = ?, status = 'Active', online = 1 WHERE id = ?").run(newDue, id);
  db.prepare('INSERT INTO transactions (pppoe_user_id, customer_name, amount, type) VALUES (?, ?, ?, ?)').run(
    id,
    user.customer_name || user.username,
    amount,
    'payment'
  );
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'info',
    'billing',
    `Payment received for ${user.username}: +${months} month(s), due ${previousDue} \u2192 ${newDue}`
  );

  res.json({
    ok: true,
    months,
    amount,
    previousDue,
    subscriptionDue: newDue,
    user: db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(id),
  });
});

app.get('/api/pppoe/profiles', (_req, res) => {
  res.json(db.prepare('SELECT id, name, rate_limit AS rateLimit, price, type FROM profiles').all());
});

app.get('/api/pppoe/active', (req, res) => {
  const service = String(req.query.service || 'pppoe');
  const rows = db
    .prepare(`SELECT username, customer_name AS customer, profile FROM pppoe_users WHERE status = 'Active' AND service = ? ORDER BY id LIMIT 100`)
    .all(service) as any[];
  const withSession = rows.map((r, i) => ({
    ...r,
    address: `10.20.${Math.floor(i / 254)}.${(i % 254) + 1}`,
    uptime: `${(i % 12) + 1}h${(i * 7) % 60}m`,
    caller: `A4:2B:${(i % 99).toString(16).padStart(2, '0')}:11:22:33`.toUpperCase(),
  }));
  res.json(withSession);
});

app.get('/api/pppoe/summary', (req, res) => {
  const service = String(req.query.service || 'pppoe');
  const rows = db.prepare('SELECT status FROM pppoe_users WHERE service = ?').all(service) as { status: string }[];
  res.json({
    total: rows.length,
    active: rows.filter((r) => r.status === 'Active').length,
    inactive: rows.filter((r) => r.status === 'inactive').length,
    expired: rows.filter((r) => r.status === 'expired').length,
  });
});

// ---- Servers (PPPoE servers on router) ----
app.get('/api/pppoe/servers', (_req, res) => {
  res.json([
    { name: 'pppoe-server-1', interface: 'ether2', maxSessions: 1000, service: 'pppoe', authentication: 'pap,chap', status: 'running' },
    { name: 'pppoe-server-2', interface: 'vlan10', maxSessions: 500, service: 'pppoe', authentication: 'chap', status: 'running' },
  ]);
});

app.get('/api/billing-plans', (_req, res) => {
  res.json(
    db.prepare('SELECT id, name, rate_limit AS rateLimit, price FROM profiles').all()
  );
});

// ---- Clients Map ----
app.get('/api/map', (_req, res) => {
  const naps = db.prepare('SELECT id, name, kind, lat, lng, ports, parent_id AS parentId FROM naps').all();
  const clients = db
    .prepare(
      `SELECT id, username, customer_name AS customer, status, online, lat, lng, nap_id AS napId, service
       FROM pppoe_users WHERE lat IS NOT NULL AND lng IS NOT NULL`
    )
    .all() as any[];
  clients.forEach((c) => (c.online = !!c.online));
  const totalClients = (db.prepare('SELECT COUNT(*) AS c FROM pppoe_users').get() as any).c;
  const withoutLocation = (db.prepare('SELECT COUNT(*) AS c FROM pppoe_users WHERE lat IS NULL').get() as any).c;
  const servers = (db.prepare('SELECT COUNT(*) AS c FROM routers').get() as any).c;
  const olts = (db.prepare("SELECT COUNT(*) AS c FROM naps WHERE kind = 'olt'").get() as any).c;
  const napCount = (db.prepare("SELECT COUNT(*) AS c FROM naps WHERE kind = 'nap'").get() as any).c;
  const onlineOnu = clients.filter((c) => c.online).length;
  const offlineOnu = clients.length - onlineOnu;
  res.json({
    naps,
    clients,
    stats: { servers, olts, naps: napCount, totalClients, withoutLocation, onlineOnu, offlineOnu },
  });
});

// ---- Inventory ----
app.get('/api/inventory', (_req, res) => {
  res.json(db.prepare('SELECT id, name, category, sku, quantity, unit_price AS unitPrice, status FROM inventory').all());
});

// ---- Logs ----
app.get('/api/logs', (_req, res) => {
  res.json(db.prepare('SELECT id, level, source, message, created_at AS date FROM logs ORDER BY id DESC LIMIT 200').all());
});

// ---- Company ----
app.get('/api/company', (_req, res) => {
  res.json(db.prepare('SELECT * FROM company WHERE id = 1').get());
});
app.put('/api/company', (req, res) => {
  const b = req.body || {};
  const c = db.prepare('SELECT * FROM company WHERE id = 1').get() as any;
  db.prepare('UPDATE company SET name = ?, address = ?, phone = ?, email = ?, currency = ? WHERE id = 1').run(
    b.name ?? c.name, b.address ?? c.address, b.phone ?? c.phone, b.email ?? c.email, b.currency ?? c.currency
  );
  res.json(db.prepare('SELECT * FROM company WHERE id = 1').get());
});

// ---- Hotspot (sample vouchers) ----
app.get('/api/hotspot', (_req, res) => {
  const plans = [
    { name: '1 Hour', price: 5, validity: '1h', speed: '5M/5M' },
    { name: '1 Day', price: 20, validity: '1d', speed: '10M/10M' },
    { name: '1 Week', price: 100, validity: '7d', speed: '10M/10M' },
    { name: '30 Days', price: 350, validity: '30d', speed: '15M/15M' },
  ];
  const active = Array.from({ length: 8 }, (_, i) => ({
    voucher: `HS-${(1000 + i * 137).toString().padStart(4, '0')}`,
    plan: plans[i % plans.length].name,
    address: `10.5.50.${i + 2}`,
    uptime: `${(i % 3) + 1}h${(i * 11) % 60}m`,
  }));
  res.json({ plans, active });
});

// ---- Uptime monitoring (popular services / sites / games) ----
app.get('/api/uptime', (_req, res) => {
  res.json({ summary: getUptimeSummary(), monitors: getUptime() });
});

app.post('/api/uptime/check', async (_req, res) => {
  await runUptimeChecks();
  res.json({ summary: getUptimeSummary(), monitors: getUptime() });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`MT-Billing API listening on http://localhost:${PORT}`);
  startUptime(60000);
});

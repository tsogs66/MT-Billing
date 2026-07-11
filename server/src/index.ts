import 'dotenv/config';
import http from 'http';
import os from 'os';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import si from 'systeminformation';
import { db, initSchema, seed, migrate } from './db.js';
import { signToken, requireAuth, type AuthedRequest } from './auth.js';
import { panelHardwareId, expectedPasswordResetCode, normalizeCode } from './panelId.js';
import {
  tryLiveResource,
  withRouter,
  probeRouter,
  fetchWanRoutes,
  listRouterFiles,
  fetchRouterDashboardStats,
  fetchRouterQueues,
  fetchRouterInterfaceNames,
  fetchRouterInterfaceTraffic,
  fetchPppSecrets,
  fetchPppActive,
  fetchPppProfiles,
  addPppProfile,
  updatePppProfile,
  removePppProfile,
  setPppSecretEnabled,
  fetchPppoeServers,
  fetchDhcpLeases,
  fetchDhcpServers,
  addDhcpServer,
  updateDhcpServer,
  removeDhcpServer,
  setDhcpLeaseBlocked,
  fetchPppActiveTraffic,
} from './mikrotik.js';
import { getUptime, getUptimeSummary, runUptimeChecks, startUptime } from './uptime.js';
import { getInterfaceNames, getTrafficSnapshot } from './interfaces.js';
import { settingsRouter } from './settings.js';
import { aiRouter } from './ai.js';
import { terminalRouter, initTerminalWs } from './terminal.js';
import { extraRouter, initExtra } from './extra.js';
import {
  getPublicSettings as getNotifySettings,
  updateSettings as updateNotifySettings,
  sendManual,
  runAutomations,
  listNotifications,
  startNotifyScheduler,
} from './notify.js';

initSchema();
migrate();
seed();
initExtra();

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
app.use(express.json({ limit: '8mb' }));

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

// Public: panel hardware ID for license / password-reset activator tools
app.get('/api/auth/panel-id', (_req, res) => {
  res.json({
    panelId: panelHardwareId(),
    defaultUser: process.env.ADMIN_USER || 'admin',
  });
});

// Public: company branding for sidebar / login (name + logo only)
app.get('/api/company/branding', (_req, res) => {
  const c = db.prepare('SELECT name, logo, address FROM company WHERE id = 1').get() as
    | { name?: string; logo?: string | null; address?: string | null }
    | undefined;
  res.json({
    name: c?.name || 'MT-Billing',
    logo: c?.logo || null,
    address: c?.address || null,
  });
});

// Public: reset panel login to default credentials using vendor activation code
app.post('/api/auth/forgot-password-reset', (req, res) => {
  const hwid = panelHardwareId();
  const provided = normalizeCode(req.body?.code);
  const expected = normalizeCode(expectedPasswordResetCode(hwid));
  if (!provided) return res.status(400).json({ error: 'Reset code is required.' });
  if (provided !== expected) {
    db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
      'warning',
      'auth',
      'Invalid password reset code attempt'
    );
    return res.status(400).json({ error: 'Invalid reset code for this panel ID.' });
  }

  const defaultUser = process.env.ADMIN_USER || 'admin';
  const defaultPass = process.env.ADMIN_PASS || 'admin123';
  const hash = bcrypt.hashSync(defaultPass, 10);

  let admin = db.prepare("SELECT * FROM users WHERE role = 'superadmin' ORDER BY id LIMIT 1").get() as any;
  if (!admin) admin = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get() as any;

  if (admin) {
    const conflict = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(defaultUser, admin.id);
    if (conflict) {
      return res.status(409).json({
        error: `Cannot reset username to "${defaultUser}" — that username is already in use.`,
      });
    }
    db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(defaultUser, hash, admin.id);
  } else {
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      defaultUser,
      hash,
      'superadmin'
    );
  }

  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'warning',
    'auth',
    `Panel credentials reset to default user "${defaultUser}" via activation code`
  );

  res.json({
    ok: true,
    username: defaultUser,
    message: `Panel login reset. Sign in with ${defaultUser} / (your default password).`,
  });
});

app.use('/api', requireAuth);

// ---- Routers ----
app.get('/api/routers', async (_req, res) => {
  const rows = db.prepare('SELECT id, name, host, port, ssh_port, board, type, status, api_user, api_pass FROM routers').all() as any[];
  const out = await Promise.all(
    rows.map(async (r) => {
      const probe = await probeRouter({
        host: r.host,
        port: r.port,
        api_user: r.api_user,
        api_pass: r.api_pass,
      });
      const status = probe.online ? 'online' : 'offline';
      const board = probe.board || r.board;
      if (status !== r.status || (probe.board && probe.board !== r.board)) {
        db.prepare('UPDATE routers SET status = ?, board = ? WHERE id = ?').run(status, board, r.id);
      }
      const { api_user: _u, api_pass: _p, ...pub } = r;
      return { ...pub, status, board };
    })
  );
  res.json(out);
});

function getRouter(id: number) {
  return db.prepare('SELECT * FROM routers WHERE id = ?').get(id) as any;
}

// ---- Dashboard ----
app.get('/api/dashboard/host', async (_req, res) => {
  try {
    const [cpu, mem, temp, time, fs, system, osInfo] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.cpuTemperature(),
      si.time(),
      si.fsSize(),
      si.system(),
      si.osInfo(),
    ]);
    const disk = fs[0] || ({ size: 1, used: 0 } as any);
    const hostname = osInfo.hostname || os.hostname();
    const board = [system.manufacturer, system.model].filter(Boolean).join(' ').trim() || hostname;
    res.json({
      hostname,
      board,
      cpuTemp: temp.main && temp.main > 0 ? Number(temp.main.toFixed(1)) : null,
      cpuUsage: Number(cpu.currentLoad.toFixed(1)),
      ramTotal: mem.total,
      ramUsed: mem.active,
      ramPct: Number(((mem.active / mem.total) * 100).toFixed(1)),
      diskPct: Number(((disk.used / disk.size) * 100).toFixed(1)),
      diskUsed: disk.used,
      diskTotal: disk.size,
      uptime: time.uptime,
    });
  } catch {
    res.json({
      hostname: os.hostname(),
      board: 'Panel server',
      cpuTemp: null,
      cpuUsage: 0,
      ramPct: 0,
      diskPct: 0,
      uptime: 0,
    });
  }
});

app.get('/api/dashboard/router/:id', async (req, res) => {
  const r = getRouter(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'router not found' });

  const users = db.prepare('SELECT status, online FROM pppoe_users WHERE router_id = ?').all(r.id) as {
    status: string;
    online: number;
  }[];
  const activeUsers = users.filter((u) => u.status === 'Active');
  const activePPPoE = activeUsers.length;
  const offline = activeUsers.filter((u) => !u.online).length;
  const expired = users.filter((u) => u.status === 'expired').length;

  const liveStats = await fetchRouterDashboardStats(r);

  res.json({
    name: r.name,
    host: r.host,
    board: liveStats.board || r.board,
    live: liveStats.live,
    uptime: liveStats.uptime || '—',
    cpuLoad: liveStats.cpuLoad,
    memPct: liveStats.memPct,
    memTotal: liveStats.memTotalMb,
    activePPPoE,
    offline,
    expired,
  });
});

app.get('/api/dashboard/queues', async (req, res) => {
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  if (routerId) {
    const router = getRouter(routerId);
    if (router?.host && router?.api_user) {
      try {
        const queues = await fetchRouterQueues(router);
        if (queues.length) return res.json(queues);
      } catch {
        /* fall through to local sample queues */
      }
    }
  }
  res.json(db.prepare('SELECT name, avg_rate AS avgRate FROM queues ORDER BY avg_rate DESC').all());
});

// Account status breakdown for the dashboard tiles.
app.get('/api/dashboard/status', (req, res) => {
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  const where = routerId ? 'WHERE router_id = ?' : '';
  const rows = (routerId
    ? db.prepare(`SELECT status, online FROM pppoe_users ${where}`).all(routerId)
    : db.prepare('SELECT status, online FROM pppoe_users').all()) as { status: string; online: number }[];
  const active = rows.filter((r) => r.status === 'Active');
  res.json({
    total: rows.length,
    online: active.filter((r) => r.online).length,
    offline: active.filter((r) => !r.online).length,
    active: active.length,
    expired: rows.filter((r) => r.status === 'expired').length,
    nonPayment: rows.filter((r) => r.status === 'non-payment').length,
    inactive: rows.filter((r) => r.status === 'inactive').length,
    disabled: rows.filter((r) => r.status === 'disabled').length,
  });
});

// ---- Sales ----
function isoWeek(d: Date): string {
  // ISO-8601 week number, returned as "YYYY-Www".
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

app.get('/api/sales', (req, res) => {
  const now = new Date();
  // Support both legacy ranges (7d/30d/6m/1y) and group buckets (week/month/year).
  const group = req.query.group ? String(req.query.group) : null;

  if (group === 'week' || group === 'month' || group === 'year') {
    const rows = db.prepare('SELECT amount, created_at FROM transactions ORDER BY created_at').all() as { amount: number; created_at: string }[];
    const buckets = new Map<string, number>();
    const keyOf = (iso: string) => {
      const d = new Date(iso);
      if (group === 'week') return isoWeek(d);
      if (group === 'month') return iso.slice(0, 7);
      return iso.slice(0, 4);
    };
    for (const r of rows) buckets.set(keyOf(r.created_at), (buckets.get(keyOf(r.created_at)) || 0) + r.amount);
    const series: { label: string; value: number }[] = [];
    if (group === 'week') {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 7 * 86400000);
        const key = isoWeek(d);
        series.push({ label: key, value: buckets.get(key) || 0 });
      }
    } else if (group === 'month') {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toISOString().slice(0, 7);
        series.push({ label: key, value: buckets.get(key) || 0 });
      }
    } else {
      for (let i = 4; i >= 0; i--) {
        const key = String(now.getFullYear() - i);
        series.push({ label: key, value: buckets.get(key) || 0 });
      }
    }
    const windowTotal = series.reduce((s, x) => s + x.value, 0);
    const nonZero = series.filter((x) => x.value > 0).length;
    res.json({
      series,
      total: windowTotal,
      transactions: rows.length,
      avgPerDay: nonZero ? windowTotal / nonZero : 0,
      best: Math.max(0, ...series.map((s) => s.value)),
      today: 0,
      group,
    });
    return;
  }

  const range = String(req.query.range || '7d');
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

app.delete('/api/sales/transactions', (req, res) => {
  const month = req.query.month ? String(req.query.month) : null;
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }
    const info = db
      .prepare("DELETE FROM transactions WHERE strftime('%Y-%m', created_at) = ?")
      .run(month);
    db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
      'warning',
      'sales',
      `Cleared ${info.changes} transaction(s) for ${month}`
    );
    return res.json({ ok: true, deleted: info.changes, month });
  }
  const info = db.prepare('DELETE FROM transactions').run();
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'warning',
    'sales',
    `Cleared all ${info.changes} transaction(s)`
  );
  res.json({ ok: true, deleted: info.changes });
});

// ---- PPPoE ----
function getRouterById(routerId: number | null | undefined) {
  if (!routerId) return null;
  return db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
}

app.get('/api/pppoe/users', async (req, res) => {
  const service = String(req.query.service || 'pppoe');
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  let rows = (
    routerId
      ? db
          .prepare(
            `SELECT id, username, customer_name AS customer, account_number AS account, profile, status,
                    subscription_due AS subscriptionDue, price, address, lat, lng, email, contact, online, router_id AS routerId
             FROM pppoe_users WHERE service = ? AND router_id = ? ORDER BY id`
          )
          .all(service, routerId)
      : db
          .prepare(
            `SELECT id, username, customer_name AS customer, account_number AS account, profile, status,
                    subscription_due AS subscriptionDue, price, address, lat, lng, email, contact, online, router_id AS routerId
             FROM pppoe_users WHERE service = ? ORDER BY id`
          )
          .all(service)
  ) as any[];

  // Enrich with live MikroTik secret profile + session online when a router is selected.
  const router = getRouterById(routerId);
  let live = false;
  if (router?.host && router?.api_user) {
    try {
      const [secrets, sessions] = await Promise.all([fetchPppSecrets(router), fetchPppActive(router)]);
      const byName = new Map(secrets.map((s) => [s.name, s]));
      const onlineSet = new Set(sessions.map((s) => s.name));
      rows = rows.map((u) => {
        const sec = byName.get(u.username);
        const sessionOnline = onlineSet.has(u.username);
        let status = u.status;
        let profile = u.profile;
        if (sec) {
          profile = sec.profile || u.profile;
          if (sec.disabled) status = 'disabled';
          else if (status === 'disabled') status = 'Active';
        }
        return {
          ...u,
          profile,
          status,
          online: sessionOnline ? 1 : 0,
          sessionOnline,
          mikrotikProfile: sec?.profile || null,
          live: true,
        };
      });
      live = true;
    } catch {
      /* keep DB rows */
    }
  }

  res.json(rows.map((u) => ({ ...u, live })));
});

// Full record for the edit form.
app.get('/api/pppoe/users/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

// Generate a unique 12-digit numeric account number.
function generateAccountNumber(): string {
  const exists = db.prepare('SELECT 1 FROM pppoe_users WHERE account_number = ?');
  for (let i = 0; i < 25; i++) {
    const n = String(Math.floor(100000000000 + Math.random() * 900000000000));
    if (!exists.get(n)) return n;
  }
  return String(Date.now()).slice(-12).padStart(12, '0');
}

app.post('/api/pppoe/users', (req, res) => {
  const b = req.body || {};
  const {
    username, password, customer_name, profile, status, subscription_due, price, service,
    expiration_profile, contact, email, nap_id, plc_port, address, lat, lng,
  } = b;
  if (!username) return res.status(400).json({ error: 'username is required' });

  const prof = db.prepare('SELECT price FROM profiles WHERE name = ?').get(profile) as { price: number } | undefined;
  const account = generateAccountNumber();
  const info = db
    .prepare(
      `INSERT INTO pppoe_users
        (username, password, customer_name, account_number, profile, status, subscription_due, price,
         router_id, service, expiration_profile, contact, email, nap_id, plc_port, address, lat, lng, online)
       VALUES (@username, @password, @customer_name, @account, @profile, @status, @subscription_due, @price,
         1, @service, @expiration_profile, @contact, @email, @nap_id, @plc_port, @address, @lat, @lng, 1)`
    )
    .run({
      username,
      password: password || '',
      customer_name: customer_name || username,
      account,
      profile: profile || '15mbps',
      status: status || 'Active',
      subscription_due: subscription_due || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      price: price ?? prof?.price ?? 0,
      service: service || 'pppoe',
      expiration_profile: expiration_profile || 'default',
      contact: contact || null,
      email: email || null,
      nap_id: nap_id || null,
      plc_port: plc_port || null,
      address: address || null,
      lat: lat != null && lat !== '' ? Number(lat) : null,
      lng: lng != null && lng !== '' ? Number(lng) : null,
    });
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'info',
    'pppoe',
    `Created ${service || 'pppoe'} user ${username} (acct ${account})`
  );
  res.status(201).json(db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/pppoe/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};

  // If the billing plan changed, sync the stored price to the plan's price
  // (unless an explicit price override is supplied).
  const newProfile = b.profile ?? existing.profile;
  let price = b.price ?? existing.price;
  if (b.profile && b.profile !== existing.profile && b.price == null) {
    const prof = db.prepare('SELECT price FROM profiles WHERE name = ?').get(newProfile) as { price: number } | undefined;
    if (prof) price = prof.price;
  }

  db.prepare(
    `UPDATE pppoe_users SET
       customer_name = @customer_name, password = @password, profile = @profile, status = @status,
       subscription_due = @subscription_due, price = @price, expiration_profile = @expiration_profile,
       contact = @contact, email = @email, nap_id = @nap_id, plc_port = @plc_port,
       address = @address, lat = @lat, lng = @lng
     WHERE id = @id`
  ).run({
    id,
    customer_name: b.customer_name ?? existing.customer_name,
    password: b.password ?? existing.password,
    profile: newProfile,
    status: b.status ?? existing.status,
    subscription_due: b.subscription_due ?? existing.subscription_due,
    price,
    expiration_profile: b.expiration_profile ?? existing.expiration_profile,
    contact: b.contact ?? existing.contact,
    email: b.email ?? existing.email,
    nap_id: b.nap_id != null ? (b.nap_id || null) : existing.nap_id,
    plc_port: b.plc_port ?? existing.plc_port,
    address: b.address ?? existing.address,
    lat: b.lat != null && b.lat !== '' ? Number(b.lat) : b.lat === '' ? null : existing.lat,
    lng: b.lng != null && b.lng !== '' ? Number(b.lng) : b.lng === '' ? null : existing.lng,
  });
  res.json(db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(id));
});

// Enable/disable the client account on MikroTik (/ppp/secret) and in the DB.
app.post('/api/pppoe/users/:id/toggle-enabled', async (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(id) as any;
  if (!u) return res.status(404).json({ error: 'not found' });
  const disabling = u.status !== 'disabled';
  const router = getRouterById(u.router_id);
  if (router?.host && router?.api_user) {
    try {
      await setPppSecretEnabled(router, u.username, !disabling);
    } catch (e: any) {
      return res.status(502).json({ error: e?.message || 'Could not update PPP secret on MikroTik' });
    }
  }
  if (disabling) {
    db.prepare("UPDATE pppoe_users SET status = 'disabled', online = 0 WHERE id = ?").run(id);
  } else {
    db.prepare("UPDATE pppoe_users SET status = 'Active', online = 1, nonpayment_since = NULL WHERE id = ?").run(id);
  }
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'info',
    'mikrotik',
    `${disabling ? 'Disabled' : 'Enabled'} ${u.service} secret for ${u.username}`
  );
  res.json({ ok: true, status: disabling ? 'disabled' : 'Active', user: db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(id) });
});

app.delete('/api/pppoe/users/:id', (req, res) => {
  db.prepare('DELETE FROM pppoe_users WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/pppoe/users/bulk-disable', (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map((id: unknown) => Number(id))
    .filter((id: number) => Number.isFinite(id) && id > 0);
  if (!ids.length) return res.status(400).json({ error: 'No user IDs provided.' });

  const stmt = db.prepare("UPDATE pppoe_users SET status = 'disabled', online = 0 WHERE id = ?");
  let count = 0;
  for (const id of ids) {
    const u = db.prepare('SELECT username, service FROM pppoe_users WHERE id = ?').get(id) as any;
    if (!u) continue;
    stmt.run(id);
    count++;
    db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
      'info',
      'mikrotik',
      `Bulk disabled ${u.service} secret for ${u.username}`
    );
  }
  res.json({ ok: true, count });
});

app.post('/api/pppoe/users/bulk-delete', (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map((id: unknown) => Number(id))
    .filter((id: number) => Number.isFinite(id) && id > 0);
  if (!ids.length) return res.status(400).json({ error: 'No user IDs provided.' });

  const stmt = db.prepare('DELETE FROM pppoe_users WHERE id = ?');
  let count = 0;
  for (const id of ids) {
    const info = stmt.run(id);
    if (info.changes) count++;
  }
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'warning',
    'mikrotik',
    `Bulk deleted ${count} PPPoE/IPoE user(s)`
  );
  res.json({ ok: true, count });
});

// Execute a payment: extends the subscription by whole month(s) from the
// existing expiration date (preserving day-of-month, never re-anchored to the
// payment day) and records the transaction.
app.post('/api/pppoe/users/:id/payment', async (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(id) as any;
  if (!user) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};

  const months = Math.max(1, Math.floor(Number(b.months) || 1));
  const previousDue: string = (user.subscription_due || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const newDue = addMonthsPreserveDay(previousDue, months);

  // Optional plan change applied at payment time.
  const plan = b.plan || user.profile;
  const prof = db.prepare('SELECT price FROM profiles WHERE name = ?').get(plan) as { price: number } | undefined;
  const unit = prof?.price ?? (Number(user.price) || 0);
  const subtotal = unit * months;

  // Discount for downtime: credit the daily rate for each downtime day.
  const discountDays = Math.max(0, Math.floor(Number(b.discount_days) || 0));
  const dailyRate = unit / 30;
  const discount = Math.round(dailyRate * discountDays * 100) / 100;
  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

  const expirationProfile = b.expiration_profile || user.expiration_profile || 'default';
  const paymentDate = b.payment_date ? new Date(`${String(b.payment_date).slice(0, 10)}T00:00:00Z`).toISOString() : new Date().toISOString();

  db.prepare(
    `UPDATE pppoe_users SET subscription_due = ?, profile = ?, price = ?, expiration_profile = ?,
       status = 'Active', online = 1, nonpayment_since = NULL, reminder_sent = NULL WHERE id = ?`
  ).run(newDue, plan, unit, expirationProfile, id);
  db.prepare('INSERT INTO transactions (pppoe_user_id, customer_name, amount, type, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    user.customer_name || user.username,
    total,
    'payment',
    paymentDate
  );
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'info',
    'billing',
    `Payment for ${user.username}: ${plan} +${months}mo, due ${previousDue} \u2192 ${newDue}, total ${total}`
  );

  const company = db.prepare('SELECT * FROM company WHERE id = 1').get() as any;
  const receipt = {
    company: company?.name || 'Pa-North',
    account: user.account_number,
    customer: user.customer_name || user.username,
    username: user.username,
    plan,
    months,
    paymentDate: paymentDate.slice(0, 10),
    previousDue,
    newDue,
    subtotal,
    discount,
    discountDays,
    total,
  };

  // Optionally email the receipt if requested and an address is on file.
  let emailed = false;
  if (b.send_receipt && user.email) {
    const msg = `Official Receipt\nAccount #: ${user.account_number}\nCustomer: ${receipt.customer}\nPlan: ${plan}\nPayment date: ${receipt.paymentDate}\nNext due: ${newDue}\nSubtotal: ${subtotal.toFixed(2)}\nDiscount: ${discount.toFixed(2)}\nTOTAL: ${total.toFixed(2)}`;
    const r = await sendManual({ channel: 'email', target: 'client', clientId: id, subject: 'Payment Receipt', message: msg });
    emailed = r.sent > 0;
  }

  res.json({
    ok: true,
    months,
    plan,
    previousDue,
    subscriptionDue: newDue,
    subtotal,
    discount,
    total,
    amount: total,
    emailed,
    receipt,
    user: db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(id),
  });
});

// Fetch existing subscribers from a live MikroTik router by reading /ppp/secret
// and parsing the billing JSON stored in each secret's comment.
function parseSecretComment(comment: unknown): any {
  if (!comment || typeof comment !== 'string') return {};
  const s = comment.trim();
  if (!s.startsWith('{')) return {};
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}
function normStatus(v: unknown): string {
  const s = String(v ?? '').toLowerCase();
  if (/^(active|enabled|online|1|true)$/.test(s)) return 'Active';
  if (/non.?pay/.test(s)) return 'non-payment';
  if (/expire/.test(s)) return 'expired';
  if (/disable/.test(s)) return 'disabled';
  if (/inactive/.test(s)) return 'inactive';
  return s ? String(v) : 'Active';
}

app.post('/api/pppoe/fetch-mikrotik', async (req, res) => {
  const routerId = Number((req.query.routerId ?? req.body?.routerId) || 0);
  const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
  if (!router) return res.status(400).json({ error: 'Router not found. Select a router first.' });

  let secrets: any[];
  let profiles: any[];
  let activeNames = new Set<string>();
  try {
    const data = (await withRouter(router, async (api) => {
      const p = (await api.write('/ppp/profile/print')) as any[];
      const s = (await api.write('/ppp/secret/print')) as any[];
      const a = (await api.write('/ppp/active/print')) as any[];
      return { profiles: p, secrets: s, active: a };
    })) as { profiles: any[]; secrets: any[]; active: any[] };
    profiles = data.profiles || [];
    secrets = data.secrets || [];
    activeNames = new Set((data.active || []).map((x) => x.name).filter(Boolean));
  } catch {
    return res.status(502).json({
      error:
        'Could not reach the router API. Check the host, API port and credentials in Router Management, and make sure the RouterOS API service is enabled.',
    });
  }

  const service = router.type === 'ipoe' ? 'ipoe' : 'pppoe';

  // Import PPP profiles first (RouterOS has no price, so keep any existing price).
  const findProfile = db.prepare('SELECT id FROM profiles WHERE name = ?');
  const insProfile = db.prepare('INSERT INTO profiles (name, rate_limit, price, type) VALUES (?, ?, 0, ?)');
  const updProfile = db.prepare('UPDATE profiles SET rate_limit = ? WHERE name = ?');
  let profilesImported = 0;
  db.transaction(() => {
    for (const p of profiles) {
      const name = p?.name;
      if (!name) continue;
      const rl = p['rate-limit'] || p.rateLimit || '';
      if (findProfile.get(name)) updProfile.run(String(rl), String(name));
      else insProfile.run(String(name), String(rl), 'pppoe');
      profilesImported++;
    }
  })();

  const planPrice: Record<string, number> = {};
  for (const p of db.prepare('SELECT name, price FROM profiles').all() as any[]) planPrice[p.name] = p.price;
  const ensurePlan = db.prepare("INSERT OR IGNORE INTO profiles (name, rate_limit, price, type) VALUES (?, '', 0, 'pppoe')");
  const findUser = db.prepare('SELECT id, account_number FROM pppoe_users WHERE username = ?');
  const insUser = db.prepare(
    `INSERT INTO pppoe_users
      (username, password, customer_name, account_number, profile, status, subscription_due, price,
       router_id, service, expiration_profile, contact, email, address, plc_port, lat, lng, online)
     VALUES (@username, @password, @customer_name, @account_number, @profile, @status, @subscription_due, @price,
       @router_id, @service, @expiration_profile, @contact, @email, @address, @plc_port, @lat, @lng, @online)`
  );
  const updUser = db.prepare(
    `UPDATE pppoe_users SET password=@password, customer_name=@customer_name, account_number=@account_number,
       profile=@profile, status=@status, subscription_due=@subscription_due, price=@price, router_id=@router_id,
       service=@service, expiration_profile=@expiration_profile, contact=@contact, email=@email, address=@address,
       plc_port=@plc_port, lat=@lat, lng=@lng, online=@online WHERE id=@id`
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const tx = db.transaction(() => {
    for (const sec of secrets) {
      const username = sec.name;
      if (!username) {
        skipped++;
        continue;
      }
      const meta = parseSecretComment(sec.comment);
      const cust = meta.customer || {};
      // Prefer live RouterOS profile for the Profile column; fall back to billing plan in comment.
      const rosProfile = String(sec.profile || '').trim();
      const plan = rosProfile || String(meta.plan || '15mbps');
      if (!(plan in planPrice)) {
        ensurePlan.run(plan);
        planPrice[plan] = 0;
      }
      const disabled = sec.disabled === 'true' || sec.disabled === true;
      const existing = findUser.get(username) as any;
      const account = String(meta.accountNumber || existing?.account_number || generateAccountNumber());
      const due = meta.dueDate ? String(meta.dueDate).slice(0, 10) : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      const status = disabled ? 'disabled' : normStatus(cust.status);
      const fields = {
        username: String(username),
        password: sec.password || '',
        customer_name: cust.fullName || String(username),
        account_number: account,
        profile: plan,
        status,
        subscription_due: due,
        price: Number(planPrice[plan]) || Number(planPrice[String(meta.plan || '')]) || 0,
        router_id: router.id,
        service,
        expiration_profile: String(meta.expireProfile || 'default'),
        contact: cust.contactNumber || null,
        email: cust.email || null,
        address: cust.address || null,
        plc_port: cust.plcPort != null && cust.plcPort !== '' ? String(cust.plcPort) : null,
        lat: cust.latitude != null ? Number(cust.latitude) : null,
        lng: cust.longitude != null ? Number(cust.longitude) : null,
        online: activeNames.has(String(username)) ? 1 : 0,
      };
      if (existing) {
        updUser.run({ ...fields, id: existing.id });
        updated++;
      } else {
        insUser.run(fields);
        created++;
      }
    }
  });
  tx();

  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'info',
    'mikrotik',
    `Fetched from ${router.name}: ${profilesImported} profiles, ${secrets.length} secrets (${created} new, ${updated} updated), ${activeNames.size} active`
  );
  res.json({
    ok: true,
    fetched: secrets.length,
    created,
    updated,
    skipped,
    profilesImported,
    active: activeNames.size,
    service,
    router: router.name,
  });
});

app.get('/api/pppoe/profiles', async (req, res) => {
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  const dbProfiles = db.prepare('SELECT id, name, rate_limit AS rateLimit, price, type FROM profiles ORDER BY name').all() as any[];
  const router = getRouterById(routerId);
  if (!router?.host || !router?.api_user) {
    return res.json({ profiles: dbProfiles, live: false });
  }
  try {
    const live = await fetchPppProfiles(router);
    const byName = new Map(dbProfiles.map((p) => [p.name, p]));
    const merged = live.map((p) => {
      const dbp = byName.get(p.name);
      return {
        id: dbp?.id ?? p.id,
        mikrotikId: p.id,
        name: p.name,
        rateLimit: p.rateLimit || dbp?.rateLimit || '',
        price: dbp?.price ?? 0,
        type: dbp?.type || 'pppoe',
        localAddress: p.localAddress,
        remoteAddress: p.remoteAddress,
        live: true,
      };
    });
    // Include DB-only billing plans not present on the router.
    for (const p of dbProfiles) {
      if (!merged.some((m) => m.name === p.name)) {
        merged.push({ ...p, mikrotikId: null, live: false });
      }
    }
    res.json({ profiles: merged, live: true, routerId: router.id, routerName: router.name });
  } catch (e: any) {
    res.status(502).json({
      error: e?.message || 'Could not fetch PPP profiles from MikroTik',
      profiles: dbProfiles,
      live: false,
    });
  }
});

app.post('/api/pppoe/profiles', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const rateLimit = String(b.rateLimit || b.rate_limit || '').trim();
  const price = Number(b.price) || 0;
  const routerId = b.routerId ? Number(b.routerId) : null;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const router = getRouterById(routerId);
  if (router?.host && router?.api_user) {
    try {
      await addPppProfile(router, {
        name,
        rateLimit: rateLimit || undefined,
        localAddress: b.localAddress || undefined,
        remoteAddress: b.remoteAddress || undefined,
        comment: b.comment || undefined,
      });
    } catch (e: any) {
      return res.status(502).json({ error: e?.message || 'Could not add PPP profile on MikroTik' });
    }
  }
  const existing = db.prepare('SELECT id FROM profiles WHERE name = ?').get(name) as any;
  if (existing) {
    db.prepare('UPDATE profiles SET rate_limit = ?, price = ? WHERE id = ?').run(rateLimit, price, existing.id);
    return res.json(db.prepare('SELECT id, name, rate_limit AS rateLimit, price, type FROM profiles WHERE id = ?').get(existing.id));
  }
  const info = db.prepare('INSERT INTO profiles (name, rate_limit, price, type) VALUES (?, ?, ?, ?)').run(name, rateLimit, price, 'pppoe');
  res.status(201).json(db.prepare('SELECT id, name, rate_limit AS rateLimit, price, type FROM profiles WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/pppoe/profiles/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as any;
  const b = req.body || {};
  const routerId = b.routerId ? Number(b.routerId) : null;
  const name = String(b.name ?? existing?.name ?? '').trim();
  const rateLimit = String(b.rateLimit ?? b.rate_limit ?? existing?.rate_limit ?? '').trim();
  const price = b.price != null ? Number(b.price) : existing?.price ?? 0;
  const router = getRouterById(routerId);

  if (router?.host && router?.api_user) {
    try {
      const live = await fetchPppProfiles(router);
      const hit = live.find((p) => p.name === (existing?.name || name) || p.id === String(b.mikrotikId || ''));
      if (hit) {
        await updatePppProfile(router, hit.id, {
          name,
          rateLimit,
          localAddress: b.localAddress,
          remoteAddress: b.remoteAddress,
          comment: b.comment,
        });
      } else {
        await addPppProfile(router, { name, rateLimit: rateLimit || undefined });
      }
    } catch (e: any) {
      return res.status(502).json({ error: e?.message || 'Could not update PPP profile on MikroTik' });
    }
  }

  if (existing) {
    db.prepare('UPDATE profiles SET name = ?, rate_limit = ?, price = ? WHERE id = ?').run(name, rateLimit, price, id);
    return res.json(db.prepare('SELECT id, name, rate_limit AS rateLimit, price, type FROM profiles WHERE id = ?').get(id));
  }
  const info = db.prepare('INSERT INTO profiles (name, rate_limit, price, type) VALUES (?, ?, ?, ?)').run(name, rateLimit, price, 'pppoe');
  res.status(201).json(db.prepare('SELECT id, name, rate_limit AS rateLimit, price, type FROM profiles WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/pppoe/profiles/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const routerId = req.query.routerId ? Number(req.query.routerId) : req.body?.routerId ? Number(req.body.routerId) : null;
  const inUse = db.prepare('SELECT COUNT(*) AS c FROM pppoe_users WHERE profile = ?').get(existing.name) as { c: number };
  if (inUse.c > 0) {
    return res.status(400).json({ error: `Profile "${existing.name}" is used by ${inUse.c} user(s).` });
  }
  const router = getRouterById(routerId);
  if (router?.host && router?.api_user) {
    try {
      const live = await fetchPppProfiles(router);
      const hit = live.find((p) => p.name === existing.name);
      if (hit) await removePppProfile(router, hit.id);
    } catch (e: any) {
      return res.status(502).json({ error: e?.message || 'Could not remove PPP profile on MikroTik' });
    }
  }
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/pppoe/active', async (req, res) => {
  const service = String(req.query.service || 'pppoe');
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  const router = getRouterById(routerId);
  if (!router) {
    return res.status(400).json({ error: 'Select a router in the top bar.', sessions: [], live: false });
  }
  if (!router.host || !router.api_user) {
    return res.status(400).json({ error: 'Router API credentials not configured.', sessions: [], live: false });
  }
  try {
    const sessions = await fetchPppActive(router);
    const users = db
      .prepare(
        `SELECT username, customer_name AS customer, profile FROM pppoe_users WHERE service = ? AND router_id = ?`
      )
      .all(service, router.id) as any[];
    const byUser = new Map(users.map((u) => [u.username, u]));
    const filtered = sessions.filter(
      (s) => !service || s.service === 'any' || !s.service || s.service.includes(service) || service === 'pppoe'
    );
    let traffic: Record<string, { download: number; upload: number }> = {};
    try {
      traffic = await fetchPppActiveTraffic(
        router,
        filtered.map((s) => s.name)
      );
    } catch {
      /* traffic optional */
    }
    const out = filtered.map((s) => {
      const u = byUser.get(s.name);
      const t = traffic[s.name];
      return {
        username: s.name,
        customer: u?.customer || s.name,
        profile: s.profile !== '-' ? s.profile : u?.profile || '-',
        address: s.address,
        uptime: s.uptime,
        caller: s.caller && s.caller !== '-' ? s.caller : '—',
        service: s.service,
        downloadBps: t?.download ?? 0,
        uploadBps: t?.upload ?? 0,
      };
    });
    res.json({ sessions: out, live: true, routerId: router.id, routerName: router.name });
  } catch (e: any) {
    res.status(502).json({
      error: e?.message || 'Could not fetch active PPP sessions from MikroTik',
      sessions: [],
      live: false,
      routerId: router.id,
      routerName: router.name,
    });
  }
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

// ---- Servers (live PPPoE servers on selected MikroTik) ----
app.get('/api/pppoe/servers', async (req, res) => {
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  const router = getRouterById(routerId);
  if (!router) {
    return res.status(400).json({ error: 'Select a router in the top bar.', servers: [], live: false });
  }
  if (!router.host || !router.api_user) {
    return res.status(400).json({ error: 'Router API credentials not configured.', servers: [], live: false });
  }
  try {
    const servers = await fetchPppoeServers(router);
    res.json({ servers, live: true, routerId: router.id, routerName: router.name });
  } catch (e: any) {
    res.status(502).json({
      error: e?.message || 'Could not fetch PPPoE servers from MikroTik',
      servers: [],
      live: false,
      routerId: router.id,
      routerName: router.name,
    });
  }
});

app.get('/api/billing-plans', (_req, res) => {
  res.json(db.prepare('SELECT id, name, rate_limit AS rateLimit, price FROM profiles ORDER BY name').all());
});

app.post('/api/billing-plans', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const rateLimit = String(b.rateLimit || b.rate_limit || '').trim();
  const price = Number(b.price) || 0;
  if (!name) return res.status(400).json({ error: 'Plan name is required' });
  const exists = db.prepare('SELECT id FROM profiles WHERE name = ?').get(name);
  if (exists) return res.status(409).json({ error: 'A plan with that name already exists' });
  const info = db.prepare('INSERT INTO profiles (name, rate_limit, price, type) VALUES (?, ?, ?, ?)').run(name, rateLimit, price, 'pppoe');
  res.status(201).json(db.prepare('SELECT id, name, rate_limit AS rateLimit, price FROM profiles WHERE id = ?').get(info.lastInsertRowid));
});

app.put('/api/billing-plans/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const name = String(b.name ?? existing.name).trim();
  const rateLimit = String(b.rateLimit ?? b.rate_limit ?? existing.rate_limit ?? '').trim();
  const price = b.price != null ? Number(b.price) : existing.price;
  if (!name) return res.status(400).json({ error: 'Plan name is required' });
  const conflict = db.prepare('SELECT id FROM profiles WHERE name = ? AND id != ?').get(name, id);
  if (conflict) return res.status(409).json({ error: 'A plan with that name already exists' });
  // Keep user.profile in sync if renamed
  if (name !== existing.name) {
    db.prepare('UPDATE pppoe_users SET profile = ? WHERE profile = ?').run(name, existing.name);
  }
  db.prepare('UPDATE profiles SET name = ?, rate_limit = ?, price = ? WHERE id = ?').run(name, rateLimit, price, id);
  res.json(db.prepare('SELECT id, name, rate_limit AS rateLimit, price FROM profiles WHERE id = ?').get(id));
});

app.delete('/api/billing-plans/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const inUse = db.prepare('SELECT COUNT(*) AS c FROM pppoe_users WHERE profile = ?').get(existing.name) as { c: number };
  if (inUse.c > 0) {
    return res.status(400).json({ error: `Plan "${existing.name}" is used by ${inUse.c} user(s).` });
  }
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---- IPoE (DHCP leases / servers / profiles / billing plans) ----
function normalizeMac(mac: string): string {
  return String(mac || '')
    .toUpperCase()
    .replace(/[^A-F0-9]/g, '')
    .replace(/(.{2})(?=.)/g, '$1:');
}

function formatSpeedMbps(down: number, up: number): string {
  const d = Number(down) || 0;
  const u = Number(up) || 0;
  return `${d}↓ / ${u}↑ Mbps`;
}

app.get('/api/ipoe/leases', async (req, res) => {
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  const filter = String(req.query.filter || 'all'); // all | online | offline
  const router = getRouterById(routerId);
  if (!router) return res.status(400).json({ error: 'Select a router in the top bar.', leases: [], live: false });
  if (!router.host || !router.api_user) {
    return res.status(400).json({ error: 'Router API credentials not configured.', leases: [], live: false });
  }
  try {
    const leases = await fetchDhcpLeases(router);
    const plans = db.prepare('SELECT * FROM ipoe_plans').all() as any[];
    const profiles = db.prepare('SELECT * FROM ipoe_profiles').all() as any[];
    const metaRows = db.prepare('SELECT * FROM ipoe_lease_meta').all() as any[];
    const metaByMac = new Map(metaRows.map((m) => [normalizeMac(m.mac), m]));
    const planByName = new Map(plans.map((p) => [p.name, p]));
    const profileByName = new Map(profiles.map((p) => [p.name, p]));

    const mapped = leases.map((l) => {
      const mac = normalizeMac(l.macAddress || l.activeMac);
      const meta = metaByMac.get(mac);
      const planName = meta?.plan_name || plans[0]?.name || '';
      const plan = planByName.get(planName);
      const profile = plan?.profile_name ? profileByName.get(plan.profile_name) : null;
      const online = /bound|waiting/i.test(l.status) ? /bound/i.test(l.status) : !!l.activeAddress;
      const down = plan?.download_mbps ?? profile?.download_mbps ?? 0;
      const up = plan?.upload_mbps ?? profile?.upload_mbps ?? 0;
      return {
        id: l.id,
        name: meta?.name || l.hostName || mac || l.address || '—',
        address: l.activeAddress || l.address || '—',
        mac,
        host: l.hostName || meta?.name || '—',
        plan: planName,
        speed: formatSpeedMbps(down, up),
        downloadMbps: down,
        uploadMbps: up,
        due: meta?.due_at || '',
        payment: meta?.payment_status || 'Active',
        status: l.blocked ? 'Blocked' : online ? 'Online' : 'Offline',
        online,
        server: l.activeServer || l.server || '—',
        expires: l.expiresAfter || '—',
        lastSeen: l.lastSeen || '—',
        blocked: l.blocked,
        comment: l.comment || meta?.comment || '',
      };
    });

    const filtered =
      filter === 'online' ? mapped.filter((x) => x.online && !x.blocked) : filter === 'offline' ? mapped.filter((x) => !x.online || x.blocked) : mapped;

    res.json({ leases: filtered, live: true, routerId: router.id, routerName: router.name, plans, profiles });
  } catch (e: any) {
    res.status(502).json({
      error: e?.message || 'Could not fetch DHCP leases from MikroTik',
      leases: [],
      live: false,
    });
  }
});

app.put('/api/ipoe/leases/:mac', async (req, res) => {
  const mac = normalizeMac(decodeURIComponent(req.params.mac));
  const b = req.body || {};
  const routerId = b.routerId ? Number(b.routerId) : null;
  db.prepare(
    `INSERT INTO ipoe_lease_meta (mac, name, plan_name, due_at, payment_status, comment)
     VALUES (@mac, @name, @plan_name, @due_at, @payment_status, @comment)
     ON CONFLICT(mac) DO UPDATE SET
       name=COALESCE(@name, name),
       plan_name=COALESCE(@plan_name, plan_name),
       due_at=COALESCE(@due_at, due_at),
       payment_status=COALESCE(@payment_status, payment_status),
       comment=COALESCE(@comment, comment)`
  ).run({
    mac,
    name: b.name ?? null,
    plan_name: b.plan ?? b.plan_name ?? null,
    due_at: b.due ?? b.due_at ?? null,
    payment_status: b.payment ?? b.payment_status ?? null,
    comment: b.comment ?? null,
  });

  if (b.blocked != null && routerId) {
    const router = getRouterById(routerId);
    if (router?.host && router?.api_user && b.id) {
      try {
        await setDhcpLeaseBlocked(router, String(b.id), !!b.blocked);
      } catch (e: any) {
        return res.status(502).json({ error: e?.message || 'Could not update lease on MikroTik' });
      }
    }
  }
  res.json({ ok: true, mac });
});

app.post('/api/ipoe/leases/:mac/toggle-block', async (req, res) => {
  const mac = normalizeMac(decodeURIComponent(req.params.mac));
  const routerId = Number(req.body?.routerId || req.query.routerId || 0);
  const leaseId = String(req.body?.id || '');
  const blocked = !!req.body?.blocked;
  const router = getRouterById(routerId);
  if (!router?.host || !router?.api_user) return res.status(400).json({ error: 'Router API credentials not configured.' });
  if (!leaseId) return res.status(400).json({ error: 'Lease id is required' });
  try {
    await setDhcpLeaseBlocked(router, leaseId, blocked);
    res.json({ ok: true, mac, blocked });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Could not block/unblock lease on MikroTik' });
  }
});

app.get('/api/ipoe/servers', async (req, res) => {
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  const router = getRouterById(routerId);
  if (!router) return res.status(400).json({ error: 'Select a router in the top bar.', servers: [], live: false });
  if (!router.host || !router.api_user) {
    return res.status(400).json({ error: 'Router API credentials not configured.', servers: [], live: false });
  }
  try {
    const servers = await fetchDhcpServers(router);
    res.json({
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        interface: s.interface,
        pool: s.addressPool,
        lease: s.leaseTime,
        status: s.disabled ? 'Disabled' : 'Enabled',
        disabled: s.disabled,
      })),
      live: true,
      routerId: router.id,
      routerName: router.name,
    });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Could not fetch DHCP servers', servers: [], live: false });
  }
});

app.post('/api/ipoe/servers', async (req, res) => {
  const b = req.body || {};
  const router = getRouterById(Number(b.routerId || 0));
  if (!router?.host || !router?.api_user) return res.status(400).json({ error: 'Router API credentials not configured.' });
  if (!b.name || !b.interface || !b.pool) return res.status(400).json({ error: 'name, interface and pool are required' });
  try {
    await addDhcpServer(router, {
      name: String(b.name),
      interface: String(b.interface),
      addressPool: String(b.pool),
      leaseTime: b.lease ? String(b.lease) : undefined,
    });
    res.status(201).json({ ok: true });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Could not add DHCP server' });
  }
});

app.put('/api/ipoe/servers/:id', async (req, res) => {
  const b = req.body || {};
  const router = getRouterById(Number(b.routerId || 0));
  if (!router?.host || !router?.api_user) return res.status(400).json({ error: 'Router API credentials not configured.' });
  try {
    await updateDhcpServer(router, req.params.id, {
      name: b.name,
      interface: b.interface,
      addressPool: b.pool,
      leaseTime: b.lease,
      disabled: b.disabled,
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Could not update DHCP server' });
  }
});

app.delete('/api/ipoe/servers/:id', async (req, res) => {
  const routerId = Number(req.query.routerId || req.body?.routerId || 0);
  const router = getRouterById(routerId);
  if (!router?.host || !router?.api_user) return res.status(400).json({ error: 'Router API credentials not configured.' });
  try {
    await removeDhcpServer(router, req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Could not delete DHCP server' });
  }
});

app.get('/api/ipoe/profiles', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT id, name, download_mbps AS downloadMbps, upload_mbps AS uploadMbps, max_limit AS maxLimit FROM ipoe_profiles ORDER BY name`
      )
      .all()
  );
});

app.post('/api/ipoe/profiles', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const down = Number(b.downloadMbps ?? b.download_mbps) || 0;
  const up = Number(b.uploadMbps ?? b.upload_mbps) || 0;
  const maxLimit = String(b.maxLimit || b.max_limit || `${down}M/${up}M`);
  try {
    const info = db
      .prepare('INSERT INTO ipoe_profiles (name, download_mbps, upload_mbps, max_limit) VALUES (?, ?, ?, ?)')
      .run(name, down, up, maxLimit);
    res.status(201).json(db.prepare('SELECT id, name, download_mbps AS downloadMbps, upload_mbps AS uploadMbps, max_limit AS maxLimit FROM ipoe_profiles WHERE id = ?').get(info.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Profile name already exists' });
  }
});

app.put('/api/ipoe/profiles/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM ipoe_profiles WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const name = String(b.name ?? existing.name).trim();
  const down = b.downloadMbps != null ? Number(b.downloadMbps) : existing.download_mbps;
  const up = b.uploadMbps != null ? Number(b.uploadMbps) : existing.upload_mbps;
  const maxLimit = String(b.maxLimit ?? existing.max_limit ?? `${down}M/${up}M`);
  db.prepare('UPDATE ipoe_profiles SET name=?, download_mbps=?, upload_mbps=?, max_limit=? WHERE id=?').run(name, down, up, maxLimit, id);
  res.json(db.prepare('SELECT id, name, download_mbps AS downloadMbps, upload_mbps AS uploadMbps, max_limit AS maxLimit FROM ipoe_profiles WHERE id = ?').get(id));
});

app.delete('/api/ipoe/profiles/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM ipoe_profiles WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const inUse = db.prepare('SELECT COUNT(*) AS c FROM ipoe_plans WHERE profile_name = ?').get(existing.name) as { c: number };
  if (inUse.c > 0) return res.status(400).json({ error: `Profile is used by ${inUse.c} billing plan(s).` });
  db.prepare('DELETE FROM ipoe_profiles WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/ipoe/plans', (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT id, name, price, cycle, profile_name AS profile, download_mbps AS downloadMbps, upload_mbps AS uploadMbps FROM ipoe_plans ORDER BY name`
      )
      .all()
      .map((p: any) => ({
        ...p,
        speed: formatSpeedMbps(p.downloadMbps, p.uploadMbps),
      }))
  );
});

app.post('/api/ipoe/plans', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const profile = String(b.profile || b.profile_name || '').trim();
  let down = Number(b.downloadMbps) || 0;
  let up = Number(b.uploadMbps) || 0;
  if (profile) {
    const pr = db.prepare('SELECT * FROM ipoe_profiles WHERE name = ?').get(profile) as any;
    if (pr) {
      down = down || pr.download_mbps;
      up = up || pr.upload_mbps;
    }
  }
  try {
    const info = db
      .prepare(
        'INSERT INTO ipoe_plans (name, price, cycle, profile_name, download_mbps, upload_mbps) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(name, Number(b.price) || 0, String(b.cycle || 'Monthly'), profile || null, down, up);
    const row = db.prepare('SELECT id, name, price, cycle, profile_name AS profile, download_mbps AS downloadMbps, upload_mbps AS uploadMbps FROM ipoe_plans WHERE id = ?').get(info.lastInsertRowid) as any;
    res.status(201).json({ ...row, speed: formatSpeedMbps(row.downloadMbps, row.uploadMbps) });
  } catch {
    res.status(409).json({ error: 'Plan name already exists' });
  }
});

app.put('/api/ipoe/plans/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM ipoe_plans WHERE id = ?').get(id) as any;
  if (!existing) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const name = String(b.name ?? existing.name).trim();
  const profile = String(b.profile ?? existing.profile_name ?? '').trim();
  let down = b.downloadMbps != null ? Number(b.downloadMbps) : existing.download_mbps;
  let up = b.uploadMbps != null ? Number(b.uploadMbps) : existing.upload_mbps;
  if (profile && (b.profile != null || b.profile_name != null)) {
    const pr = db.prepare('SELECT * FROM ipoe_profiles WHERE name = ?').get(profile) as any;
    if (pr && b.downloadMbps == null) {
      down = pr.download_mbps;
      up = pr.upload_mbps;
    }
  }
  db.prepare(
    'UPDATE ipoe_plans SET name=?, price=?, cycle=?, profile_name=?, download_mbps=?, upload_mbps=? WHERE id=?'
  ).run(name, b.price != null ? Number(b.price) : existing.price, String(b.cycle ?? existing.cycle), profile || null, down, up, id);
  const row = db.prepare('SELECT id, name, price, cycle, profile_name AS profile, download_mbps AS downloadMbps, upload_mbps AS uploadMbps FROM ipoe_plans WHERE id = ?').get(id) as any;
  res.json({ ...row, speed: formatSpeedMbps(row.downloadMbps, row.uploadMbps) });
});

app.delete('/api/ipoe/plans/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM ipoe_plans WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---- Clients Map ----
// Derive a stable pseudo-value from a client id (so traffic/usage/ports look
// consistent between refreshes rather than jumping randomly).
function seeded(id: number, salt: number, mod: number) {
  return ((id * 2654435761 + salt * 40503) >>> 0) % mod;
}

app.get('/api/map', (req, res) => {
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  const naps = db.prepare(
    `SELECT id, name, kind, lat, lng, ports, parent_id AS parentId,
            code, status, address, splitter_ratio AS splitterRatio, pon_port AS ponPort
     FROM naps`
  ).all();
  const clientSql = `
      SELECT u.id, u.username, u.customer_name AS customer, u.status, u.online, u.lat, u.lng,
              u.nap_id AS napId, u.router_id AS routerId, u.service, u.account_number AS account,
              u.profile AS plan, u.subscription_due AS due, u.plc_port AS plcPort, u.address,
              n.name AS napName, n.parent_id AS oltId,
              o.name AS oltName,
              r.name AS serverName
       FROM pppoe_users u
       LEFT JOIN naps n ON n.id = u.nap_id
       LEFT JOIN naps o ON o.id = n.parent_id
       LEFT JOIN routers r ON r.id = u.router_id
       WHERE u.lat IS NOT NULL AND u.lng IS NOT NULL
       ${routerId ? 'AND u.router_id = ?' : ''}`;
  const clients = (routerId
    ? db.prepare(clientSql).all(routerId)
    : db.prepare(clientSql).all()) as any[];

  const oltPos = db.prepare("SELECT lat, lng FROM naps WHERE kind = 'olt' ORDER BY id LIMIT 1").get() as
    | { lat: number; lng: number }
    | undefined;
  const baseLat = oltPos?.lat ?? 15.1785;
  const baseLng = oltPos?.lng ?? 120.5945;
  const servers = (db.prepare('SELECT id, name, host, status, lat, lng, address FROM routers ORDER BY id').all() as any[]).map(
    (s, i) => ({
      id: s.id,
      name: s.name,
      host: s.host,
      status: s.status,
      address: s.address || '',
      lat: s.lat != null ? Number(s.lat) : baseLat - 0.0015 - i * 0.0006,
      lng: s.lng != null ? Number(s.lng) : baseLng - 0.0025 - i * 0.0004,
    })
  );
  clients.forEach((c) => {
    c.online = !!c.online;
    const napName = c.napName || '-';
    const oltName = c.oltName || 'OLT Main Server';
    const serverName = c.serverName || 'Main Server';
    const pon = (seeded(c.id, 1, 16) + 1); // upstream/PON port on the OLT
    const plc = c.plcPort ? Number(c.plcPort) : seeded(c.id, 2, 8) + 1;
    c.plcPort = plc;
    c.upstreamPort = pon;
    c.oltName = oltName;
    c.serverName = serverName;
    // Live-ish traffic (bps) and cumulative usage (GB), stable per client.
    c.rxBps = c.online ? 200 + seeded(c.id, 3, 900) + Math.floor(Math.random() * 120) : 0;
    c.txBps = c.online ? 500 + seeded(c.id, 4, 1600) + Math.floor(Math.random() * 200) : 0;
    c.rxGB = Number((0.5 + seeded(c.id, 5, 5000) / 500).toFixed(2));
    c.txGB = Number((10 + seeded(c.id, 6, 30000) / 100).toFixed(1));
    c.topology = `${serverName} > ${oltName} > PON${pon} > ${napName} > PLC${plc}`;
  });
  const totalClients = (db.prepare('SELECT COUNT(*) AS c FROM pppoe_users').get() as any).c;
  const withoutLocation = (db.prepare('SELECT COUNT(*) AS c FROM pppoe_users WHERE lat IS NULL').get() as any).c;
  const olts = (db.prepare("SELECT COUNT(*) AS c FROM naps WHERE kind = 'olt'").get() as any).c;
  const napCount = (db.prepare("SELECT COUNT(*) AS c FROM naps WHERE kind = 'nap'").get() as any).c;
  const onlineOnu = clients.filter((c) => c.online && c.status === 'Active').length;
  const offlineOnu = clients.filter((c) => c.status === 'Active' && !c.online).length;
  const connectors = (db.prepare('SELECT id, kind, from_id AS fromId, to_id AS toId, points FROM map_connectors').all() as any[]).map(
    (c) => ({ ...c, points: JSON.parse(c.points || '[]') })
  );
  res.json({
    naps,
    clients,
    servers,
    connectors,
    stats: { servers: servers.length, olts, naps: napCount, totalClients, withoutLocation, onlineOnu, offlineOnu },
  });
});

// ---- NAPs (for the Add-User NAP/PLC selector) ----
app.get('/api/naps', (req, res) => {
  const all = req.query.all === '1';
  const where = all ? '' : "WHERE n.kind = 'nap'";
  const rows = db
    .prepare(
      `SELECT n.id, n.name, n.kind, n.ports, n.lat, n.lng, n.parent_id AS parentId,
              n.code, n.status, n.address, n.splitter_ratio AS splitterRatio, n.pon_port AS ponPort,
              (SELECT name FROM naps o WHERE o.id = n.parent_id) AS oltName
       FROM naps n ${where} ORDER BY n.kind DESC, n.id`
    )
    .all();
  res.json(rows);
});

app.post('/api/naps', (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: 'name is required' });
  const info = db
    .prepare(
      `INSERT INTO naps (name, kind, lat, lng, ports, parent_id, code, status, address, splitter_ratio, pon_port)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(b.name).trim(),
      b.kind || 'nap',
      b.lat != null ? Number(b.lat) : null,
      b.lng != null ? Number(b.lng) : null,
      Number(b.ports) || 8,
      b.parentId ? Number(b.parentId) : null,
      b.code ? String(b.code).trim() : null,
      b.status || 'active',
      b.address ? String(b.address).trim() : null,
      b.splitterRatio ? String(b.splitterRatio).trim() : null,
      b.ponPort != null && b.ponPort !== '' ? Number(b.ponPort) : null
    );
  res.status(201).json(
    db
      .prepare(
        `SELECT id, name, kind, lat, lng, ports, parent_id AS parentId, code, status, address,
                splitter_ratio AS splitterRatio, pon_port AS ponPort FROM naps WHERE id = ?`
      )
      .get(info.lastInsertRowid)
  );
});

app.put('/api/naps/:id', (req, res) => {
  const id = Number(req.params.id);
  const ex = db.prepare('SELECT * FROM naps WHERE id = ?').get(id) as any;
  if (!ex) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  db.prepare(
    `UPDATE naps SET name=?, kind=?, lat=?, lng=?, ports=?, parent_id=?, code=?, status=?, address=?, splitter_ratio=?, pon_port=? WHERE id=?`
  ).run(
    b.name ?? ex.name,
    b.kind ?? ex.kind,
    b.lat != null ? Number(b.lat) : ex.lat,
    b.lng != null ? Number(b.lng) : ex.lng,
    b.ports != null ? Number(b.ports) : ex.ports,
    b.parentId !== undefined ? (b.parentId ? Number(b.parentId) : null) : ex.parent_id,
    b.code !== undefined ? (b.code ? String(b.code).trim() : null) : ex.code,
    b.status ?? ex.status ?? 'active',
    b.address !== undefined ? (b.address ? String(b.address).trim() : null) : ex.address,
    b.splitterRatio !== undefined
      ? b.splitterRatio
        ? String(b.splitterRatio).trim()
        : null
      : ex.splitter_ratio,
    b.ponPort !== undefined
      ? b.ponPort != null && b.ponPort !== ''
        ? Number(b.ponPort)
        : null
      : ex.pon_port,
    id
  );
  res.json(
    db
      .prepare(
        `SELECT id, name, kind, lat, lng, ports, parent_id AS parentId, code, status, address,
                splitter_ratio AS splitterRatio, pon_port AS ponPort FROM naps WHERE id = ?`
      )
      .get(id)
  );
});

app.delete('/api/naps/:id', (req, res) => {
  const id = Number(req.params.id);
  const used = (db.prepare('SELECT COUNT(*) AS c FROM pppoe_users WHERE nap_id = ?').get(id) as any).c;
  if (used > 0) return res.status(400).json({ error: 'NAP is assigned to clients. Reassign them first.' });
  const children = (db.prepare('SELECT COUNT(*) AS c FROM naps WHERE parent_id = ?').get(id) as any).c;
  if (children > 0) return res.status(400).json({ error: 'Remove child NAPs first.' });
  db.prepare('DELETE FROM naps WHERE id = ?').run(id);
  db.prepare('DELETE FROM map_connectors WHERE (kind = ? AND (from_id = ? OR to_id = ?)) OR (kind = ? AND (from_id = ? OR to_id = ?))').run(
    'olt-nap', id, id, 'nap-client', id, id
  );
  res.json({ ok: true });
});

/** Update map location / display fields for a server (router) without probing API. */
app.put('/api/map/servers/:id', (req, res) => {
  const id = Number(req.params.id);
  const ex = db.prepare('SELECT * FROM routers WHERE id = ?').get(id) as any;
  if (!ex) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  db.prepare('UPDATE routers SET name=?, status=?, lat=?, lng=?, address=? WHERE id=?').run(
    b.name != null ? String(b.name).trim() : ex.name,
    b.status != null ? String(b.status) : ex.status,
    b.lat != null && b.lat !== '' ? Number(b.lat) : ex.lat,
    b.lng != null && b.lng !== '' ? Number(b.lng) : ex.lng,
    b.address !== undefined ? (b.address ? String(b.address).trim() : null) : ex.address,
    id
  );
  res.json(db.prepare('SELECT id, name, host, status, lat, lng, address FROM routers WHERE id = ?').get(id));
});

// ---- Map cable connectors (editable street paths) ----
app.get('/api/map/connectors', (_req, res) => {
  const rows = db.prepare('SELECT id, kind, from_id AS fromId, to_id AS toId, points FROM map_connectors').all() as any[];
  res.json(rows.map((r) => ({ ...r, points: JSON.parse(r.points || '[]') })));
});

app.post('/api/map/connectors', (req, res) => {
  const b = req.body || {};
  const kind = String(b.kind || '');
  const fromId = Number(b.fromId);
  const toId = Number(b.toId);
  const points = b.points;
  if (!kind || !fromId || !toId || !Array.isArray(points) || points.length < 2) {
    return res.status(400).json({ error: 'kind, fromId, toId, and points (min 2) are required' });
  }
  const json = JSON.stringify(points);
  const ex = db.prepare('SELECT id FROM map_connectors WHERE kind = ? AND from_id = ? AND to_id = ?').get(kind, fromId, toId) as any;
  if (ex) {
    db.prepare('UPDATE map_connectors SET points = ? WHERE id = ?').run(json, ex.id);
    return res.json({ ok: true, id: ex.id });
  }
  const info = db.prepare('INSERT INTO map_connectors (kind, from_id, to_id, points) VALUES (?, ?, ?, ?)').run(kind, fromId, toId, json);
  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

app.delete('/api/map/connectors', (req, res) => {
  const kind = String(req.query.kind || '');
  const fromId = Number(req.query.fromId);
  const toId = Number(req.query.toId);
  if (!kind || !fromId || !toId) return res.status(400).json({ error: 'kind, fromId, toId required' });
  db.prepare('DELETE FROM map_connectors WHERE kind = ? AND from_id = ? AND to_id = ?').run(kind, fromId, toId);
  res.json({ ok: true });
});

// ---- MikroTik file manager ----
app.get('/api/files', async (req, res) => {
  const routerId = Number(req.query.routerId);
  const router = getRouter(routerId);
  if (!router) return res.status(400).json({ error: 'Router not found' });
  try {
    const files = await listRouterFiles(router);
    res.json({ router: router.name, live: true, files });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Could not list files from router' });
  }
});

app.delete('/api/files', async (req, res) => {
  const routerId = Number(req.query.routerId);
  const name = String(req.query.name || '');
  const router = getRouter(routerId);
  if (!router || !name) return res.status(400).json({ error: 'routerId and name are required' });
  try {
    await withRouter(router, (api) => api.write('/file/remove', [`=numbers=${name}`]));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Could not delete file' });
  }
});

app.post('/api/files/upload', async (req, res) => {
  const routerId = Number(req.body?.routerId);
  const name = String(req.body?.name || '').trim();
  const content = req.body?.content;
  const router = getRouter(routerId);
  if (!router || !name) return res.status(400).json({ error: 'routerId and name are required' });
  if (content == null) return res.status(400).json({ error: 'content is required' });
  const text = typeof content === 'string' ? content : Buffer.from(content, 'base64').toString('utf8');
  if (text.length > 64000) return res.status(400).json({ error: 'File too large (max 64KB via API)' });
  try {
    await withRouter(router, async (api) => {
      const existing = (await api.write('/file/print', [`?name=${name}`])) as any[];
      if (!existing?.length) {
        await api.write('/file/add', [`=name=${name}`]);
      }
      await api.write('/file/set', [`=name=${name}`, `=contents=${text}`]);
    });
    res.json({ ok: true, name });
  } catch (e: any) {
    res.status(502).json({ error: e?.message || 'Could not upload file' });
  }
});

// ---- Geocoding proxy (OpenStreetMap Nominatim) ----
app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'MT-Billing/1.0 (panel geocoder)' } });
    const data = (await r.json()) as any[];
    res.json(
      data.map((d) => ({ displayName: d.display_name, lat: Number(d.lat), lon: Number(d.lon) }))
    );
  } catch {
    res.status(502).json({ error: 'geocoding unavailable' });
  }
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
  db.prepare('UPDATE company SET name = ?, address = ?, phone = ?, email = ?, currency = ?, logo = ? WHERE id = 1').run(
    b.name ?? c.name,
    b.address ?? c.address,
    b.phone ?? c.phone,
    b.email ?? c.email,
    b.currency ?? c.currency,
    b.logo !== undefined ? b.logo : c.logo
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

// ---- Live interface traffic (dashboard graphs) ----
app.get('/api/interfaces', async (req, res) => {
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  if (routerId) {
    const router = getRouter(routerId);
    if (router?.host && router?.api_user) {
      try {
        const names = await fetchRouterInterfaceNames(router);
        return res.json({ names, source: 'router', routerId });
      } catch {
        return res.json({ names: [], source: 'router', routerId, error: 'unreachable' });
      }
    }
    return res.json({ names: [], source: 'router', routerId, error: 'not-configured' });
  }
  res.json({ names: getInterfaceNames(), source: 'panel' });
});

app.get('/api/interfaces/traffic', async (req, res) => {
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  const ifaces = String(req.query.ifaces || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (routerId) {
    const router = getRouter(routerId);
    if (router?.host && router?.api_user) {
      try {
        const names = ifaces.length ? ifaces : await fetchRouterInterfaceNames(router);
        const sample = names.slice(0, 12);
        const interfaces = await fetchRouterInterfaceTraffic(router, sample);
        return res.json({ t: Date.now(), interfaces, source: 'router', routerId });
      } catch {
        return res.json({ t: Date.now(), interfaces: [], source: 'router', routerId, error: 'unreachable' });
      }
    }
    return res.json({ t: Date.now(), interfaces: [], source: 'router', routerId, error: 'not-configured' });
  }

  res.json({ ...getTrafficSnapshot(), source: 'panel' });
});

// ---- Email/SMS notifications & reminders ----
app.get('/api/clients', (_req, res) => {
  res.json(
    db
      .prepare('SELECT id, username, customer_name AS customer, email, contact, service, status FROM pppoe_users ORDER BY customer_name')
      .all()
  );
});

app.get('/api/notifications', (_req, res) => {
  res.json(listNotifications());
});

app.get('/api/notifications/settings', (_req, res) => {
  res.json(getNotifySettings());
});

app.put('/api/notifications/settings', (req, res) => {
  res.json(updateNotifySettings(req.body || {}));
});

// Manual send to all clients (email/sms/both) or a single client.
app.post('/api/notifications/send', async (req, res) => {
  const b = req.body || {};
  if (!b.message) return res.status(400).json({ error: 'message is required' });
  const target = b.target === 'client' ? 'client' : b.target === 'selected' ? 'selected' : 'all';
  const result = await sendManual({
    channel: b.channel || 'email',
    target,
    clientId: b.clientId ? Number(b.clientId) : undefined,
    clientIds: Array.isArray(b.clientIds) ? b.clientIds.map((x: any) => Number(x)) : undefined,
    subject: b.subject,
    message: b.message,
  });
  res.json(result);
});

// Run the reminder + auto-disable automations immediately (also runs on a timer).
app.post('/api/notifications/run', async (_req, res) => {
  const summary = await runAutomations();
  res.json(summary);
});

app.use('/api', settingsRouter);
app.use('/api', aiRouter);
app.use('/api', terminalRouter);
app.use('/api', extraRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
initTerminalWs(server);

server.listen(PORT, () => {
  console.log(`MT-Billing API listening on http://localhost:${PORT}`);
  startUptime(60000);
  startNotifyScheduler(5 * 60 * 1000);
});

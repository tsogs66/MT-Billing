/**
 * Status Hub — Uptime-Kuma-style service monitoring with SQLite heartbeats,
 * grouped internet/gaming targets, manual monitors, and uplink probes via
 * external reference servers. Optional Prometheus text metrics export.
 */
import dns from 'dns';
import net from 'net';
import { performance } from 'perf_hooks';
import { db } from './db.js';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* Node < 17 */
}

const HEARTBEAT_KEEP = 120;
const DEFAULT_INTERVAL_SEC = 60;
const PROBE_TIMEOUT_MS = 12_000;
const CONCURRENCY = 8;

export type MonitorType = 'http' | 'tcp' | 'ping';
export type HeartbeatStatus = 'up' | 'down' | 'degraded' | 'pending';

type GroupSeed = { slug: string; name: string; sort: number; icon: string };
type MonitorSeed = {
  group: string;
  name: string;
  url: string;
  type?: MonitorType;
  interval?: number;
};

const GROUP_SEEDS: GroupSeed[] = [
  { slug: 'web', name: 'Web & Search', sort: 10, icon: 'globe' },
  { slug: 'social', name: 'Social', sort: 20, icon: 'users' },
  { slug: 'streaming', name: 'Streaming & Media', sort: 30, icon: 'play' },
  { slug: 'games', name: 'Games & Platforms', sort: 40, icon: 'gamepad' },
  { slug: 'comms', name: 'Communication', sort: 50, icon: 'message' },
  { slug: 'cloud', name: 'Cloud & Infrastructure', sort: 60, icon: 'cloud' },
  { slug: 'dns', name: 'DNS & Connectivity', sort: 70, icon: 'network' },
  { slug: 'finance', name: 'Finance & Commerce', sort: 80, icon: 'wallet' },
  { slug: 'custom', name: 'Custom Monitors', sort: 90, icon: 'plus' },
];

const MONITOR_SEEDS: MonitorSeed[] = [
  // Web
  { group: 'web', name: 'Google', url: 'https://www.google.com/generate_204' },
  { group: 'web', name: 'Bing', url: 'https://www.bing.com' },
  { group: 'web', name: 'Wikipedia', url: 'https://www.wikipedia.org' },
  { group: 'web', name: 'DuckDuckGo', url: 'https://duckduckgo.com' },
  // Social
  { group: 'social', name: 'Facebook', url: 'https://www.facebook.com' },
  { group: 'social', name: 'Instagram', url: 'https://www.instagram.com' },
  { group: 'social', name: 'X (Twitter)', url: 'https://x.com' },
  { group: 'social', name: 'TikTok', url: 'https://www.tiktok.com' },
  { group: 'social', name: 'Reddit', url: 'https://www.reddit.com' },
  { group: 'social', name: 'LinkedIn', url: 'https://www.linkedin.com' },
  // Streaming
  { group: 'streaming', name: 'YouTube', url: 'https://www.youtube.com' },
  { group: 'streaming', name: 'Netflix', url: 'https://www.netflix.com' },
  { group: 'streaming', name: 'Twitch', url: 'https://www.twitch.tv' },
  { group: 'streaming', name: 'Spotify', url: 'https://www.spotify.com' },
  { group: 'streaming', name: 'Disney+', url: 'https://www.disneyplus.com' },
  { group: 'streaming', name: 'Apple Music', url: 'https://music.apple.com' },
  // Games
  { group: 'games', name: 'Steam', url: 'https://store.steampowered.com' },
  { group: 'games', name: 'Epic Games', url: 'https://store.epicgames.com' },
  { group: 'games', name: 'Xbox / Microsoft', url: 'https://www.xbox.com' },
  { group: 'games', name: 'PlayStation Network', url: 'https://www.playstation.com' },
  { group: 'games', name: 'Nintendo', url: 'https://www.nintendo.com' },
  { group: 'games', name: 'Roblox', url: 'https://www.roblox.com' },
  { group: 'games', name: 'Minecraft', url: 'https://www.minecraft.net' },
  { group: 'games', name: 'Riot Games', url: 'https://www.riotgames.com' },
  { group: 'games', name: 'Valorant', url: 'https://playvalorant.com' },
  { group: 'games', name: 'League of Legends', url: 'https://www.leagueoflegends.com' },
  { group: 'games', name: 'Fortnite', url: 'https://www.fortnite.com' },
  { group: 'games', name: 'Mobile Legends', url: 'https://www.mobilelegends.com' },
  { group: 'games', name: 'Genshin Impact', url: 'https://genshin.hoyoverse.com' },
  { group: 'games', name: 'EA / Origin', url: 'https://www.ea.com' },
  { group: 'games', name: 'Battle.net', url: 'https://battle.net' },
  // Comms
  { group: 'comms', name: 'Discord', url: 'https://discord.com' },
  { group: 'comms', name: 'WhatsApp', url: 'https://www.whatsapp.com' },
  { group: 'comms', name: 'Telegram', url: 'https://telegram.org' },
  { group: 'comms', name: 'Zoom', url: 'https://zoom.us' },
  { group: 'comms', name: 'Slack', url: 'https://slack.com' },
  { group: 'comms', name: 'Gmail', url: 'https://mail.google.com' },
  { group: 'comms', name: 'Microsoft Teams', url: 'https://teams.microsoft.com' },
  // Cloud
  { group: 'cloud', name: 'Cloudflare', url: 'https://www.cloudflare.com' },
  { group: 'cloud', name: 'AWS Health', url: 'https://health.aws.amazon.com/health/status' },
  { group: 'cloud', name: 'Google Cloud', url: 'https://cloud.google.com' },
  { group: 'cloud', name: 'Azure', url: 'https://azure.microsoft.com' },
  { group: 'cloud', name: 'GitHub', url: 'https://github.com' },
  { group: 'cloud', name: 'GitLab', url: 'https://gitlab.com' },
  { group: 'cloud', name: 'DigitalOcean', url: 'https://www.digitalocean.com' },
  { group: 'cloud', name: 'Vercel', url: 'https://vercel.com' },
  // DNS
  { group: 'dns', name: 'Cloudflare DNS (1.1.1.1)', url: 'https://1.1.1.1/cdn-cgi/trace' },
  { group: 'dns', name: 'Google DNS', url: 'https://dns.google/resolve?name=example.com&type=A' },
  { group: 'dns', name: 'Quad9 DNS', url: 'https://dns.quad9.net:5053/dns-query?name=example.com&type=A' },
  { group: 'dns', name: 'OpenDNS', url: 'https://www.opendns.com' },
  // Finance
  { group: 'finance', name: 'PayPal', url: 'https://www.paypal.com' },
  { group: 'finance', name: 'Stripe', url: 'https://stripe.com' },
  { group: 'finance', name: 'Amazon', url: 'https://www.amazon.com' },
  { group: 'finance', name: 'eBay', url: 'https://www.ebay.com' },
];

/** External reference endpoints used to characterize local uplink quality. */
const UPLINK_SEEDS: { slug: string; name: string; region: string; url: string; kind: string }[] = [
  { slug: 'cf-trace-global', name: 'Cloudflare Trace', region: 'Global Anycast', url: 'https://1.1.1.1/cdn-cgi/trace', kind: 'http' },
  { slug: 'cf-ok', name: 'Cloudflare Connectivity', region: 'Global Anycast', url: 'https://cloudflare.com/cdn-cgi/trace', kind: 'http' },
  { slug: 'google-204', name: 'Google generate_204', region: 'Global Anycast', url: 'https://www.google.com/generate_204', kind: 'http' },
  { slug: 'google-dns', name: 'Google Public DNS', region: 'Global Anycast', url: 'https://dns.google/resolve?name=cloudflare.com&type=A', kind: 'http' },
  { slug: 'quad9', name: 'Quad9 DNS API', region: 'Global Anycast', url: 'https://dns.quad9.net:5053/dns-query?name=example.com&type=A', kind: 'http' },
  { slug: 'apple-captive', name: 'Apple Captive Portal', region: 'Global', url: 'https://captive.apple.com/hotspot-detect.html', kind: 'http' },
  { slug: 'msft-ncsi', name: 'Microsoft NCSI', region: 'Global', url: 'http://www.msftconnecttest.com/connecttest.txt', kind: 'http' },
  { slug: 'ifconfig-me', name: 'ifconfig.me (egress IP)', region: 'External Echo', url: 'https://ifconfig.me/ip', kind: 'http' },
  { slug: 'icanhazip', name: 'icanhazip.com', region: 'External Echo', url: 'https://icanhazip.com', kind: 'http' },
  { slug: 'ipify', name: 'ipify.org', region: 'External Echo', url: 'https://api.ipify.org?format=text', kind: 'http' },
];

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastRunAt: number | null = null;
let lastUplinkRunAt: number | null = null;

function columnExists(table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === col);
}

export function initStatusHub() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS status_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      icon TEXT DEFAULT 'globe'
    );
    CREATE TABLE IF NOT EXISTS status_monitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT DEFAULT 'http',
      interval_sec INTEGER DEFAULT 60,
      enabled INTEGER DEFAULT 1,
      builtin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(group_id) REFERENCES status_groups(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS status_heartbeats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      latency_ms REAL,
      code INTEGER,
      error TEXT,
      checked_at INTEGER NOT NULL,
      FOREIGN KEY(monitor_id) REFERENCES status_monitors(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_status_hb_monitor ON status_heartbeats(monitor_id, checked_at DESC);
    CREATE TABLE IF NOT EXISTS status_uplink_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      region TEXT,
      url TEXT NOT NULL,
      kind TEXT DEFAULT 'http',
      enabled INTEGER DEFAULT 1,
      builtin INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS status_uplink_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      latency_ms REAL,
      code INTEGER,
      body_snip TEXT,
      error TEXT,
      checked_at INTEGER NOT NULL,
      FOREIGN KEY(target_id) REFERENCES status_uplink_targets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_status_uplink_res ON status_uplink_results(target_id, checked_at DESC);
    CREATE TABLE IF NOT EXISTS status_uplink_hosts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 443,
      type TEXT DEFAULT 'tcp',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS status_uplink_host_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      latency_ms REAL,
      error TEXT,
      checked_at INTEGER NOT NULL,
      FOREIGN KEY(host_id) REFERENCES status_uplink_hosts(id) ON DELETE CASCADE
    );
  `);

  seedGroupsAndMonitors();
  seedUplinkTargets();
}

function seedGroupsAndMonitors() {
  const insGroup = db.prepare(
    'INSERT OR IGNORE INTO status_groups (slug, name, sort_order, icon) VALUES (?, ?, ?, ?)'
  );
  for (const g of GROUP_SEEDS) {
    insGroup.run(g.slug, g.name, g.sort, g.icon);
  }

  const groupId = (slug: string) =>
    (db.prepare('SELECT id FROM status_groups WHERE slug = ?').get(slug) as { id: number } | undefined)?.id;

  const exists = db.prepare(
    'SELECT id FROM status_monitors WHERE builtin = 1 AND name = ? AND url = ?'
  );
  const ins = db.prepare(`
    INSERT INTO status_monitors (group_id, name, url, type, interval_sec, enabled, builtin)
    VALUES (?, ?, ?, ?, ?, 1, 1)
  `);

  const countBuiltin = (db.prepare('SELECT COUNT(*) AS c FROM status_monitors WHERE builtin = 1').get() as { c: number }).c;
  if (countBuiltin > 0) return;

  for (const m of MONITOR_SEEDS) {
    const gid = groupId(m.group);
    if (!gid) continue;
    if (exists.get(m.name, m.url)) continue;
    ins.run(gid, m.name, m.url, m.type || 'http', m.interval || DEFAULT_INTERVAL_SEC);
  }
}

function seedUplinkTargets() {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM status_uplink_targets').get() as { c: number }).c;
  if (count > 0) return;
  const ins = db.prepare(`
    INSERT INTO status_uplink_targets (slug, name, region, url, kind, enabled, builtin)
    VALUES (?, ?, ?, ?, ?, 1, 1)
  `);
  for (const t of UPLINK_SEEDS) {
    ins.run(t.slug, t.name, t.region, t.url, t.kind);
  }
}

async function probeHttp(url: string): Promise<{ status: HeartbeatStatus; ms: number; code: number; error?: string; body?: string }> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'User-Agent': 'MT-Billing-StatusHub/1.0',
        Accept: '*/*',
      },
    });
    const ms = Math.round(performance.now() - t0);
    let body = '';
    try {
      body = (await res.text()).slice(0, 200).trim();
    } catch {
      /* ignore */
    }
    const ok = res.status > 0 && res.status < 500;
    const status: HeartbeatStatus = !ok ? 'down' : ms > 2500 ? 'degraded' : 'up';
    return { status, ms, code: res.status, body };
  } catch (e: any) {
    const ms = Math.round(performance.now() - t0);
    return { status: 'down', ms, code: 0, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e) };
  } finally {
    clearTimeout(to);
  }
}

function probeTcp(host: string, port: number): Promise<{ status: HeartbeatStatus; ms: number; error?: string }> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const socket = net.connect({ host, port }, () => {
      const ms = Math.round(performance.now() - t0);
      socket.destroy();
      resolve({ status: ms > 2500 ? 'degraded' : 'up', ms });
    });
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ status: 'down', ms: Math.round(performance.now() - t0), error: 'timeout' });
    });
    socket.on('error', (err) => {
      resolve({ status: 'down', ms: Math.round(performance.now() - t0), error: err.message });
    });
  });
}

function parseTarget(url: string, type: MonitorType): { kind: 'http' | 'tcp'; host?: string; port?: number; url?: string } {
  if (type === 'tcp' || type === 'ping') {
    try {
      if (url.includes('://')) {
        const u = new URL(url);
        return { kind: 'tcp', host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) };
      }
      const [host, portStr] = url.split(':');
      return { kind: 'tcp', host, port: Number(portStr || 443) };
    } catch {
      return { kind: 'tcp', host: url, port: 443 };
    }
  }
  return { kind: 'http', url };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function pruneHeartbeats(monitorId: number) {
  db.prepare(`
    DELETE FROM status_heartbeats
    WHERE monitor_id = ? AND id NOT IN (
      SELECT id FROM status_heartbeats WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?
    )
  `).run(monitorId, monitorId, HEARTBEAT_KEEP);
}

function recordHeartbeat(monitorId: number, status: HeartbeatStatus, latencyMs: number | null, code: number | null, error?: string) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO status_heartbeats (monitor_id, status, latency_ms, code, error, checked_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(monitorId, status, latencyMs, code, error || null, now);
  pruneHeartbeats(monitorId);
}

export async function runStatusChecks(monitorIds?: number[]) {
  if (running) return { skipped: true };
  running = true;
  try {
    let rows: any[];
    if (monitorIds?.length) {
      const placeholders = monitorIds.map(() => '?').join(',');
      rows = db.prepare(`SELECT * FROM status_monitors WHERE enabled = 1 AND id IN (${placeholders})`).all(...monitorIds);
    } else {
      rows = db.prepare('SELECT * FROM status_monitors WHERE enabled = 1').all();
    }

    await mapPool(rows, CONCURRENCY, async (m) => {
      const parsed = parseTarget(m.url, m.type as MonitorType);
      if (parsed.kind === 'tcp' && parsed.host) {
        const r = await probeTcp(parsed.host, parsed.port || 443);
        recordHeartbeat(m.id, r.status, r.ms, null, r.error);
      } else {
        const r = await probeHttp(parsed.url || m.url);
        recordHeartbeat(m.id, r.status, r.ms, r.code, r.error);
      }
    });
    lastRunAt = Date.now();
    return { ok: true, checked: rows.length, at: lastRunAt };
  } finally {
    running = false;
  }
}

function pruneUplinkResults(targetId: number) {
  db.prepare(`
    DELETE FROM status_uplink_results
    WHERE target_id = ? AND id NOT IN (
      SELECT id FROM status_uplink_results WHERE target_id = ? ORDER BY checked_at DESC LIMIT 60
    )
  `).run(targetId, targetId);
}

export async function runUplinkChecks() {
  const targets = db.prepare('SELECT * FROM status_uplink_targets WHERE enabled = 1').all() as any[];
  await mapPool(targets, CONCURRENCY, async (t) => {
    const r = await probeHttp(t.url);
    db.prepare(`
      INSERT INTO status_uplink_results (target_id, status, latency_ms, code, body_snip, error, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(t.id, r.status, r.ms, r.code, r.body || null, r.error || null, Date.now());
    pruneUplinkResults(t.id);
  });

  const hosts = db.prepare('SELECT * FROM status_uplink_hosts WHERE enabled = 1').all() as any[];
  await mapPool(hosts, CONCURRENCY, async (h) => {
    const r = await probeTcp(h.host, h.port || 443);
    db.prepare(`
      INSERT INTO status_uplink_host_results (host_id, status, latency_ms, error, checked_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(h.id, r.status, r.ms, r.error || null, Date.now());
    db.prepare(`
      DELETE FROM status_uplink_host_results
      WHERE host_id = ? AND id NOT IN (
        SELECT id FROM status_uplink_host_results WHERE host_id = ? ORDER BY checked_at DESC LIMIT 60
      )
    `).run(h.id, h.id);
  });

  lastUplinkRunAt = Date.now();
  return { ok: true, targets: targets.length, hosts: hosts.length, at: lastUplinkRunAt };
}

function latestHeartbeat(monitorId: number) {
  return db.prepare(`
    SELECT status, latency_ms AS latencyMs, code, error, checked_at AS checkedAt
    FROM status_heartbeats WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1
  `).get(monitorId) as any;
}

function heartbeatHistory(monitorId: number, limit = 48) {
  return db.prepare(`
    SELECT status, latency_ms AS latencyMs, code, checked_at AS t
    FROM status_heartbeats WHERE monitor_id = ?
    ORDER BY checked_at DESC LIMIT ?
  `).all(monitorId, limit).reverse() as any[];
}

function uptimePct(monitorId: number): number {
  const rows = db.prepare(`
    SELECT status FROM status_heartbeats WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 100
  `).all(monitorId) as { status: string }[];
  if (!rows.length) return 100;
  const up = rows.filter((r) => r.status === 'up' || r.status === 'degraded').length;
  return Math.round((up / rows.length) * 1000) / 10;
}

export function listStatusOverview() {
  const groups = db.prepare('SELECT id, slug, name, sort_order AS sortOrder, icon FROM status_groups ORDER BY sort_order, name').all() as any[];
  const monitors = db.prepare(`
    SELECT m.id, m.group_id AS groupId, m.name, m.url, m.type, m.interval_sec AS intervalSec,
           m.enabled, m.builtin, g.slug AS groupSlug, g.name AS groupName
    FROM status_monitors m
    JOIN status_groups g ON g.id = m.group_id
    ORDER BY g.sort_order, m.name
  `).all() as any[];

  const enriched = monitors.map((m) => {
    const last = latestHeartbeat(m.id);
    const history = heartbeatHistory(m.id, 40);
    return {
      ...m,
      enabled: !!m.enabled,
      builtin: !!m.builtin,
      status: (last?.status as HeartbeatStatus) || 'pending',
      latencyMs: last?.latencyMs ?? null,
      code: last?.code ?? null,
      lastError: last?.error ?? null,
      lastChecked: last?.checkedAt ?? null,
      uptimePct: uptimePct(m.id),
      history: history.map((h) => ({
        t: h.t,
        up: h.status === 'up' || h.status === 'degraded',
        status: h.status,
        ms: h.latencyMs,
      })),
    };
  });

  const summary = {
    total: enriched.length,
    up: enriched.filter((m) => m.status === 'up').length,
    degraded: enriched.filter((m) => m.status === 'degraded').length,
    down: enriched.filter((m) => m.status === 'down').length,
    pending: enriched.filter((m) => m.status === 'pending').length,
    avgMs: (() => {
      const vals = enriched.map((m) => m.latencyMs).filter((v): v is number => typeof v === 'number');
      if (!vals.length) return null;
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    })(),
    lastRunAt,
  };

  return { groups, monitors: enriched, summary };
}

export function listUplinkOverview() {
  const targets = db.prepare(`
    SELECT id, slug, name, region, url, kind, enabled, builtin FROM status_uplink_targets ORDER BY name
  `).all() as any[];

  const enrichedTargets = targets.map((t) => {
    const last = db.prepare(`
      SELECT status, latency_ms AS latencyMs, code, body_snip AS bodySnip, error, checked_at AS checkedAt
      FROM status_uplink_results WHERE target_id = ? ORDER BY checked_at DESC LIMIT 1
    `).get(t.id) as any;
    const history = db.prepare(`
      SELECT status, latency_ms AS latencyMs, checked_at AS t
      FROM status_uplink_results WHERE target_id = ? ORDER BY checked_at DESC LIMIT 30
    `).all(t.id).reverse() as any[];
    return {
      ...t,
      enabled: !!t.enabled,
      builtin: !!t.builtin,
      status: last?.status || 'pending',
      latencyMs: last?.latencyMs ?? null,
      code: last?.code ?? null,
      bodySnip: last?.bodySnip ?? null,
      lastError: last?.error ?? null,
      lastChecked: last?.checkedAt ?? null,
      history: history.map((h) => ({ t: h.t, up: h.status === 'up' || h.status === 'degraded', ms: h.latencyMs, status: h.status })),
    };
  });

  const hosts = db.prepare('SELECT id, label, host, port, type, enabled FROM status_uplink_hosts ORDER BY id DESC').all() as any[];
  const enrichedHosts = hosts.map((h) => {
    const last = db.prepare(`
      SELECT status, latency_ms AS latencyMs, error, checked_at AS checkedAt
      FROM status_uplink_host_results WHERE host_id = ? ORDER BY checked_at DESC LIMIT 1
    `).get(h.id) as any;
    return {
      ...h,
      enabled: !!h.enabled,
      status: last?.status || 'pending',
      latencyMs: last?.latencyMs ?? null,
      lastError: last?.error ?? null,
      lastChecked: last?.checkedAt ?? null,
    };
  });

  // Best-effort public egress IP from echo services
  let publicIp: string | null = null;
  for (const t of enrichedTargets) {
    if (!t.bodySnip) continue;
    if (['ifconfig-me', 'icanhazip', 'ipify'].includes(t.slug)) {
      const ip = String(t.bodySnip).trim().split(/\s+/)[0];
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.includes(':')) {
        publicIp = ip;
        break;
      }
    }
  }

  const latencies = enrichedTargets.map((t) => t.latencyMs).filter((v): v is number => typeof v === 'number');
  const summary = {
    publicIp,
    total: enrichedTargets.length,
    up: enrichedTargets.filter((t) => t.status === 'up').length,
    degraded: enrichedTargets.filter((t) => t.status === 'degraded').length,
    down: enrichedTargets.filter((t) => t.status === 'down').length,
    avgMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    lastRunAt: lastUplinkRunAt,
  };

  return { targets: enrichedTargets, hosts: enrichedHosts, summary };
}

export function createMonitor(input: {
  name: string;
  url: string;
  groupSlug?: string;
  type?: MonitorType;
  intervalSec?: number;
}) {
  const name = String(input.name || '').trim();
  const url = String(input.url || '').trim();
  if (!name || !url) throw new Error('Name and URL are required');
  const slug = input.groupSlug || 'custom';
  let group = db.prepare('SELECT id FROM status_groups WHERE slug = ?').get(slug) as { id: number } | undefined;
  if (!group) {
    db.prepare('INSERT INTO status_groups (slug, name, sort_order, icon) VALUES (?, ?, ?, ?)').run(
      'custom',
      'Custom Monitors',
      90,
      'plus'
    );
    group = db.prepare('SELECT id FROM status_groups WHERE slug = ?').get('custom') as { id: number };
  }
  const type = (input.type || 'http') as MonitorType;
  const interval = Math.max(30, Number(input.intervalSec) || DEFAULT_INTERVAL_SEC);
  const info = db.prepare(`
    INSERT INTO status_monitors (group_id, name, url, type, interval_sec, enabled, builtin)
    VALUES (?, ?, ?, ?, ?, 1, 0)
  `).run(group.id, name, url, type, interval);
  return db.prepare('SELECT * FROM status_monitors WHERE id = ?').get(info.lastInsertRowid);
}

export function deleteMonitor(id: number) {
  const row = db.prepare('SELECT id, builtin FROM status_monitors WHERE id = ?').get(id) as any;
  if (!row) throw new Error('Monitor not found');
  if (row.builtin) throw new Error('Built-in monitors cannot be deleted (disable instead)');
  db.prepare('DELETE FROM status_heartbeats WHERE monitor_id = ?').run(id);
  db.prepare('DELETE FROM status_monitors WHERE id = ?').run(id);
}

export function setMonitorEnabled(id: number, enabled: boolean) {
  const info = db.prepare('UPDATE status_monitors SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  if (!info.changes) throw new Error('Monitor not found');
}

export function createUplinkHost(input: { label: string; host: string; port?: number; type?: string }) {
  const label = String(input.label || '').trim();
  const host = String(input.host || '').trim().replace(/^https?:\/\//, '').split('/')[0];
  if (!label || !host) throw new Error('Label and host/IP are required');
  let port = Number(input.port);
  let hostname = host;
  if (host.includes(':') && !host.includes('::')) {
    const parts = host.split(':');
    hostname = parts[0];
    if (!port) port = Number(parts[1]);
  }
  if (!port || Number.isNaN(port)) port = 443;
  const info = db.prepare(`
    INSERT INTO status_uplink_hosts (label, host, port, type, enabled)
    VALUES (?, ?, ?, ?, 1)
  `).run(label, hostname, port, input.type || 'tcp');
  return db.prepare('SELECT * FROM status_uplink_hosts WHERE id = ?').get(info.lastInsertRowid);
}

export function deleteUplinkHost(id: number) {
  db.prepare('DELETE FROM status_uplink_host_results WHERE host_id = ?').run(id);
  const info = db.prepare('DELETE FROM status_uplink_hosts WHERE id = ?').run(id);
  if (!info.changes) throw new Error('Host not found');
}

/** Prometheus / OpenMetrics text exposition for optional Grafana scraping. */
export function prometheusMetrics(): string {
  const overview = listStatusOverview();
  const uplink = listUplinkOverview();
  const lines: string[] = [
    '# HELP status_hub_monitor_up 1 if monitor is up',
    '# TYPE status_hub_monitor_up gauge',
  ];
  for (const m of overview.monitors) {
    const labels = `id="${m.id}",name="${escapeLabel(m.name)}",group="${escapeLabel(m.groupSlug)}"`;
    lines.push(`status_hub_monitor_up{${labels}} ${m.status === 'up' || m.status === 'degraded' ? 1 : 0}`);
    if (m.latencyMs != null) {
      lines.push(`status_hub_monitor_latency_ms{${labels}} ${m.latencyMs}`);
    }
    lines.push(`status_hub_monitor_uptime_pct{${labels}} ${m.uptimePct}`);
  }
  lines.push('# HELP status_hub_uplink_latency_ms Latency to external uplink probe');
  lines.push('# TYPE status_hub_uplink_latency_ms gauge');
  for (const t of uplink.targets) {
    if (t.latencyMs == null) continue;
    lines.push(
      `status_hub_uplink_latency_ms{slug="${escapeLabel(t.slug)}",name="${escapeLabel(t.name)}",region="${escapeLabel(t.region || '')}"} ${t.latencyMs}`
    );
  }
  lines.push(`status_hub_last_run_timestamp ${lastRunAt ? Math.floor(lastRunAt / 1000) : 0}`);
  lines.push(`status_hub_uplink_last_run_timestamp ${lastUplinkRunAt ? Math.floor(lastUplinkRunAt / 1000) : 0}`);
  return lines.join('\n') + '\n';
}

function escapeLabel(s: string) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

export function startStatusHub(intervalMs = 60_000) {
  initStatusHub();
  // Warm caches without blocking listen
  setTimeout(() => {
    runStatusChecks().catch(() => undefined);
    runUplinkChecks().catch(() => undefined);
  }, 2500);
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    runStatusChecks().catch(() => undefined);
    runUplinkChecks().catch(() => undefined);
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

// silence unused helper warning in strict builds
void columnExists;

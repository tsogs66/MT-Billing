import { db } from './db.js';
import {
  fetchPppActive,
  fetchPppActiveTraffic,
  fetchPppInterfaceBytes,
  fetchDnsCacheNames,
  parseRosRate,
} from './mikrotik.js';
import { notifyClientChannels } from './notify.js';

/** Map hostnames / domains to platform / service categories. */
const SERVICE_RULES: { id: string; name: string; category: string; match: RegExp }[] = [
  { id: 'youtube', name: 'YouTube', category: 'Video & Streaming', match: /youtube|youtu\.be|googlevideo|ytimg/i },
  { id: 'netflix', name: 'Netflix', category: 'Video & Streaming', match: /netflix|nflx/i },
  { id: 'facebook', name: 'Facebook', category: 'Social', match: /facebook|fbcdn|fb\.com/i },
  { id: 'instagram', name: 'Instagram', category: 'Social', match: /instagram|cdninstagram/i },
  { id: 'tiktok', name: 'TikTok', category: 'Social', match: /tiktok|musical\.ly|byteoversea|ibytedance/i },
  { id: 'x', name: 'X (Twitter)', category: 'Social', match: /twitter|twimg|t\.co|x\.com/i },
  { id: 'discord', name: 'Discord', category: 'Communication', match: /discord/i },
  { id: 'whatsapp', name: 'WhatsApp', category: 'Communication', match: /whatsapp|wa\.me/i },
  { id: 'zoom', name: 'Zoom', category: 'Communication', match: /zoom\.(us|com)/i },
  { id: 'google', name: 'Google', category: 'Web & Search', match: /google|gstatic|googleapis|gmail/i },
  { id: 'cloudflare', name: 'Cloudflare', category: 'Infrastructure', match: /cloudflare|1\.1\.1\.1/i },
  { id: 'steam', name: 'Steam', category: 'Games', match: /steampowered|steamcommunity|steamstatic/i },
  { id: 'roblox', name: 'Roblox', category: 'Games', match: /roblox/i },
  { id: 'riot', name: 'Riot Games', category: 'Games', match: /riotgames|leagueoflegends|valorant/i },
  { id: 'mlbb', name: 'Mobile Legends', category: 'Games', match: /mobilelegends|moonton/i },
  { id: 'shopee', name: 'Shopee', category: 'Shopping', match: /shopee/i },
  { id: 'lazada', name: 'Lazada', category: 'Shopping', match: /lazada/i },
  { id: 'gcash', name: 'GCash', category: 'Finance', match: /gcash|globe\.com\.ph/i },
  { id: 'maya', name: 'Maya', category: 'Finance', match: /maya\.ph|paymaya/i },
  { id: 'spotify', name: 'Spotify', category: 'Video & Streaming', match: /spotify/i },
  { id: 'amazon', name: 'Amazon', category: 'Shopping', match: /amazon|aws\./i },
  { id: 'microsoft', name: 'Microsoft', category: 'Web & Search', match: /microsoft|office\.com|live\.com|xbox/i },
  { id: 'apple', name: 'Apple', category: 'Web & Search', match: /apple\.com|icloud|mzstatic/i },
];

function classifyHost(name: string): { id: string; name: string; category: string } {
  for (const r of SERVICE_RULES) {
    if (r.match.test(name)) return { id: r.id, name: r.name, category: r.category };
  }
  return { id: 'other', name: 'Other services', category: 'Other' };
}

export function getFairUseSettings() {
  ensureFairUseRow();
  return db.prepare('SELECT * FROM fair_use_settings WHERE id = 1').get() as any;
}

export function updateFairUseSettings(patch: Record<string, any>) {
  ensureFairUseRow();
  const cur = getFairUseSettings() as Record<string, any>;
  const fields = ['enabled', 'cap_percent', 'sustain_minutes', 'notify_email', 'notify_sms'];
  for (const f of fields) {
    if (f in patch) cur[f] = patch[f];
  }
  db.prepare(
    `UPDATE fair_use_settings SET enabled=?, cap_percent=?, sustain_minutes=?, notify_email=?, notify_sms=? WHERE id=1`
  ).run(
    cur.enabled ? 1 : 0,
    Math.max(50, Math.min(100, Number(cur.cap_percent) || 95)),
    Math.max(1, Number(cur.sustain_minutes) || 10),
    cur.notify_email ? 1 : 0,
    cur.notify_sms ? 1 : 0
  );
  return getFairUseSettings();
}

function ensureFairUseRow() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fair_use_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER DEFAULT 1,
      cap_percent INTEGER DEFAULT 95,
      sustain_minutes INTEGER DEFAULT 10,
      notify_email INTEGER DEFAULT 1,
      notify_sms INTEGER DEFAULT 0
    );
  `);
  if (!(db.prepare('SELECT 1 FROM fair_use_settings WHERE id = 1').get())) {
    db.prepare('INSERT INTO fair_use_settings (id) VALUES (1)').run();
  }
}

function todayLocal(): string {
  return new Date().toISOString().slice(0, 10);
}

/** In-memory sustained-overage tracker: username → first breach timestamp */
const overCapSince = new Map<string, number>();

export async function pollUsageAndFairUse() {
  ensureUsageTables();
  const settings = getFairUseSettings();
  const routers = db.prepare('SELECT * FROM routers WHERE host IS NOT NULL AND api_user IS NOT NULL').all() as any[];
  let samples = 0;
  let alerts = 0;
  let services = 0;

  for (const router of routers) {
    try {
      const sessions = await fetchPppActive(router);
      const names = sessions.map((s) => s.name).filter(Boolean);
      if (!names.length) continue;

      const [traffic, bytes] = await Promise.all([
        fetchPppActiveTraffic(router, names),
        fetchPppInterfaceBytes(router, names),
      ]);

      const day = todayLocal();
      const nowIso = new Date().toISOString();

      for (const name of names) {
        const t = traffic[name] || { download: 0, upload: 0 };
        const b = bytes[name] || { rxBytes: 0, txBytes: 0 };
        const user = db.prepare('SELECT * FROM pppoe_users WHERE username = ? COLLATE NOCASE').get(name) as any;

        db.prepare(
          `INSERT INTO usage_samples (subject_type, subject_key, router_id, rx_bytes, tx_bytes, rx_bps, tx_bps, sampled_at)
           VALUES ('pppoe', ?, ?, ?, ?, ?, ?, ?)`
        ).run(name, router.id, b.rxBytes, b.txBytes, t.download, t.upload, nowIso);

        // Daily rollup: store latest counters (delta computed at query time via max-min if needed)
        db.prepare(
          `INSERT INTO usage_daily (subject_type, subject_key, day, rx_bytes, tx_bytes, peak_rx_bps, peak_tx_bps)
           VALUES ('pppoe', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(subject_type, subject_key, day) DO UPDATE SET
             rx_bytes = MAX(rx_bytes, excluded.rx_bytes),
             tx_bytes = MAX(tx_bytes, excluded.tx_bytes),
             peak_rx_bps = MAX(peak_rx_bps, excluded.peak_rx_bps),
             peak_tx_bps = MAX(peak_tx_bps, excluded.peak_tx_bps)`
        ).run(name, day, b.rxBytes, b.txBytes, t.download, t.upload);
        samples++;

        if (!settings.enabled || !user) continue;
        const prof = db.prepare('SELECT rate_limit FROM profiles WHERE name = ?').get(user.profile) as
          | { rate_limit?: string }
          | undefined;
        const limitRaw = String(prof?.rate_limit || '');
        // rate-limit like "50M/50M" — use download leg
        const downLimit = parseRosRate(limitRaw.split('/')[0] || limitRaw);
        if (downLimit <= 0) continue;
        const cap = downLimit * (Number(settings.cap_percent) || 95) / 100;
        const key = `${router.id}:${name.toLowerCase()}`;
        if (t.download >= cap) {
          if (!overCapSince.has(key)) overCapSince.set(key, Date.now());
          const mins = (Date.now() - (overCapSince.get(key) || Date.now())) / 60000;
          if (mins >= (Number(settings.sustain_minutes) || 10)) {
            const recent = db
              .prepare(
                `SELECT id FROM usage_alerts WHERE pppoe_user_id = ? AND alert_type = 'sustained_over_cap'
                 AND datetime(created_at) > datetime('now', '-2 hours') LIMIT 1`
              )
              .get(user.id);
            if (!recent) {
              db.prepare(
                `INSERT INTO usage_alerts (pppoe_user_id, router_id, alert_type, threshold_bps, observed_bps, profile)
                 VALUES (?, ?, 'sustained_over_cap', ?, ?, ?)`
              ).run(user.id, router.id, Math.round(cap), Math.round(t.download), user.profile);
              alerts++;
              const channels: ('email' | 'sms')[] = [];
              if (settings.notify_email) channels.push('email');
              if (settings.notify_sms) channels.push('sms');
              if (channels.length) {
                await notifyClientChannels(
                  user,
                  channels,
                  'Fair-use notice — high bandwidth',
                  `Hi ${user.customer_name || user.username}, your connection has been using high bandwidth (≥${settings.cap_percent}% of your ${user.profile} plan) for ${settings.sustain_minutes}+ minutes. Please reduce heavy downloads/streams during peak hours.`,
                  'fair_use_alert'
                );
              }
            }
            overCapSince.delete(key);
          }
        } else {
          overCapSince.delete(key);
        }
      }

      // Platform / website popularity from DNS cache
      try {
        const namesDns = await fetchDnsCacheNames(router);
        const counts = new Map<string, { name: string; category: string; hits: number }>();
        for (const host of namesDns) {
          const c = classifyHost(host);
          const prev = counts.get(c.id) || { name: c.name, category: c.category, hits: 0 };
          prev.hits++;
          counts.set(c.id, prev);
        }
        for (const [sid, v] of counts) {
          db.prepare(
            `INSERT INTO usage_services (day, service_id, service_name, category, hits, router_id)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(day, service_id, router_id) DO UPDATE SET hits = hits + excluded.hits`
          ).run(day, sid, v.name, v.category, v.hits, router.id);
          services++;
        }
      } catch {
        /* optional */
      }
    } catch (e) {
      console.error('[usage] router', router.id, e);
    }
  }

  return { samples, alerts, services, routers: routers.length };
}

export function ensureUsageTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pppoe_user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      amount REAL,
      months INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      expires_at TEXT,
      paid_at TEXT,
      external_ref TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fair_use_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER DEFAULT 1,
      cap_percent INTEGER DEFAULT 95,
      sustain_minutes INTEGER DEFAULT 10,
      notify_email INTEGER DEFAULT 1,
      notify_sms INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS usage_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pppoe_user_id INTEGER,
      router_id INTEGER,
      alert_type TEXT,
      threshold_bps INTEGER,
      observed_bps INTEGER,
      profile TEXT,
      acknowledged INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS usage_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_type TEXT,
      subject_key TEXT,
      router_id INTEGER,
      rx_bytes INTEGER DEFAULT 0,
      tx_bytes INTEGER DEFAULT 0,
      rx_bps INTEGER DEFAULT 0,
      tx_bps INTEGER DEFAULT 0,
      sampled_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS usage_daily (
      subject_type TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      day TEXT NOT NULL,
      rx_bytes INTEGER DEFAULT 0,
      tx_bytes INTEGER DEFAULT 0,
      peak_rx_bps INTEGER DEFAULT 0,
      peak_tx_bps INTEGER DEFAULT 0,
      PRIMARY KEY (subject_type, subject_key, day)
    );
    CREATE TABLE IF NOT EXISTS usage_services (
      day TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT,
      category TEXT,
      hits INTEGER DEFAULT 0,
      router_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, service_id, router_id)
    );
  `);
  ensureFairUseRow();
}

export function listUsageAlerts(limit = 100) {
  return db
    .prepare(
      `SELECT a.*, u.username, u.customer_name AS customer
       FROM usage_alerts a
       LEFT JOIN pppoe_users u ON u.id = a.pppoe_user_id
       ORDER BY a.id DESC LIMIT ?`
    )
    .all(limit);
}

export function ackUsageAlert(id: number) {
  db.prepare('UPDATE usage_alerts SET acknowledged = 1 WHERE id = ?').run(id);
  return db.prepare('SELECT * FROM usage_alerts WHERE id = ?').get(id);
}

export function getUserUsageHistory(username: string, days = 30) {
  return db
    .prepare(
      `SELECT day, rx_bytes AS rxBytes, tx_bytes AS txBytes, peak_rx_bps AS peakRxBps, peak_tx_bps AS peakTxBps
       FROM usage_daily WHERE subject_type = 'pppoe' AND subject_key = ? COLLATE NOCASE
       AND day >= date('now', ?) ORDER BY day`
    )
    .all(username, `-${Math.max(1, days)} days`);
}

export function getUsageSummary(days = 7) {
  const users = db
    .prepare(
      `SELECT subject_key AS username,
              SUM(rx_bytes) AS rxBytes, SUM(tx_bytes) AS txBytes,
              MAX(peak_rx_bps) AS peakRxBps, MAX(peak_tx_bps) AS peakTxBps
       FROM usage_daily
       WHERE subject_type = 'pppoe' AND day >= date('now', ?)
       GROUP BY subject_key
       ORDER BY (SUM(rx_bytes)+SUM(tx_bytes)) DESC
       LIMIT 50`
    )
    .all(`-${Math.max(1, days)} days`) as any[];

  const enriched = users.map((u) => {
    const client = db
      .prepare('SELECT id, customer_name, profile, account_number FROM pppoe_users WHERE username = ? COLLATE NOCASE')
      .get(u.username) as any;
    return {
      ...u,
      customer: client?.customer_name || u.username,
      profile: client?.profile || null,
      account: client?.account_number || null,
      userId: client?.id || null,
    };
  });

  const services = db
    .prepare(
      `SELECT service_id AS id, service_name AS name, category,
              SUM(hits) AS hits
       FROM usage_services
       WHERE day >= date('now', ?)
       GROUP BY service_id
       ORDER BY SUM(hits) DESC
       LIMIT 40`
    )
    .all(`-${Math.max(1, days)} days`);

  return { users: enriched, services, days };
}

let usageStarted = false;
export function startUsageScheduler(intervalMs = 60_000) {
  if (usageStarted) return;
  usageStarted = true;
  ensureUsageTables();
  pollUsageAndFairUse().catch((e) => console.error('[usage] initial', e));
  setInterval(() => {
    pollUsageAndFairUse().catch((e) => console.error('[usage]', e));
  }, intervalMs);
}

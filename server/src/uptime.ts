import { performance } from 'perf_hooks';

export interface MonitorTarget {
  id: string;
  name: string;
  category: string;
  url: string;
}

export interface MonitorSample {
  t: number;
  up: boolean;
  ms: number | null;
}

export interface MonitorState extends MonitorTarget {
  status: 'up' | 'down' | 'degraded' | 'pending';
  latencyMs: number | null;
  code: number;
  lastChecked: number | null;
  uptimePct: number;
  avgMs: number | null;
  history: MonitorSample[];
}

// A spread of the most popular services, sites, games and infrastructure that
// ISP subscribers care about. Reachability is checked over HTTPS from the panel
// host, which mirrors how it would run on the router's uplink.
const TARGETS: MonitorTarget[] = [
  // Search & web
  { id: 'google', name: 'Google', category: 'Web & Search', url: 'https://www.google.com/generate_204' },
  { id: 'bing', name: 'Bing', category: 'Web & Search', url: 'https://www.bing.com' },
  { id: 'wikipedia', name: 'Wikipedia', category: 'Web & Search', url: 'https://www.wikipedia.org' },
  // Social
  { id: 'facebook', name: 'Facebook', category: 'Social', url: 'https://www.facebook.com' },
  { id: 'instagram', name: 'Instagram', category: 'Social', url: 'https://www.instagram.com' },
  { id: 'tiktok', name: 'TikTok', category: 'Social', url: 'https://www.tiktok.com' },
  { id: 'x', name: 'X (Twitter)', category: 'Social', url: 'https://x.com' },
  { id: 'reddit', name: 'Reddit', category: 'Social', url: 'https://www.reddit.com' },
  // Video & streaming
  { id: 'youtube', name: 'YouTube', category: 'Video & Streaming', url: 'https://www.youtube.com' },
  { id: 'netflix', name: 'Netflix', category: 'Video & Streaming', url: 'https://www.netflix.com' },
  { id: 'twitch', name: 'Twitch', category: 'Video & Streaming', url: 'https://www.twitch.tv' },
  { id: 'spotify', name: 'Spotify', category: 'Video & Streaming', url: 'https://www.spotify.com' },
  // Games
  { id: 'steam', name: 'Steam', category: 'Games', url: 'https://store.steampowered.com' },
  { id: 'roblox', name: 'Roblox', category: 'Games', url: 'https://www.roblox.com' },
  { id: 'riot', name: 'League of Legends', category: 'Games', url: 'https://www.leagueoflegends.com' },
  { id: 'valorant', name: 'Valorant', category: 'Games', url: 'https://playvalorant.com' },
  { id: 'epic', name: 'Fortnite (Epic)', category: 'Games', url: 'https://www.epicgames.com' },
  { id: 'mlbb', name: 'Mobile Legends', category: 'Games', url: 'https://www.mobilelegends.com' },
  { id: 'minecraft', name: 'Minecraft', category: 'Games', url: 'https://www.minecraft.net' },
  { id: 'hoyo', name: 'Genshin (HoYoverse)', category: 'Games', url: 'https://www.hoyoverse.com' },
  // Comms
  { id: 'discord', name: 'Discord', category: 'Communication', url: 'https://discord.com' },
  { id: 'whatsapp', name: 'WhatsApp', category: 'Communication', url: 'https://www.whatsapp.com' },
  { id: 'zoom', name: 'Zoom', category: 'Communication', url: 'https://zoom.us' },
  { id: 'gmail', name: 'Gmail', category: 'Communication', url: 'https://mail.google.com' },
  // Infrastructure & DNS
  { id: 'cloudflare-dns', name: 'Cloudflare DNS (1.1.1.1)', category: 'Infrastructure & DNS', url: 'https://one.one.one.one' },
  { id: 'google-dns', name: 'Google DNS (8.8.8.8)', category: 'Infrastructure & DNS', url: 'https://dns.google' },
  { id: 'cloudflare', name: 'Cloudflare', category: 'Infrastructure & DNS', url: 'https://www.cloudflare.com' },
  { id: 'aws', name: 'Amazon AWS', category: 'Infrastructure & DNS', url: 'https://aws.amazon.com' },
  // Dev & shopping
  { id: 'github', name: 'GitHub', category: 'Developer & Shopping', url: 'https://github.com' },
  { id: 'amazon', name: 'Amazon', category: 'Developer & Shopping', url: 'https://www.amazon.com' },
];

const HISTORY_CAP = 60;
const state = new Map<string, MonitorState>();

for (const t of TARGETS) {
  state.set(t.id, {
    ...t,
    status: 'pending',
    latencyMs: null,
    code: 0,
    lastChecked: null,
    uptimePct: 0,
    avgMs: null,
    history: [],
  });
}

async function checkOne(target: MonitorTarget): Promise<{ up: boolean; ms: number | null; code: number; status: MonitorState['status'] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const start = performance.now();
  try {
    const res = await fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MT-Billing-UptimeMonitor/1.0)' },
    });
    const ms = Math.round(performance.now() - start);
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    // Any HTTP response means the host is reachable; 5xx counts as degraded
    // but still reachable (counts toward uptime).
    const status: MonitorState['status'] = res.status >= 500 ? 'degraded' : 'up';
    return { up: true, ms, code: res.status, status };
  } catch {
    return { up: false, ms: null, code: 0, status: 'down' };
  } finally {
    clearTimeout(timer);
  }
}

export async function runUptimeChecks() {
  await Promise.allSettled(
    TARGETS.map(async (t) => {
      const r = await checkOne(t);
      const s = state.get(t.id)!;
      s.status = r.status;
      s.latencyMs = r.ms;
      s.code = r.code;
      s.lastChecked = Date.now();
      s.history.push({ t: s.lastChecked, up: r.up, ms: r.ms });
      if (s.history.length > HISTORY_CAP) s.history.shift();
      const ups = s.history.filter((h) => h.up).length;
      s.uptimePct = s.history.length ? Number(((ups / s.history.length) * 100).toFixed(1)) : 0;
      const lat = s.history.filter((h) => h.ms != null).map((h) => h.ms as number);
      s.avgMs = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
    })
  );
}

export function getUptime(): MonitorState[] {
  return Array.from(state.values());
}

export function getUptimeSummary() {
  const all = getUptime();
  const checked = all.filter((m) => m.status !== 'pending');
  const up = checked.filter((m) => m.status === 'up').length;
  const degraded = checked.filter((m) => m.status === 'degraded').length;
  const down = checked.filter((m) => m.status === 'down').length;
  const lat = checked.filter((m) => m.latencyMs != null).map((m) => m.latencyMs as number);
  const avgMs = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
  return { total: all.length, up, degraded, down, avgMs, lastRun: Math.max(0, ...all.map((m) => m.lastChecked || 0)) || null };
}

let started = false;
export function startUptime(intervalMs = 60000) {
  if (started) return;
  started = true;
  // Kick off an immediate check, then poll on an interval.
  runUptimeChecks().catch(() => undefined);
  setInterval(() => runUptimeChecks().catch(() => undefined), intervalMs);
}

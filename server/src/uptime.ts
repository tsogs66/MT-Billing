import dns from 'dns';
import { performance } from 'perf_hooks';

// Prefer IPv4 — many ISP/LXC hosts have broken IPv6 which makes every HTTPS check fail.
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* Node < 17 */
}

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
  lastError?: string | null;
}

// Popular services ISP subscribers care about. Checked over HTTPS from the panel host.
const TARGETS: MonitorTarget[] = [
  { id: 'google', name: 'Google', category: 'Web & Search', url: 'https://www.google.com/generate_204' },
  { id: 'bing', name: 'Bing', category: 'Web & Search', url: 'https://www.bing.com' },
  { id: 'wikipedia', name: 'Wikipedia', category: 'Web & Search', url: 'https://www.wikipedia.org' },
  { id: 'facebook', name: 'Facebook', category: 'Social', url: 'https://www.facebook.com' },
  { id: 'instagram', name: 'Instagram', category: 'Social', url: 'https://www.instagram.com' },
  { id: 'tiktok', name: 'TikTok', category: 'Social', url: 'https://www.tiktok.com' },
  { id: 'x', name: 'X (Twitter)', category: 'Social', url: 'https://x.com' },
  { id: 'reddit', name: 'Reddit', category: 'Social', url: 'https://www.reddit.com' },
  { id: 'youtube', name: 'YouTube', category: 'Video & Streaming', url: 'https://www.youtube.com' },
  { id: 'netflix', name: 'Netflix', category: 'Video & Streaming', url: 'https://www.netflix.com' },
  { id: 'twitch', name: 'Twitch', category: 'Video & Streaming', url: 'https://www.twitch.tv' },
  { id: 'spotify', name: 'Spotify', category: 'Video & Streaming', url: 'https://www.spotify.com' },
  { id: 'steam', name: 'Steam', category: 'Games', url: 'https://store.steampowered.com' },
  { id: 'roblox', name: 'Roblox', category: 'Games', url: 'https://www.roblox.com' },
  { id: 'riot', name: 'League of Legends', category: 'Games', url: 'https://www.leagueoflegends.com' },
  { id: 'valorant', name: 'Valorant', category: 'Games', url: 'https://playvalorant.com' },
  { id: 'epic', name: 'Fortnite (Epic)', category: 'Games', url: 'https://www.epicgames.com' },
  { id: 'mlbb', name: 'Mobile Legends', category: 'Games', url: 'https://www.mobilelegends.com' },
  { id: 'minecraft', name: 'Minecraft', category: 'Games', url: 'https://www.minecraft.net' },
  { id: 'hoyo', name: 'Genshin (HoYoverse)', category: 'Games', url: 'https://www.hoyoverse.com' },
  { id: 'discord', name: 'Discord', category: 'Communication', url: 'https://discord.com' },
  { id: 'whatsapp', name: 'WhatsApp', category: 'Communication', url: 'https://www.whatsapp.com' },
  { id: 'zoom', name: 'Zoom', category: 'Communication', url: 'https://zoom.us' },
  { id: 'gmail', name: 'Gmail', category: 'Communication', url: 'https://mail.google.com' },
  { id: 'cloudflare-dns', name: 'Cloudflare DNS (1.1.1.1)', category: 'Infrastructure & DNS', url: 'https://1.1.1.1' },
  { id: 'google-dns', name: 'Google DNS (8.8.8.8)', category: 'Infrastructure & DNS', url: 'https://dns.google/resolve?name=google.com&type=A' },
  { id: 'cloudflare', name: 'Cloudflare', category: 'Infrastructure & DNS', url: 'https://www.cloudflare.com' },
  { id: 'aws', name: 'Amazon AWS', category: 'Infrastructure & DNS', url: 'https://aws.amazon.com' },
  { id: 'github', name: 'GitHub', category: 'Developer & Shopping', url: 'https://github.com' },
  { id: 'amazon', name: 'Amazon', category: 'Developer & Shopping', url: 'https://www.amazon.com' },
];

const HISTORY_CAP = 60;
const CONCURRENCY = 5;
const TIMEOUT_MS = 12000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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
    lastError: null,
  });
}

async function fetchReachable(
  url: string,
  method: 'HEAD' | 'GET'
): Promise<{ ok: true; ms: number; code: number } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: '*/*',
        'Cache-Control': 'no-cache',
      },
    });
    const ms = Math.round(performance.now() - start);
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    return { ok: true, ms, code: res.status };
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e || 'network error');
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

async function checkOne(
  target: MonitorTarget
): Promise<{ up: boolean; ms: number | null; code: number; status: MonitorState['status']; error: string | null }> {
  // HEAD first (cheap); some CDNs reject HEAD — fall back to GET.
  let result = await fetchReachable(target.url, 'HEAD');
  if (!result.ok) {
    result = await fetchReachable(target.url, 'GET');
  }
  if (!result.ok) {
    return { up: false, ms: null, code: 0, status: 'down', error: result.error };
  }
  const status: MonitorState['status'] = result.code >= 500 ? 'degraded' : 'up';
  return { up: true, ms: result.ms, code: result.code, status, error: null };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function runUptimeChecks() {
  await mapPool(TARGETS, CONCURRENCY, async (t) => {
    const r = await checkOne(t);
    const s = state.get(t.id)!;
    s.status = r.status;
    s.latencyMs = r.ms;
    s.code = r.code;
    s.lastChecked = Date.now();
    s.lastError = r.error;
    s.history.push({ t: s.lastChecked, up: r.up, ms: r.ms });
    if (s.history.length > HISTORY_CAP) s.history.shift();
    const ups = s.history.filter((h) => h.up).length;
    s.uptimePct = s.history.length ? Number(((ups / s.history.length) * 100).toFixed(1)) : 0;
    const lat = s.history.filter((h) => h.ms != null).map((h) => h.ms as number);
    s.avgMs = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
  });
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
  return {
    total: all.length,
    up,
    degraded,
    down,
    avgMs,
    lastRun: Math.max(0, ...all.map((m) => m.lastChecked || 0)) || null,
  };
}

let started = false;
export function startUptime(intervalMs = 60000) {
  if (started) return;
  started = true;
  runUptimeChecks().catch(() => undefined);
  setInterval(() => runUptimeChecks().catch(() => undefined), intervalMs);
}

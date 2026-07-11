/**
 * Uptime monitor — global / regional service status (not local reachability).
 *
 * Sources:
 *  1. DownStatus (isitdownstatus.com) — crowdsourced + official indicators worldwide
 *  2. Optional Atlassian Statuspage summaries — regional component health (APAC focus)
 *
 * This deliberately does NOT probe service URLs from the panel host, so a local
 * uplink outage does not make every site look "down".
 */

export interface MonitorTarget {
  id: string;
  name: string;
  category: string;
  /** DownStatus slug (https://isitdownstatus.com/api/v1/status/:slug). */
  slug: string;
  /** Public status page / service URL (display only). */
  url: string;
  /** Optional Atlassian Statuspage summary JSON for regional detail. */
  statusPage?: string;
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
  /** Where the status came from. */
  source: 'global' | 'regional' | 'unknown';
  /** DownStatus / official combined label. */
  detail: string;
  reportCount1h: number;
  reportCount24h: number;
  officialIndicator: string | null;
  /** APAC / regional component summary when available. */
  regionStatus: 'up' | 'down' | 'degraded' | 'unknown';
  regionDetail: string;
}

const TARGETS: MonitorTarget[] = [
  // Search & web
  { id: 'google', name: 'Google', category: 'Web & Search', slug: 'google', url: 'https://www.google.com' },
  { id: 'bing', name: 'Bing', category: 'Web & Search', slug: 'bing', url: 'https://www.bing.com' },
  { id: 'wikipedia', name: 'Wikipedia', category: 'Web & Search', slug: 'wikipedia', url: 'https://www.wikipedia.org' },
  // Social
  { id: 'facebook', name: 'Facebook', category: 'Social', slug: 'facebook', url: 'https://www.facebook.com' },
  { id: 'instagram', name: 'Instagram', category: 'Social', slug: 'instagram', url: 'https://www.instagram.com' },
  { id: 'tiktok', name: 'TikTok', category: 'Social', slug: 'tiktok', url: 'https://www.tiktok.com' },
  { id: 'x', name: 'X (Twitter)', category: 'Social', slug: 'twitter', url: 'https://x.com' },
  { id: 'reddit', name: 'Reddit', category: 'Social', slug: 'reddit', url: 'https://www.reddit.com' },
  // Video & streaming
  { id: 'youtube', name: 'YouTube', category: 'Video & Streaming', slug: 'youtube', url: 'https://www.youtube.com' },
  { id: 'netflix', name: 'Netflix', category: 'Video & Streaming', slug: 'netflix', url: 'https://www.netflix.com' },
  { id: 'twitch', name: 'Twitch', category: 'Video & Streaming', slug: 'twitch', url: 'https://www.twitch.tv' },
  { id: 'spotify', name: 'Spotify', category: 'Video & Streaming', slug: 'spotify', url: 'https://www.spotify.com' },
  // Games
  { id: 'steam', name: 'Steam', category: 'Games', slug: 'steam', url: 'https://store.steampowered.com' },
  { id: 'roblox', name: 'Roblox', category: 'Games', slug: 'roblox', url: 'https://www.roblox.com' },
  { id: 'riot', name: 'League of Legends', category: 'Games', slug: 'league-of-legends', url: 'https://www.leagueoflegends.com' },
  { id: 'valorant', name: 'Valorant', category: 'Games', slug: 'valorant', url: 'https://playvalorant.com' },
  { id: 'epic', name: 'Fortnite (Epic)', category: 'Games', slug: 'fortnite', url: 'https://www.epicgames.com' },
  { id: 'mlbb', name: 'Mobile Legends', category: 'Games', slug: 'mobile-legends', url: 'https://www.mobilelegends.com' },
  { id: 'minecraft', name: 'Minecraft', category: 'Games', slug: 'minecraft', url: 'https://www.minecraft.net' },
  // Comms
  {
    id: 'discord',
    name: 'Discord',
    category: 'Communication',
    slug: 'discord',
    url: 'https://discord.com',
    statusPage: 'https://discordstatus.com/api/v2/summary.json',
  },
  { id: 'whatsapp', name: 'WhatsApp', category: 'Communication', slug: 'whatsapp', url: 'https://www.whatsapp.com' },
  { id: 'zoom', name: 'Zoom', category: 'Communication', slug: 'zoom', url: 'https://zoom.us' },
  { id: 'gmail', name: 'Gmail', category: 'Communication', slug: 'gmail', url: 'https://mail.google.com' },
  // Infrastructure & DNS
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    category: 'Infrastructure & DNS',
    slug: 'cloudflare',
    url: 'https://www.cloudflare.com',
    statusPage: 'https://www.cloudflarestatus.com/api/v2/summary.json',
  },
  {
    id: 'aws',
    name: 'Amazon AWS',
    category: 'Infrastructure & DNS',
    slug: 'aws',
    url: 'https://health.aws.amazon.com/health/status',
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'Developer & Shopping',
    slug: 'github',
    url: 'https://github.com',
    statusPage: 'https://www.githubstatus.com/api/v2/summary.json',
  },
  { id: 'amazon', name: 'Amazon', category: 'Developer & Shopping', slug: 'amazon', url: 'https://www.amazon.com' },
];

/** Component name fragments that indicate Asia / Pacific / SEA regions. */
const APAC_HINTS = [
  'asia',
  'apac',
  'pacific',
  'singapore',
  'tokyo',
  'osaka',
  'seoul',
  'hong kong',
  'mumbai',
  'sydney',
  'melbourne',
  'jakarta',
  'manila',
  'philippines',
  'southeast',
  'sea ',
  'ap-southeast',
  'ap-northeast',
  'ap-south',
  'taiwan',
  'bangkok',
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
    source: 'unknown',
    detail: 'Waiting for global status…',
    reportCount1h: 0,
    reportCount24h: 0,
    officialIndicator: null,
    regionStatus: 'unknown',
    regionDetail: '',
  });
}

type StatusLevel = 'up' | 'down' | 'degraded';

function mapDownStatus(s: string | undefined): StatusLevel {
  const v = (s || '').toLowerCase();
  if (v === 'down' || v === 'major_outage' || v === 'critical') return 'down';
  if (v === 'degraded' || v === 'partial_outage' || v === 'minor' || v === 'major') return 'degraded';
  return 'up';
}

function mapOfficialIndicator(ind: string | null | undefined): StatusLevel | null {
  if (ind == null || ind === '' || ind === 'none') return null;
  const v = ind.toLowerCase();
  if (v === 'critical' || v === 'major') return 'down';
  if (v === 'minor' || v === 'maintenance') return 'degraded';
  return null;
}

function mapComponentStatus(s: string | undefined): StatusLevel {
  const v = (s || '').toLowerCase();
  if (v === 'major_outage' || v === 'partial_outage') return v === 'major_outage' ? 'down' : 'degraded';
  if (v === 'degraded_performance' || v === 'under_maintenance') return 'degraded';
  return 'up';
}

function worse(a: StatusLevel, b: StatusLevel): StatusLevel {
  const rank = { up: 0, degraded: 1, down: 2 };
  return rank[b] > rank[a] ? b : a;
}

function isApacName(name: string): boolean {
  const n = name.toLowerCase();
  return APAC_HINTS.some((h) => n.includes(h));
}

async function fetchJson(url: string, timeoutMs = 10000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MT-Billing-UptimeMonitor/2.0 (global-status)',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGlobalStatus(slug: string): Promise<{
  status: StatusLevel;
  officialIndicator: string | null;
  reportCount1h: number;
  reportCount24h: number;
  detail: string;
  ok: boolean;
}> {
  const data = await fetchJson(`https://isitdownstatus.com/api/v1/status/${encodeURIComponent(slug)}`);
  if (!data?.ok || !data?.data) {
    return {
      status: 'up',
      officialIndicator: null,
      reportCount1h: 0,
      reportCount24h: 0,
      detail: 'Global status unavailable',
      ok: false,
    };
  }
  const d = data.data;
  const fromReports = mapDownStatus(d.status);
  const fromOfficial = mapOfficialIndicator(d.official_indicator);
  const status = fromOfficial ? worse(fromReports, fromOfficial) : fromReports;
  const parts: string[] = ['Global'];
  if (d.official_indicator && d.official_indicator !== 'none') {
    parts.push(`official: ${d.official_indicator}`);
  }
  if (Number(d.report_count_1h) > 0) parts.push(`${d.report_count_1h} reports/1h`);
  if (Number(d.report_count_24h) > 0) parts.push(`${d.report_count_24h} reports/24h`);
  return {
    status,
    officialIndicator: d.official_indicator ?? null,
    reportCount1h: Number(d.report_count_1h) || 0,
    reportCount24h: Number(d.report_count_24h) || 0,
    detail: parts.join(' · '),
    ok: true,
  };
}

async function fetchRegionalStatus(statusPageUrl: string): Promise<{
  status: StatusLevel;
  detail: string;
  ok: boolean;
}> {
  // Only Atlassian-style /api/v2/summary.json endpoints are parsed for regions.
  if (!statusPageUrl.includes('/api/v2/summary.json')) {
    return { status: 'up', detail: '', ok: false };
  }
  const data = await fetchJson(statusPageUrl);
  if (!data?.components) return { status: 'up', detail: '', ok: false };

  const apac = (data.components as any[]).filter(
    (c) => c && !c.group && typeof c.name === 'string' && isApacName(c.name)
  );
  if (!apac.length) {
    // Fall back to overall page indicator when no APAC components exist.
    const ind = data.status?.indicator as string | undefined;
    if (ind && ind !== 'none') {
      const status = mapOfficialIndicator(ind) || 'up';
      return {
        status,
        detail: `Official: ${data.status?.description || ind}`,
        ok: true,
      };
    }
    return { status: 'up', detail: 'No APAC components listed', ok: true };
  }

  let worst: StatusLevel = 'up';
  const issues: string[] = [];
  for (const c of apac) {
    const st = mapComponentStatus(c.status);
    worst = worse(worst, st);
    if (st !== 'up') issues.push(`${c.name}: ${c.status}`);
  }
  return {
    status: worst,
    detail:
      worst === 'up'
        ? `APAC regions operational (${apac.length} checked)`
        : `APAC: ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? '…' : ''}`,
    ok: true,
  };
}

async function checkOne(target: MonitorTarget): Promise<{
  status: StatusLevel;
  source: MonitorState['source'];
  detail: string;
  reportCount1h: number;
  reportCount24h: number;
  officialIndicator: string | null;
  regionStatus: MonitorState['regionStatus'];
  regionDetail: string;
  up: boolean;
}> {
  const global = await fetchGlobalStatus(target.slug);
  let regionStatus: MonitorState['regionStatus'] = 'unknown';
  let regionDetail = '';
  let combined: StatusLevel = global.ok ? global.status : 'up';
  let source: MonitorState['source'] = global.ok ? 'global' : 'unknown';
  const details: string[] = [];

  if (global.ok) details.push(global.detail);
  else details.push('Global feed unreachable');

  if (target.statusPage) {
    const regional = await fetchRegionalStatus(target.statusPage);
    if (regional.ok) {
      regionStatus = regional.status;
      regionDetail = regional.detail;
      if (regional.detail) details.push(regional.detail);
      combined = worse(combined, regional.status);
      source = 'regional';
    }
  }

  // If global feed failed entirely and no regional data, mark unknown as degraded
  // rather than "down" — we must not imply a local outage.
  if (!global.ok && regionStatus === 'unknown') {
    return {
      status: 'degraded',
      source: 'unknown',
      detail: 'Could not reach global/regional status feeds',
      reportCount1h: 0,
      reportCount24h: 0,
      officialIndicator: null,
      regionStatus: 'unknown',
      regionDetail: '',
      up: true,
    };
  }

  return {
    status: combined,
    source,
    detail: details.filter(Boolean).join(' · '),
    reportCount1h: global.reportCount1h,
    reportCount24h: global.reportCount24h,
    officialIndicator: global.officialIndicator,
    regionStatus,
    regionDetail,
    up: combined !== 'down',
  };
}

export async function runUptimeChecks() {
  await Promise.allSettled(
    TARGETS.map(async (t) => {
      const r = await checkOne(t);
      const s = state.get(t.id)!;
      s.status = r.status;
      s.latencyMs = null;
      s.code = 0;
      s.lastChecked = Date.now();
      s.source = r.source;
      s.detail = r.detail;
      s.reportCount1h = r.reportCount1h;
      s.reportCount24h = r.reportCount24h;
      s.officialIndicator = r.officialIndicator;
      s.regionStatus = r.regionStatus;
      s.regionDetail = r.regionDetail;
      s.history.push({ t: s.lastChecked, up: r.up, ms: null });
      if (s.history.length > HISTORY_CAP) s.history.shift();
      const ups = s.history.filter((h) => h.up).length;
      s.uptimePct = s.history.length ? Number(((ups / s.history.length) * 100).toFixed(1)) : 0;
      s.avgMs = null;
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
  const reports1h = checked.reduce((s, m) => s + (m.reportCount1h || 0), 0);
  return {
    total: all.length,
    up,
    degraded,
    down,
    avgMs: null as number | null,
    reports1h,
    mode: 'global' as const,
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

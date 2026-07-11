import { RouterOSAPI } from 'node-routeros';

export interface RouterConn {
  host?: string;
  port?: number;
  api_user?: string;
  api_pass?: string;
}

/**
 * Thin wrapper around the RouterOS API. If a real router is reachable and
 * credentials are provided, live data is returned. Otherwise callers should
 * fall back to the local database (seeded/sample data) so the panel remains
 * fully usable during development without hardware.
 */
export async function withRouter<T>(
  conn: RouterConn,
  fn: (api: RouterOSAPI) => Promise<T>
): Promise<T> {
  if (!conn.host || !conn.api_user) {
    throw new Error('router-not-configured');
  }
  const api = new RouterOSAPI({
    host: conn.host,
    port: conn.port || 8728,
    user: conn.api_user,
    password: conn.api_pass || '',
    timeout: 4,
  });
  await api.connect();
  try {
    return await fn(api);
  } finally {
    try {
      api.close();
    } catch {
      /* ignore */
    }
  }
}

export async function tryLiveResource<T>(
  conn: RouterConn,
  path: string,
  fallback: T
): Promise<{ live: boolean; data: T }> {
  try {
    const data = (await withRouter(conn, (api) => api.write(path))) as unknown as T;
    return { live: true, data };
  } catch {
    return { live: false, data: fallback };
  }
}

export interface RouterProbeResult {
  online: boolean;
  board: string | null;
  identity: string | null;
  version: string | null;
  error?: string;
}

/** Probe a MikroTik router for reachability and hardware identity. */
export async function probeRouter(conn: RouterConn): Promise<RouterProbeResult> {
  if (!conn.host || !conn.api_user) {
    return { online: false, board: null, identity: null, version: null, error: 'Host and API user are required.' };
  }
  try {
    const info = await withRouter(conn, async (api) => {
      const [resource, identity] = await Promise.all([
        api.write('/system/resource/print') as Promise<Record<string, string>[]>,
        api.write('/system/identity/print') as Promise<Record<string, string>[]>,
      ]);
      const r = resource?.[0] || {};
      const id = identity?.[0]?.name || null;
      const board = r['board-name'] || r.board || null;
      const version = r.version || null;
      return { board, identity: id, version };
    });
    return { online: true, board: info.board, identity: info.identity, version: info.version };
  } catch (e: any) {
    return {
      online: false,
      board: null,
      identity: null,
      version: null,
      error: e?.message || 'Connection failed',
    };
  }
}

export interface WanRouteRow {
  routeId: string;
  gateway: string;
  checkMethod: string;
  distance: number;
  status: string;
  interfaceName: string | null;
  dstAddress: string;
  enabled: boolean;
}

/** Enable or disable a route on the router by its .id. */
export async function setRouteEnabled(conn: RouterConn, routeId: string, enabled: boolean): Promise<void> {
  await withRouter(conn, (api) => api.write(enabled ? '/ip/route/enable' : '/ip/route/disable', [`=numbers=${routeId}`]));
}

/** Fetch monitored WAN routes (check-gateway or default routes) from a router. */
export async function fetchWanRoutes(conn: RouterConn): Promise<WanRouteRow[]> {
  return withRouter(conn, async (api) => {
    const routes = (await api.write('/ip/route/print')) as Record<string, string>[];
    const out: WanRouteRow[] = [];
    for (const r of routes || []) {
      const routeId = r['.id'] || '';
      const check = r['check-gateway'] || '';
      const gateway = r.gateway || '';
      const dst = r['dst-address'] || '0.0.0.0/0';
      if (!gateway || !routeId) continue;
      const iface = r.interface || r['interface'] || null;
      const isDefault = dst === '0.0.0.0/0';
      if (!check && !isDefault) continue;
      const disabled = r.disabled === 'true' || r.disabled === 'yes';
      const active = r.active === 'true' || r.active === 'yes';
      out.push({
        routeId,
        gateway,
        checkMethod: check || (isDefault ? 'route' : 'ping'),
        distance: Number(r.distance) || 1,
        status: disabled ? 'Disabled' : active ? 'Active' : 'Inactive',
        interfaceName: iface,
        dstAddress: dst,
        enabled: !disabled,
      });
    }
    return out;
  });
}

export interface RouterFileRow {
  name: string;
  size: number;
  type: string;
  creationTime: string | null;
}

/** List files stored on the router. */
export async function listRouterFiles(conn: RouterConn): Promise<RouterFileRow[]> {
  return withRouter(conn, async (api) => {
    const rows = (await api.write('/file/print')) as Record<string, string>[];
    return (rows || []).map((f) => ({
      name: f.name || '',
      size: Number(f.size) || 0,
      type: f.type || 'file',
      creationTime: f['creation-time'] || null,
    }));
  });
}

function parseRouterMemMb(raw: string | undefined): number {
  if (!raw) return 0;
  const m = raw.match(/^([\d.]+)\s*(\w+)?/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = (m[2] || 'B').toLowerCase();
  if (unit.startsWith('g')) return n * 1024;
  if (unit.startsWith('m')) return n;
  if (unit.startsWith('k')) return n / 1024;
  return n / (1024 * 1024);
}

export interface RouterDashboardStats {
  live: boolean;
  board: string | null;
  uptime: string | null;
  cpuLoad: number;
  memPct: number;
  memTotalMb: number;
}

/** Live CPU, memory, uptime and board from a MikroTik router. */
export async function fetchRouterDashboardStats(conn: RouterConn): Promise<RouterDashboardStats> {
  try {
    return await withRouter(conn, async (api) => {
      const rows = (await api.write('/system/resource/print')) as Record<string, string>[];
      const r = rows[0] || {};
      const totalMb = parseRouterMemMb(r['total-memory']);
      const freeMb = parseRouterMemMb(r['free-memory']);
      const usedMb = Math.max(0, totalMb - freeMb);
      return {
        live: true,
        board: r['board-name'] || null,
        uptime: r.uptime || null,
        cpuLoad: Number(r['cpu-load']) || 0,
        memPct: totalMb > 0 ? Number(((usedMb / totalMb) * 100).toFixed(1)) : 0,
        memTotalMb: Number(totalMb.toFixed(1)),
      };
    });
  } catch {
    return { live: false, board: null, uptime: null, cpuLoad: 0, memPct: 0, memTotalMb: 0 };
  }
}

/** Parse RouterOS rate strings ("15.2Mbps", "800k", "1234567") to bits/sec. */
export function parseRosRate(raw: string | number | undefined | null): number {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim().toLowerCase().replace(/,/g, '');
  const m = s.match(/^([\d.]+)\s*([a-z%/]*)$/);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = m[2].replace(/\/s(ec)?$/, '').replace(/ps$/, '');
  if (unit === 'g' || unit === 'gb' || unit === 'gbps') return n * 1_000_000_000;
  if (unit === 'm' || unit === 'mb' || unit === 'mbps') return n * 1_000_000;
  if (unit === 'k' || unit === 'kb' || unit === 'kbps') return n * 1_000;
  // bare number from RouterOS queue stats is already bits/sec
  return n;
}

/** Queue tree entries from the router (name + current rate in Mbps). */
export async function fetchRouterQueues(conn: RouterConn): Promise<{ name: string; avgRate: number }[]> {
  return withRouter(conn, async (api) => {
    let rows = (await api.write('/queue/tree/print')) as Record<string, string>[];
    // Some RouterOS builds need an explicit stats pass for live rate.
    if (!(rows || []).some((q) => q.rate != null && String(q.rate) !== '' && String(q.rate) !== '0')) {
      try {
        const withStats = (await api.write('/queue/tree/print', ['=stats='])) as Record<string, string>[];
        if (withStats?.length) rows = withStats;
      } catch {
        /* keep first print */
      }
    }
    const mapped = (rows || [])
      .filter((q) => q.name)
      .map((q) => {
        const bps = parseRosRate(q.rate);
        const mbps = bps / 1_000_000;
        return { name: q.name, avgRate: Number(mbps.toFixed(3)) || 0 };
      })
      .sort((a, b) => b.avgRate - a.avgRate);
    // Fall back to simple queues when the tree is empty (common on small CPE boards).
    if (!mapped.length) {
      const simple = (await api.write('/queue/simple/print')) as Record<string, string>[];
      return (simple || [])
        .filter((q) => q.name)
        .map((q) => {
          // simple queues expose rate as "rx/tx" — use the larger leg
          const raw = String(q.rate || '');
          const parts = raw.split('/');
          const bps = Math.max(parseRosRate(parts[0]), parseRosRate(parts[1] || parts[0]));
          return { name: q.name, avgRate: Number((bps / 1_000_000).toFixed(3)) || 0 };
        })
        .sort((a, b) => b.avgRate - a.avgRate);
    }
    return mapped;
  });
}

const VLAN_PARENT_TYPES = new Set([
  'ether',
  'bridge',
  'bond',
  'bonding',
  'vlan',
  'sfp',
  'sfp-plus',
  'qsfpplus',
  'wlan',
  'cap',
  'ovs-bridge',
]);

/** True when an interface name/type is PPPoE or otherwise unsuitable as a VLAN parent. */
export function isPppoeInterface(name: string, type?: string): boolean {
  const n = (name || '').toLowerCase();
  const t = (type || '').toLowerCase();
  if (t.startsWith('pppoe') || t === 'pptp-in' || t === 'pptp-out' || t === 'l2tp-in' || t === 'l2tp-out') return true;
  if (n.startsWith('pppoe-') || n.startsWith('<pppoe-') || n.includes('pppoe')) return true;
  return false;
}

/** Interfaces suitable as VLAN parents (excludes PPPoE / tunnels / disabled). */
export async function fetchVlanParentInterfaces(
  conn: RouterConn
): Promise<{ name: string; type: string; running: boolean }[]> {
  return withRouter(conn, async (api) => {
    const rows = (await api.write('/interface/print')) as Record<string, string>[];
    return (rows || [])
      .filter((i) => {
        if (!i.name || rosBool(i.disabled)) return false;
        if (isPppoeInterface(i.name, i.type)) return false;
        const type = (i.type || '').toLowerCase();
        if (VLAN_PARENT_TYPES.has(type)) return true;
        // Allow common ethernet-like names when type is blank on older ROS
        if (!type && /^(ether|sfp|bridge|bond|wlan)/i.test(i.name)) return true;
        return false;
      })
      .map((i) => ({
        name: i.name,
        type: i.type || '',
        running: rosBool(i.running),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

/** Interface names from the router. */
export async function fetchRouterInterfaceNames(conn: RouterConn): Promise<string[]> {
  return withRouter(conn, async (api) => {
    const rows = (await api.write('/interface/print')) as Record<string, string>[];
    return (rows || [])
      .filter((i) => i.name && i.disabled !== 'true')
      .map((i) => i.name);
  });
}

/** One-shot traffic sample for a set of interfaces on the router. */
export async function fetchRouterInterfaceTraffic(
  conn: RouterConn,
  names: string[]
): Promise<{ name: string; upload: number; download: number }[]> {
  if (!names.length) return [];
  return withRouter(conn, async (api) => {
    const out: { name: string; upload: number; download: number }[] = [];
    for (const name of names) {
      try {
        const rows = (await api.write('/interface/monitor-traffic', [`=interface=${name}`, '=once='])) as Record<string, string>[];
        const r = rows[0] || {};
        out.push({
          name,
          upload: Number(r['tx-bits-per-second']) || 0,
          download: Number(r['rx-bits-per-second']) || 0,
        });
      } catch {
        out.push({ name, upload: 0, download: 0 });
      }
    }
    return out;
  });
}

function rosBool(v: string | boolean | number | undefined | null): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
}

export interface FirewallRuleRow {
  id: string;
  table: 'filter' | 'nat' | 'mangle';
  chain: string;
  action: string;
  proto: string;
  dstPort: string;
  srcAddress: string;
  dstAddress: string;
  inInterface: string;
  outInterface: string;
  comment: string;
  enabled: boolean;
  bytes: number;
  packets: number;
}

function mapFirewallRow(r: Record<string, string>, table: FirewallRuleRow['table']): FirewallRuleRow {
  return {
    id: r['.id'] || '',
    table,
    chain: r.chain || '-',
    action: r.action || '-',
    proto: r.protocol || r.proto || 'all',
    dstPort: r['dst-port'] || '-',
    srcAddress: r['src-address'] || '-',
    dstAddress: r['dst-address'] || '-',
    inInterface: r['in-interface'] || '-',
    outInterface: r['out-interface'] || '-',
    comment: r.comment || '',
    enabled: !rosBool(r.disabled),
    bytes: Number(r.bytes) || 0,
    packets: Number(r.packets) || 0,
  };
}

/** Live firewall filter + NAT + mangle rules from the router. */
export async function fetchFirewallRules(conn: RouterConn): Promise<FirewallRuleRow[]> {
  return withRouter(conn, async (api) => {
    const [filter, nat, mangle] = await Promise.all([
      api.write('/ip/firewall/filter/print') as Promise<Record<string, string>[]>,
      api.write('/ip/firewall/nat/print') as Promise<Record<string, string>[]>,
      api.write('/ip/firewall/mangle/print') as Promise<Record<string, string>[]>,
    ]);
    return [
      ...(filter || []).map((r) => mapFirewallRow(r, 'filter')),
      ...(nat || []).map((r) => mapFirewallRow(r, 'nat')),
      ...(mangle || []).map((r) => mapFirewallRow(r, 'mangle')),
    ];
  });
}

export async function setFirewallRuleEnabled(
  conn: RouterConn,
  table: 'filter' | 'nat' | 'mangle',
  id: string,
  enabled: boolean
): Promise<void> {
  const path = `/ip/firewall/${table}/${enabled ? 'enable' : 'disable'}`;
  await withRouter(conn, (api) => api.write(path, [`=numbers=${id}`]));
}

export async function removeFirewallRule(
  conn: RouterConn,
  table: 'filter' | 'nat' | 'mangle',
  id: string
): Promise<void> {
  await withRouter(conn, (api) => api.write(`/ip/firewall/${table}/remove`, [`=numbers=${id}`]));
}

export async function addFirewallRule(
  conn: RouterConn,
  table: 'filter' | 'nat' | 'mangle',
  fields: Record<string, string>
): Promise<void> {
  const args = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `=${k}=${v}`);
  await withRouter(conn, (api) => api.write(`/ip/firewall/${table}/add`, args));
}

export interface IpRouteRow {
  id: string;
  dst: string;
  gateway: string;
  distance: number;
  active: boolean;
  enabled: boolean;
  interfaceName: string;
  checkGateway: string;
  routingMark: string;
  comment: string;
}

/** Full IP routing table from the router. */
export async function fetchIpRoutes(conn: RouterConn): Promise<IpRouteRow[]> {
  return withRouter(conn, async (api) => {
    const routes = (await api.write('/ip/route/print')) as Record<string, string>[];
    return (routes || []).map((r) => ({
      id: r['.id'] || '',
      dst: r['dst-address'] || '0.0.0.0/0',
      gateway: r.gateway || r['immediate-gw'] || '-',
      distance: Number(r.distance) || 0,
      active: rosBool(r.active),
      enabled: !rosBool(r.disabled),
      interfaceName: r.interface || '-',
      checkGateway: r['check-gateway'] || '',
      routingMark: r['routing-mark'] || '',
      comment: r.comment || '',
    }));
  });
}

export async function addIpRoute(
  conn: RouterConn,
  fields: { dst: string; gateway: string; distance?: number; comment?: string; checkGateway?: string }
): Promise<void> {
  const args = [`=dst-address=${fields.dst}`, `=gateway=${fields.gateway}`];
  if (fields.distance != null) args.push(`=distance=${fields.distance}`);
  if (fields.comment) args.push(`=comment=${fields.comment}`);
  if (fields.checkGateway) args.push(`=check-gateway=${fields.checkGateway}`);
  await withRouter(conn, (api) => api.write('/ip/route/add', args));
}

export async function removeIpRoute(conn: RouterConn, id: string): Promise<void> {
  await withRouter(conn, (api) => api.write('/ip/route/remove', [`=numbers=${id}`]));
}

export interface VlanRow {
  id: string;
  name: string;
  vlanId: number;
  iface: string;
  comment: string;
  enabled: boolean;
}

/** VLAN interfaces from the router. */
export async function fetchVlans(conn: RouterConn): Promise<VlanRow[]> {
  return withRouter(conn, async (api) => {
    const rows = (await api.write('/interface/vlan/print')) as Record<string, string>[];
    return (rows || []).map((v) => ({
      id: v['.id'] || '',
      name: v.name || '',
      vlanId: Number(v['vlan-id']) || 0,
      iface: v.interface || '-',
      comment: v.comment || '',
      enabled: !rosBool(v.disabled),
    }));
  });
}

export async function addVlan(
  conn: RouterConn,
  fields: { name: string; vlanId: number; iface: string; comment?: string }
): Promise<void> {
  const args = [`=name=${fields.name}`, `=vlan-id=${fields.vlanId}`, `=interface=${fields.iface}`];
  if (fields.comment) args.push(`=comment=${fields.comment}`);
  await withRouter(conn, (api) => api.write('/interface/vlan/add', args));
}

export async function removeVlan(conn: RouterConn, id: string): Promise<void> {
  await withRouter(conn, (api) => api.write('/interface/vlan/remove', [`=numbers=${id}`]));
}

export interface MultiWanLinkRow {
  name: string;
  role: 'primary' | 'backup' | 'failover';
  weight: number;
  gateway: string;
  interfaceName: string;
  distance: number;
  checkMethod: string;
  status: 'up' | 'standby' | 'down';
}

/** Multi-WAN view derived from default / check-gateway routes on the router. */
export async function fetchMultiWanLinks(conn: RouterConn): Promise<{
  enabled: boolean;
  strategy: string;
  links: MultiWanLinkRow[];
}> {
  const wan = await fetchWanRoutes(conn);
  const sorted = [...wan].sort((a, b) => a.distance - b.distance || a.gateway.localeCompare(b.gateway));
  const links: MultiWanLinkRow[] = sorted.map((r, i) => {
    let role: MultiWanLinkRow['role'] = 'failover';
    if (i === 0) role = 'primary';
    else if (i === 1) role = 'backup';
    const weight = Math.max(
      1,
      Math.round((1 / Math.max(1, r.distance) / sorted.reduce((s, x) => s + 1 / Math.max(1, x.distance), 0)) * 100)
    );
    let status: MultiWanLinkRow['status'] = 'down';
    if (!r.enabled) status = 'down';
    else if (r.status === 'Active') status = 'up';
    else status = 'standby';
    return {
      name: r.interfaceName || r.gateway,
      role,
      weight: sorted.length === 1 ? 100 : weight,
      gateway: r.gateway,
      interfaceName: r.interfaceName || '-',
      distance: r.distance,
      checkMethod: r.checkMethod,
      status,
    };
  });
  const sum = links.reduce((s, l) => s + l.weight, 0) || 1;
  if (links.length > 1 && sum !== 100) {
    let acc = 0;
    links.forEach((l, i) => {
      if (i === links.length - 1) l.weight = Math.max(1, 100 - acc);
      else {
        l.weight = Math.max(1, Math.round((l.weight / sum) * 100));
        acc += l.weight;
      }
    });
  }
  return {
    enabled: links.some((l) => l.status === 'up' || l.status === 'standby'),
    strategy: links.length
      ? `Distance-based failover (${links.filter((l) => l.checkMethod && l.checkMethod !== 'route').length ? 'check-gateway' : 'default routes'})`
      : 'No WAN routes',
    links,
  };
}

/** Interface list + LAN IP hints for multi-WAN script assistant. */
export async function fetchNetworkInterfaces(conn: RouterConn): Promise<{
  interfaces: { name: string; type: string; running: boolean; disabled: boolean }[];
  addresses: { address: string; interface: string; network: string }[];
}> {
  return withRouter(conn, async (api) => {
    const [ifaces, addrs] = await Promise.all([
      api.write('/interface/print') as Promise<Record<string, string>[]>,
      api.write('/ip/address/print') as Promise<Record<string, string>[]>,
    ]);
    return {
      interfaces: (ifaces || []).map((i) => ({
        name: i.name || '',
        type: i.type || '',
        running: rosBool(i.running),
        disabled: rosBool(i.disabled),
      })),
      addresses: (addrs || []).map((a) => ({
        address: a.address || '',
        interface: a.interface || '',
        network: a.network || '',
      })),
    };
  });
}

// ---------------- PPP / PPPoE ----------------

export interface PppSecretRow {
  id: string;
  name: string;
  password: string;
  profile: string;
  service: string;
  comment: string;
  disabled: boolean;
  callerId: string;
}

export interface PppActiveRow {
  id: string;
  name: string;
  address: string;
  uptime: string;
  caller: string;
  service: string;
  profile: string;
}

export interface PppProfileRow {
  id: string;
  name: string;
  rateLimit: string;
  localAddress: string;
  remoteAddress: string;
  onlyOne: string;
  comment: string;
}

export interface PppoeServerRow {
  id: string;
  name: string;
  interface: string;
  maxSessions: number;
  service: string;
  authentication: string;
  status: string;
  disabled: boolean;
  oneSessionPerHost: boolean;
}

export async function fetchPppSecrets(conn: RouterConn): Promise<PppSecretRow[]> {
  return withRouter(conn, async (api) => {
    const rows = (await api.write('/ppp/secret/print')) as Record<string, string>[];
    return (rows || []).map((s) => ({
      id: s['.id'] || '',
      name: s.name || '',
      password: s.password || '',
      profile: s.profile || '',
      service: s.service || 'pppoe',
      comment: s.comment || '',
      disabled: rosBool(s.disabled),
      callerId: s['caller-id'] || '',
    }));
  });
}

export async function fetchPppActive(conn: RouterConn): Promise<PppActiveRow[]> {
  return withRouter(conn, async (api) => {
    const rows = (await api.write('/ppp/active/print')) as Record<string, string>[];
    return (rows || []).map((a) => ({
      id: a['.id'] || '',
      name: a.name || '',
      address: a.address || '-',
      uptime: a.uptime || '-',
      caller: a['caller-id'] || a.caller || '-',
      service: a.service || 'pppoe',
      profile: a.profile || '-',
    }));
  });
}

/** Case-insensitive lookup for PPP secret / active session names. */
export function pppNameKey(name: string | null | undefined): string {
  return String(name || '').trim().toLowerCase();
}

export interface PppEnrichInput {
  username: string;
  status?: string;
  profile?: string;
  online?: number | boolean;
}

/**
 * Merge MikroTik PPP secret + active-session state onto panel user rows.
 * - Username match is case-insensitive (Winbox vs DB casing often differs).
 * - A live session means the account is effectively enabled → clear stale "disabled".
 * - Only mark disabled when the secret is disabled AND there is no active session.
 */
export function enrichPppUsersFromLive<T extends PppEnrichInput>(
  users: T[],
  secrets: PppSecretRow[],
  sessions: PppActiveRow[]
): (T & { status: string; online: number; sessionOnline: boolean; mikrotikProfile: string | null })[] {
  const byName = new Map(secrets.map((s) => [pppNameKey(s.name), s]));
  const onlineSet = new Set(sessions.map((s) => pppNameKey(s.name)).filter(Boolean));

  return users.map((u) => {
    const key = pppNameKey(u.username);
    const sec = byName.get(key);
    const sessionOnline = onlineSet.has(key);
    let status = String(u.status || 'Active');
    let profile = u.profile;

    if (sec) {
      profile = sec.profile || u.profile;
      if (sec.disabled && !sessionOnline) {
        status = 'disabled';
      } else if (!sec.disabled && status.toLowerCase() === 'disabled') {
        // Secret is enabled on MikroTik — clear stale billing/DB disabled flag.
        status = 'Active';
      } else if (sessionOnline && status.toLowerCase() === 'disabled') {
        // Connected users cannot be treated as disabled for status tiles / map.
        status = 'Active';
      }
    } else if (sessionOnline && status.toLowerCase() === 'disabled') {
      status = 'Active';
    }

    return {
      ...u,
      profile,
      status,
      online: sessionOnline ? 1 : 0,
      sessionOnline,
      mikrotikProfile: sec?.profile || null,
    };
  });
}

export async function fetchPppProfiles(conn: RouterConn): Promise<PppProfileRow[]> {
  return withRouter(conn, async (api) => {
    const rows = (await api.write('/ppp/profile/print')) as Record<string, string>[];
    return (rows || []).map((p) => ({
      id: p['.id'] || '',
      name: p.name || '',
      rateLimit: p['rate-limit'] || '',
      localAddress: p['local-address'] || '',
      remoteAddress: p['remote-address'] || '',
      onlyOne: p['only-one'] || '',
      comment: p.comment || '',
    }));
  });
}

export async function addPppProfile(
  conn: RouterConn,
  fields: { name: string; rateLimit?: string; localAddress?: string; remoteAddress?: string; comment?: string }
): Promise<void> {
  const args = [`=name=${fields.name}`];
  if (fields.rateLimit) args.push(`=rate-limit=${fields.rateLimit}`);
  if (fields.localAddress) args.push(`=local-address=${fields.localAddress}`);
  if (fields.remoteAddress) args.push(`=remote-address=${fields.remoteAddress}`);
  if (fields.comment) args.push(`=comment=${fields.comment}`);
  await withRouter(conn, (api) => api.write('/ppp/profile/add', args));
}

export async function updatePppProfile(
  conn: RouterConn,
  id: string,
  fields: { name?: string; rateLimit?: string; localAddress?: string; remoteAddress?: string; comment?: string }
): Promise<void> {
  const args = [`=.id=${id}`];
  if (fields.name) args.push(`=name=${fields.name}`);
  if (fields.rateLimit != null) args.push(`=rate-limit=${fields.rateLimit}`);
  if (fields.localAddress != null) args.push(`=local-address=${fields.localAddress}`);
  if (fields.remoteAddress != null) args.push(`=remote-address=${fields.remoteAddress}`);
  if (fields.comment != null) args.push(`=comment=${fields.comment}`);
  await withRouter(conn, (api) => api.write('/ppp/profile/set', args));
}

export async function removePppProfile(conn: RouterConn, id: string): Promise<void> {
  await withRouter(conn, (api) => api.write('/ppp/profile/remove', [`=numbers=${id}`]));
}

export async function setPppSecretEnabled(conn: RouterConn, nameOrId: string, enabled: boolean): Promise<void> {
  await withRouter(conn, (api) =>
    api.write(enabled ? '/ppp/secret/enable' : '/ppp/secret/disable', [`=numbers=${nameOrId}`])
  );
}

export async function fetchPppoeServers(conn: RouterConn): Promise<PppoeServerRow[]> {
  return withRouter(conn, async (api) => {
    const rows = (await api.write('/interface/pppoe-server/server/print')) as Record<string, string>[];
    return (rows || []).map((s) => {
      const disabled = rosBool(s.disabled);
      return {
        id: s['.id'] || '',
        name: s['service-name'] || s.name || '',
        interface: s.interface || '-',
        maxSessions: Number(s['max-sessions'] || s['max-session'] || 0) || 0,
        service: 'pppoe',
        authentication: s.authentication || s.auth || '-',
        status: disabled ? 'disabled' : 'running',
        disabled,
        oneSessionPerHost: rosBool(s['one-session-per-host']),
      };
    });
  });
}

// ---------------- DHCP / IPoE ----------------

export interface DhcpLeaseRow {
  id: string;
  address: string;
  macAddress: string;
  hostName: string;
  server: string;
  status: string;
  expiresAfter: string;
  lastSeen: string;
  comment: string;
  dynamic: boolean;
  blocked: boolean;
  activeAddress: string;
  activeMac: string;
  activeServer: string;
}

export interface DhcpServerRow {
  id: string;
  name: string;
  interface: string;
  addressPool: string;
  leaseTime: string;
  disabled: boolean;
  authoritative: string;
}

export async function fetchDhcpLeases(conn: RouterConn): Promise<DhcpLeaseRow[]> {
  return withRouter(conn, async (api) => {
    const rows = (await api.write('/ip/dhcp-server/lease/print')) as Record<string, string>[];
    return (rows || []).map((l) => ({
      id: l['.id'] || '',
      address: l.address || l['active-address'] || '',
      macAddress: (l['mac-address'] || l['active-mac-address'] || '').toUpperCase(),
      hostName: l['host-name'] || '',
      server: l.server || l['active-server'] || '',
      status: l.status || (rosBool(l.blocked) ? 'blocked' : 'unknown'),
      expiresAfter: l['expires-after'] || '',
      lastSeen: l['last-seen'] || '',
      comment: l.comment || '',
      dynamic: rosBool(l.dynamic),
      blocked: rosBool(l.blocked),
      activeAddress: l['active-address'] || '',
      activeMac: (l['active-mac-address'] || '').toUpperCase(),
      activeServer: l['active-server'] || '',
    }));
  });
}

export async function setDhcpLeaseBlocked(conn: RouterConn, id: string, blocked: boolean): Promise<void> {
  await withRouter(conn, (api) =>
    api.write('/ip/dhcp-server/lease/set', [`=.id=${id}`, `=blocked=${blocked ? 'yes' : 'no'}`])
  );
}

export async function fetchDhcpServers(conn: RouterConn): Promise<DhcpServerRow[]> {
  return withRouter(conn, async (api) => {
    const rows = (await api.write('/ip/dhcp-server/print')) as Record<string, string>[];
    return (rows || []).map((s) => ({
      id: s['.id'] || '',
      name: s.name || '',
      interface: s.interface || '',
      addressPool: s['address-pool'] || '',
      leaseTime: s['lease-time'] || '',
      disabled: rosBool(s.disabled),
      authoritative: s.authoritative || '',
    }));
  });
}

export async function addDhcpServer(
  conn: RouterConn,
  fields: { name: string; interface: string; addressPool: string; leaseTime?: string }
): Promise<void> {
  const args = [
    `=name=${fields.name}`,
    `=interface=${fields.interface}`,
    `=address-pool=${fields.addressPool}`,
  ];
  if (fields.leaseTime) args.push(`=lease-time=${fields.leaseTime}`);
  await withRouter(conn, (api) => api.write('/ip/dhcp-server/add', args));
}

export async function updateDhcpServer(
  conn: RouterConn,
  id: string,
  fields: { name?: string; interface?: string; addressPool?: string; leaseTime?: string; disabled?: boolean }
): Promise<void> {
  const args = [`=.id=${id}`];
  if (fields.name) args.push(`=name=${fields.name}`);
  if (fields.interface) args.push(`=interface=${fields.interface}`);
  if (fields.addressPool) args.push(`=address-pool=${fields.addressPool}`);
  if (fields.leaseTime) args.push(`=lease-time=${fields.leaseTime}`);
  if (fields.disabled != null) args.push(`=disabled=${fields.disabled ? 'yes' : 'no'}`);
  await withRouter(conn, (api) => api.write('/ip/dhcp-server/set', args));
}

export async function removeDhcpServer(conn: RouterConn, id: string): Promise<void> {
  await withRouter(conn, (api) => api.write('/ip/dhcp-server/remove', [`=numbers=${id}`]));
}

/** Live rx/tx bits-per-second for PPP active sessions via their dynamic interfaces. */
export async function fetchPppActiveTraffic(
  conn: RouterConn,
  usernames: string[]
): Promise<Record<string, { download: number; upload: number }>> {
  if (!usernames.length) return {};
  return withRouter(conn, async (api) => {
    const ifaces = (await api.write('/interface/print')) as Record<string, string>[];
    const byUser = new Map<string, string>();
    for (const iface of ifaces || []) {
      const name = iface.name || '';
      // <pppoe-username> or similar
      const m = name.match(/^<pppoe-(.+)>$/i) || name.match(/^pppoe-(.+)$/i);
      if (m) byUser.set(m[1], name);
    }
    const out: Record<string, { download: number; upload: number }> = {};
    for (const user of usernames) {
      const iface = byUser.get(user);
      if (!iface) continue;
      try {
        const rows = (await api.write('/interface/monitor-traffic', [
          `=interface=${iface}`,
          '=once=',
        ])) as Record<string, string>[];
        const r = rows?.[0] || {};
        out[user] = {
          download: Number(r['rx-bits-per-second']) || 0,
          upload: Number(r['tx-bits-per-second']) || 0,
        };
      } catch {
        /* skip */
      }
    }
    return out;
  });
}

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

/** Queue tree entries from the router (name + bits/sec rate). */
export async function fetchRouterQueues(conn: RouterConn): Promise<{ name: string; avgRate: number }[]> {
  return withRouter(conn, async (api) => {
    const rows = (await api.write('/queue/tree/print')) as Record<string, string>[];
    return (rows || [])
      .filter((q) => q.name)
      .map((q) => {
        const bps = Number(q.rate || q['bytes'] || 0);
        // RouterOS rate is often bits/sec; convert to Mbps for display consistency.
        const mbps = bps > 10_000 ? bps / 1_000_000 : bps;
        return { name: q.name, avgRate: Number(mbps.toFixed(3)) || 0 };
      })
      .sort((a, b) => b.avgRate - a.avgRate);
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

function rosBool(v: string | undefined): boolean {
  return v === 'true' || v === 'yes';
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

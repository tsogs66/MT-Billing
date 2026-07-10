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
  gateway: string;
  checkMethod: string;
  distance: number;
  status: string;
  interfaceName: string | null;
  dstAddress: string;
}

/** Fetch monitored WAN routes (check-gateway or default routes) from a router. */
export async function fetchWanRoutes(conn: RouterConn): Promise<WanRouteRow[]> {
  return withRouter(conn, async (api) => {
    const routes = (await api.write('/ip/route/print')) as Record<string, string>[];
    const out: WanRouteRow[] = [];
    for (const r of routes || []) {
      const check = r['check-gateway'] || '';
      const gateway = r.gateway || '';
      const dst = r['dst-address'] || '0.0.0.0/0';
      if (!gateway) continue;
      // Include routes with check-gateway or default routes on WAN interfaces.
      const iface = r['interface'] || r.interface || null;
      const isDefault = dst === '0.0.0.0/0';
      if (!check && !isDefault) continue;
      const active = r.active === 'true' || r.active === 'yes';
      out.push({
        gateway,
        checkMethod: check || (isDefault ? 'route' : 'ping'),
        distance: Number(r.distance) || 1,
        status: active ? 'Active' : 'Inactive',
        interfaceName: iface,
        dstAddress: dst,
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

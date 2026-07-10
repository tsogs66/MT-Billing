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

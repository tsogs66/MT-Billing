import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

const WRITE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/** Paths that may mutate even when the panel license is inactive. */
function isLicenseWriteAllowed(url?: string) {
  const path = String(url || '');
  return (
    /\/license\/(activate|deactivate)\b/.test(path) ||
    /(^|\/)login\b/.test(path) ||
    /\/auth\//.test(path)
  );
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mt_token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }

  const method = String(config.method || 'get').toLowerCase();
  // Only enforce read-only when a session exists and license is inactive
  if (token && WRITE_METHODS.has(method) && !isLicenseWriteAllowed(config.url)) {
    const licensed = localStorage.getItem('mt_licensed') === '1';
    if (!licensed) {
      return Promise.reject({
        response: {
          status: 403,
          data: {
            error: 'License required',
            code: 'LICENSE_READONLY',
            message: 'Panel is read-only until a license is activated.',
          },
        },
        config,
        isAxiosError: true,
        toJSON: () => ({}),
      });
    }
  }

  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && localStorage.getItem('mt_token')) {
      localStorage.removeItem('mt_token');
      localStorage.removeItem('mt_licensed');
      if (!location.pathname.startsWith('/login')) location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const peso = (n: number) =>
  `\u20b1${(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Extend an ISO date (YYYY-MM-DD) by whole months, anchored on the original
 * date and preserving its day-of-month (mirrors the server logic). Used to
 * preview the new expiration before a payment is confirmed.
 */
export function addMonthsPreserveDay(iso: string, months: number): string {
  if (!iso) return iso;
  const base = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const day = base.getUTCDate();
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTarget));
  return target.toISOString().slice(0, 10);
}

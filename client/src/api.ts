import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mt_token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && localStorage.getItem('mt_token')) {
      localStorage.removeItem('mt_token');
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

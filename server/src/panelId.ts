import os from 'os';
import crypto from 'crypto';

/** Stable panel hardware ID (shown on License and Forgot Password screens). */
export function panelHardwareId(): string {
  const nets = os.networkInterfaces();
  let mac = '';
  for (const key of Object.keys(nets)) {
    for (const ni of nets[key] || []) {
      if (!ni.internal && ni.mac && ni.mac !== '00:00:00:00:00:00') {
        mac = ni.mac;
        break;
      }
    }
    if (mac) break;
  }
  const cpu = os.cpus()[0]?.model || 'cpu';
  const raw = [os.hostname(), mac, os.arch(), os.platform(), cpu].join('|');
  const h = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}`;
}

export const LICENSE_SECRET = 'MT-BILLING-LICENSE-2026';
export const PASSWORD_RESET_SECRET = 'MT-BILLING-PASSWORD-RESET-2026';

export function expectedLicenseKey(hwid: string): string {
  const norm = normalizeCode(hwid);
  const h = crypto.createHmac('sha256', LICENSE_SECRET).update(norm).digest('hex').toUpperCase();
  return `${h.slice(0, 5)}-${h.slice(5, 10)}-${h.slice(10, 15)}-${h.slice(15, 20)}`;
}

/** Vendor-generated code from panel hardware ID (prefix RST- for identification). */
export function expectedPasswordResetCode(hwid: string): string {
  const norm = normalizeCode(hwid);
  const h = crypto.createHmac('sha256', PASSWORD_RESET_SECRET).update(norm).digest('hex').toUpperCase();
  return `RST-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}`;
}

export function normalizeCode(k: string): string {
  return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

import { withRouter, type RouterConn } from './mikrotik.js';

/** Billing metadata stored in MikroTik /ppp/secret comment. */
export interface PppSecretComment {
  plan: string;
  dueDate: string;
  accountNumber: number | string;
  expireProfile: string;
  customer?: {
    fullName?: string;
    address?: string;
    contactNumber?: string;
    email?: string;
    latitude?: number | null;
    longitude?: number | null;
    plcPort?: string | null;
    status?: string;
  };
}

export function buildSecretComment(user: {
  profile: string;
  subscription_due?: string | null;
  account_number?: string | null;
  expiration_profile?: string | null;
  customer_name?: string | null;
  address?: string | null;
  contact?: string | null;
  email?: string | null;
  lat?: number | null;
  lng?: number | null;
  plc_port?: string | null;
  status?: string | null;
}): string {
  const raw = String(user.account_number || '').trim();
  const accountNumber = /^\d+$/.test(raw) ? Number(raw) : raw || 0;
  const payload: PppSecretComment = {
    plan: user.profile || '15mbps',
    dueDate: String(user.subscription_due || '').slice(0, 10),
    accountNumber,
    expireProfile: user.expiration_profile || 'default',
    customer: {
      fullName: user.customer_name || undefined,
      address: user.address || undefined,
      contactNumber: user.contact || undefined,
      email: user.email || undefined,
      latitude: user.lat != null ? Number(user.lat) : null,
      longitude: user.lng != null ? Number(user.lng) : null,
      plcPort: user.plc_port != null ? String(user.plc_port) : null,
      status: user.status || undefined,
    },
  };
  return JSON.stringify(payload);
}

/** Parse RouterOS secret comment — supports flat JSON and nested customer blobs. */
export function parseSecretComment(comment: unknown): Partial<PppSecretComment> & { customer?: Record<string, unknown> } {
  if (!comment || typeof comment !== 'string') return {};
  const s = comment.trim();
  if (!s.startsWith('{')) return {};
  try {
    const o = JSON.parse(s);
    if (!o || typeof o !== 'object') return {};
    const flat: Partial<PppSecretComment> = {};
    if (o.plan != null) flat.plan = String(o.plan);
    if (o.dueDate != null) flat.dueDate = String(o.dueDate).slice(0, 10);
    if (o.accountNumber != null) flat.accountNumber = o.accountNumber;
    if (o.expireProfile != null) flat.expireProfile = String(o.expireProfile);
    if (o.customer && typeof o.customer === 'object') {
      return { ...flat, customer: o.customer as Record<string, unknown> };
    }
    return flat;
  } catch {
    return {};
  }
}

function rosService(service: string): string {
  return service === 'ipoe' ? 'any' : 'pppoe';
}

function isDisabledStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'disabled' || s === 'inactive';
}

async function findSecret(api: any, username: string): Promise<Record<string, string> | null> {
  const rows = (await api.write('/ppp/secret/print', [`?name=${username}`])) as Record<string, string>[];
  return rows?.[0] || null;
}

/** Create or update a PPP secret on MikroTik with billing JSON in comment. */
export async function upsertPppSecret(
  conn: RouterConn,
  user: {
    username: string;
    /** When renaming, look up the existing secret by this name. */
    previousUsername?: string | null;
    password?: string | null;
    profile: string;
    subscription_due?: string | null;
    account_number?: string | null;
    expiration_profile?: string | null;
    status?: string | null;
    service?: string | null;
    customer_name?: string | null;
    address?: string | null;
    contact?: string | null;
    email?: string | null;
    lat?: number | null;
    lng?: number | null;
    plc_port?: string | null;
  }
): Promise<{ action: 'created' | 'updated'; secretId: string }> {
  const comment = buildSecretComment(user);
  const service = rosService(user.service || 'pppoe');
  const disabled = isDisabledStatus(user.status);
  const lookupName =
    user.previousUsername && user.previousUsername !== user.username
      ? user.previousUsername
      : user.username;

  return withRouter(conn, async (api) => {
    const existing = await findSecret(api, lookupName);
    if (existing) {
      const id = existing['.id'] || existing.name;
      const args = [
        `=numbers=${id}`,
        `=profile=${user.profile}`,
        `=comment=${comment}`,
        `=service=${service}`,
      ];
      if (user.previousUsername && user.previousUsername !== user.username) {
        args.push(`=name=${user.username}`);
      }
      if (user.password) args.push(`=password=${user.password}`);
      await api.write('/ppp/secret/set', args);
      if (disabled) await api.write('/ppp/secret/disable', [`=numbers=${id}`]);
      else await api.write('/ppp/secret/enable', [`=numbers=${id}`]);
      return { action: 'updated' as const, secretId: String(id) };
    }

    // Rename case: old secret missing but new name already exists — update that one.
    if (lookupName !== user.username) {
      const byNew = await findSecret(api, user.username);
      if (byNew) {
        const id = byNew['.id'] || byNew.name;
        const args = [
          `=numbers=${id}`,
          `=profile=${user.profile}`,
          `=comment=${comment}`,
          `=service=${service}`,
        ];
        if (user.password) args.push(`=password=${user.password}`);
        await api.write('/ppp/secret/set', args);
        if (disabled) await api.write('/ppp/secret/disable', [`=numbers=${id}`]);
        else await api.write('/ppp/secret/enable', [`=numbers=${id}`]);
        return { action: 'updated' as const, secretId: String(id) };
      }
    }

    const addArgs = [
      `=name=${user.username}`,
      `=password=${user.password || ''}`,
      `=profile=${user.profile}`,
      `=comment=${comment}`,
      `=service=${service}`,
    ];
    const created = (await api.write('/ppp/secret/add', addArgs)) as { ret?: string } | { ret?: string }[];
    const secretId = Array.isArray(created) ? created[0]?.ret : created?.ret;
    if (disabled && secretId) await api.write('/ppp/secret/disable', [`=numbers=${secretId}`]);
    return { action: 'created' as const, secretId: String(secretId || user.username) };
  });
}

export async function setPppSecretEnabled(conn: RouterConn, username: string, enabled: boolean): Promise<void> {
  await withRouter(conn, async (api) => {
    const existing = await findSecret(api, username);
    if (!existing) throw new Error(`PPP secret not found: ${username}`);
    const id = existing['.id'] || existing.name;
    await api.write(enabled ? '/ppp/secret/enable' : '/ppp/secret/disable', [`=numbers=${id}`]);
  });
}

/** Switch the live RouterOS PPP profile (e.g. to non-payments on expiry) without changing panel billing plan. */
export async function setPppSecretProfile(
  conn: RouterConn,
  user: {
    username: string;
    profile: string;
    subscription_due?: string | null;
    account_number?: string | null;
    expiration_profile?: string | null;
    customer_name?: string | null;
    address?: string | null;
    contact?: string | null;
    email?: string | null;
    lat?: number | null;
    lng?: number | null;
    plc_port?: string | null;
    status?: string | null;
    service?: string | null;
  },
  mikrotikProfile: string
): Promise<void> {
  const comment = buildSecretComment(user);
  await withRouter(conn, async (api) => {
    const existing = await findSecret(api, user.username);
    if (!existing) throw new Error(`PPP secret not found: ${user.username}`);
    const id = existing['.id'] || existing.name;
    await api.write('/ppp/secret/set', [
      `=numbers=${id}`,
      `=profile=${mikrotikProfile}`,
      `=comment=${comment}`,
    ]);
  });
}

export async function removePppSecret(conn: RouterConn, username: string): Promise<boolean> {
  return withRouter(conn, async (api) => {
    const existing = await findSecret(api, username);
    if (!existing) return false;
    const id = existing['.id'] || existing.name;
    await api.write('/ppp/secret/remove', [`=numbers=${id}`]);
    return true;
  });
}

export async function fetchPppSecret(conn: RouterConn, username: string): Promise<Record<string, string> | null> {
  return withRouter(conn, (api) => findSecret(api, username));
}

export async function fetchPppSecrets(conn: RouterConn): Promise<Record<string, string>[]> {
  return withRouter(conn, async (api) => (await api.write('/ppp/secret/print')) as Record<string, string>[]);
}

export async function fetchPppActive(conn: RouterConn): Promise<Record<string, string>[]> {
  return withRouter(conn, async (api) => (await api.write('/ppp/active/print')) as Record<string, string>[]);
}

export async function fetchPppProfiles(conn: RouterConn): Promise<Record<string, string>[]> {
  return withRouter(conn, async (api) => (await api.write('/ppp/profile/print')) as Record<string, string>[]);
}

export async function fetchPppoeServers(conn: RouterConn): Promise<Record<string, string>[]> {
  return withRouter(conn, async (api) => (await api.write('/interface/pppoe-server/print')) as Record<string, string>[]);
}

export function secretIsDisabled(sec: Record<string, string> | null | undefined): boolean {
  if (!sec) return false;
  return sec.disabled === 'true' || (sec.disabled as unknown) === true;
}

/** Merge MikroTik secret + active session into panel user fields. */
export function mergeMikrotikUserState(
  secret: Record<string, string> | null,
  connected: boolean
): {
  profile: string;
  subscription_due: string;
  expiration_profile: string;
  account_number: string;
  status: string;
  online: number;
  customer_name?: string;
  address?: string | null;
  contact?: string | null;
  email?: string | null;
  lat?: number | null;
  lng?: number | null;
  plc_port?: string | null;
} | null {
  if (!secret) return null;
  const meta = parseSecretComment(secret.comment);
  const cust = meta.customer || {};
  const disabled = secretIsDisabled(secret);
  return {
    profile: String(meta.plan || secret.profile || '15mbps'),
    subscription_due: meta.dueDate
      ? String(meta.dueDate).slice(0, 10)
      : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    expiration_profile: String(meta.expireProfile || 'default'),
    account_number: meta.accountNumber != null ? String(meta.accountNumber) : '',
    status: disabled ? 'disabled' : 'Active',
    online: disabled ? 0 : connected ? 1 : 0,
    customer_name: (cust.fullName as string) || undefined,
    address: (cust.address as string) || null,
    contact: (cust.contactNumber as string) || null,
    email: (cust.email as string) || null,
    lat: cust.latitude != null ? Number(cust.latitude) : null,
    lng: cust.longitude != null ? Number(cust.longitude) : null,
    plc_port: cust.plcPort != null && cust.plcPort !== '' ? String(cust.plcPort) : null,
  };
}

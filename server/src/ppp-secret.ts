import { withRouter, type RouterConn } from './mikrotik.js';

/** Billing metadata stored in MikroTik /ppp/secret comment. */
export interface PppSecretComment {
  plan: string;
  dueDate: string;
  accountNumber: number | string;
  expireProfile: string;
}

export function buildSecretComment(user: {
  profile: string;
  subscription_due?: string | null;
  account_number?: string | null;
  expiration_profile?: string | null;
}): string {
  const raw = String(user.account_number || '').trim();
  const accountNumber = /^\d+$/.test(raw) ? Number(raw) : raw || 0;
  const payload: PppSecretComment = {
    plan: user.profile || '15mbps',
    dueDate: String(user.subscription_due || '').slice(0, 10),
    accountNumber,
    expireProfile: user.expiration_profile || 'default',
  };
  return JSON.stringify(payload);
}

/** Parse RouterOS secret comment — supports flat JSON and legacy nested customer blobs. */
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
    password?: string | null;
    profile: string;
    subscription_due?: string | null;
    account_number?: string | null;
    expiration_profile?: string | null;
    status?: string | null;
    service?: string | null;
  }
): Promise<{ action: 'created' | 'updated'; secretId: string }> {
  const comment = buildSecretComment(user);
  const service = rosService(user.service || 'pppoe');
  const disabled = isDisabledStatus(user.status);

  return withRouter(conn, async (api) => {
    const existing = await findSecret(api, user.username);
    if (existing) {
      const id = existing['.id'] || existing.name;
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
  return sec.disabled === 'true' || sec.disabled === true as unknown as string;
}

/** Merge MikroTik secret + active session into panel user fields. */
export function mergeMikrotikUserState(
  secret: Record<string, string> | null,
  connected: boolean
): { profile: string; subscription_due: string; expiration_profile: string; account_number: string; status: string; online: number } | null {
  if (!secret) return null;
  const meta = parseSecretComment(secret.comment);
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
  };
}

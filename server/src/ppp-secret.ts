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

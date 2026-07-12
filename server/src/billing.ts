import crypto from 'crypto';
import { db } from './db.js';
import {
  updatePppSecret,
  setPppSecretEnabled,
  removePppActiveByName,
  buildPppSecretComment,
  ensurePppProfile,
} from './mikrotik.js';

const SESSION_REFRESH_MS = 5000;

function needsSessionRefresh(status?: string | null): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'non-payment' || s === 'nonpayment' || s === 'expired' || s === 'disabled';
}

/**
 * Briefly disable then re-enable the PPP secret so MikroTik drops and refreshes
 * any active session (picks up restored plan after non-payment / expiry).
 */
export async function bouncePppSessionForRefresh(
  router: any,
  username: string,
  waitMs = SESSION_REFRESH_MS
): Promise<{ bounced: boolean; waitMs: number; error?: string }> {
  try {
    await setPppSecretEnabled(router, username, false);
    try {
      await removePppActiveByName(router, username);
    } catch {
      /* best-effort session drop */
    }
    await new Promise((r) => setTimeout(r, Math.max(0, waitMs)));
    await setPppSecretEnabled(router, username, true);
    return { bounced: true, waitMs };
  } catch (e: any) {
    try {
      await setPppSecretEnabled(router, username, true);
    } catch {
      /* leave best-effort re-enable */
    }
    return { bounced: false, waitMs, error: e?.message || String(e) };
  }
}

/** Normalize a base URL (trim, no trailing slash, ensure scheme). */
export function normalizeBaseUrl(raw?: string | null): string | undefined {
  let s = String(raw || '').trim().replace(/\/$/, '');
  if (!s) return undefined;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname) return undefined;
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

/** True for localhost / RFC1918 hosts — not reachable by subscribers on the internet. */
export function isPrivateBaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Public base URL for subscriber pay links (SMS/email/share).
 * Prefer configured public URL over LAN panel origin.
 */
export function resolvePublicBaseUrl(preferred?: string | null): {
  baseUrl?: string;
  source: 'public_base_url' | 'env' | 'ngrok' | 'preferred' | 'none';
  warning?: string;
} {
  const app = db
    .prepare('SELECT public_base_url, ngrok_url, ngrok_status FROM app_settings WHERE id = 1')
    .get() as { public_base_url?: string; ngrok_url?: string; ngrok_status?: string } | undefined;

  const ordered: { url?: string; source: 'public_base_url' | 'env' | 'ngrok' | 'preferred' }[] = [
    { url: normalizeBaseUrl(app?.public_base_url), source: 'public_base_url' },
    { url: normalizeBaseUrl(process.env.PUBLIC_BASE_URL), source: 'env' },
    {
      url:
        app?.ngrok_status === 'running' ? normalizeBaseUrl(app?.ngrok_url) : undefined,
      source: 'ngrok',
    },
    { url: normalizeBaseUrl(preferred), source: 'preferred' },
  ];

  const publicHit = ordered.find((c) => c.url && !isPrivateBaseUrl(c.url!));
  if (publicHit?.url) return { baseUrl: publicHit.url, source: publicHit.source };

  const anyHit = ordered.find((c) => c.url);
  if (anyHit?.url) {
    return {
      baseUrl: anyHit.url,
      source: anyHit.source,
      warning:
        'Pay links use a local/private address. Set a public URL (domain, Cloudflare Tunnel, or ngrok) so subscribers can open them from anywhere.',
    };
  }
  return {
    baseUrl: undefined,
    source: 'none',
    warning: 'No public pay portal URL configured. Set one under Payment Links or System Settings.',
  };
}

export function absolutePayUrl(pathOrToken: string, preferred?: string | null): string {
  const path = pathOrToken.startsWith('/pay/')
    ? pathOrToken
    : pathOrToken.startsWith('/')
      ? pathOrToken
      : `/pay/${pathOrToken}`;
  const { baseUrl } = resolvePublicBaseUrl(preferred);
  return baseUrl ? `${baseUrl}${path}` : path;
}

export function addMonthsPreserveDay(iso: string, months: number): string {
  const raw = String(iso || '').slice(0, 10);
  const [y, m, d] = raw.split('-').map(Number);
  if (!y || !m || !d) {
    const dt = new Date();
    dt.setUTCMonth(dt.getUTCMonth() + months);
    return dt.toISOString().slice(0, 10);
  }
  const targetMonth = m - 1 + months;
  const ny = y + Math.floor(targetMonth / 12);
  const nm = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function commentFromUser(u: any): string {
  return buildPppSecretComment({
    plan: u.profile,
    dueDate: u.subscription_due,
    expireProfile: u.expiration_profile || 'non-payments',
    accountNumber: u.account_number,
    customer: {
      fullName: u.customer_name,
      address: u.address,
      contactNumber: u.contact,
      email: u.email,
      napId: u.nap_id,
      status: u.status,
      plcPort: u.plc_port,
      latitude: u.lat,
      longitude: u.lng,
    },
  });
}

/** Billing plan row + linked MikroTik PPP profile (must already exist on the router). */
export function getBillingPlan(planName: string): {
  name: string;
  price: number;
  rateLimit: string;
  pppProfile: string;
} | null {
  const plan = String(planName || '').trim();
  if (!plan) return null;
  const row = db
    .prepare('SELECT name, price, rate_limit, ppp_profile FROM profiles WHERE name = ?')
    .get(plan) as { name: string; price: number; rate_limit?: string; ppp_profile?: string } | undefined;
  if (!row) return null;
  const linked = String(row.ppp_profile || '').trim();
  return {
    name: row.name,
    price: Number(row.price) || 0,
    rateLimit: String(row.rate_limit || '').trim(),
    pppProfile: linked || row.name,
  };
}

/** MikroTik /ppp/secret profile name for a billing plan (never creates profiles). */
export function mikrotikProfileForPlan(planName: string): string {
  return getBillingPlan(planName)?.pppProfile || String(planName || '').trim();
}

/**
 * Change a user's billing plan: update DB, rewrite PPP secret comment + profile
 * on MikroTik, then briefly disable/enable so the active session picks up the plan.
 */
export async function changePppoeUserPlan(
  userId: number,
  planName: string,
  opts?: { bounce?: boolean }
): Promise<{
  ok: boolean;
  id: number;
  username: string;
  previousPlan: string;
  plan: string;
  sync: { ok: boolean; error?: string };
  sessionRefresh: { bounced: boolean; waitMs: number; error?: string } | null;
  error?: string;
}> {
  const plan = String(planName || '').trim();
  const user = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(userId) as any;
  if (!user) {
    return {
      ok: false,
      id: userId,
      username: '',
      previousPlan: '',
      plan,
      sync: { ok: false, error: 'not-found' },
      sessionRefresh: null,
      error: 'User not found',
    };
  }

  const previousPlan = String(user.profile || '');
  const prof = getBillingPlan(plan);
  if (!prof) {
    return {
      ok: false,
      id: userId,
      username: user.username,
      previousPlan,
      plan,
      sync: { ok: false, error: 'plan-not-found' },
      sessionRefresh: null,
      error: `Billing plan "${plan}" not found`,
    };
  }
  if (!String(prof.pppProfile || '').trim()) {
    return {
      ok: false,
      id: userId,
      username: user.username,
      previousPlan,
      plan,
      sync: { ok: false, error: 'plan-missing-profile' },
      sessionRefresh: null,
      error: `Billing plan "${plan}" has no MikroTik PPP profile linked`,
    };
  }

  const price = prof.price;
  db.prepare('UPDATE pppoe_users SET profile = ?, price = ? WHERE id = ?').run(plan, price, userId);
  const updated = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(userId) as any;

  let sync: { ok: boolean; error?: string } = { ok: false, error: 'no router' };
  let sessionRefresh: { bounced: boolean; waitMs: number; error?: string } | null = null;

  if (updated?.router_id) {
    const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(updated.router_id) as any;
    if (router?.host && router?.api_user) {
      try {
        // Use the plan's linked MikroTik profile only — never create profiles here.
        await updatePppSecret(router, updated.username, {
          password: updated.password || '',
          profile: prof.pppProfile,
          comment: commentFromUser({ ...updated, profile: plan }),
          disabled: false,
        });
        const isDisabled = String(updated.status || '').toLowerCase() === 'disabled';
        if (isDisabled) {
          await setPppSecretEnabled(router, updated.username, false);
          sync = { ok: true };
        } else {
          await setPppSecretEnabled(router, updated.username, true);
          sync = { ok: true };
          if (opts?.bounce !== false) {
            sessionRefresh = await bouncePppSessionForRefresh(router, updated.username, SESSION_REFRESH_MS);
          }
        }
      } catch (e: any) {
        sync = { ok: false, error: e?.message || String(e) };
      }
    }
  }

  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    sync.ok ? 'info' : 'warning',
    'billing',
    `Plan change for ${updated.username}: ${previousPlan || '—'} → ${plan} (MT profile ${prof.pppProfile})` +
      (sessionRefresh?.bounced ? ' (5s session bounce)' : sync.error ? ` (router: ${sync.error})` : '')
  );

  return {
    ok: true,
    id: userId,
    username: updated.username,
    previousPlan,
    plan,
    sync,
    sessionRefresh,
    error: undefined,
  };
}

export async function bulkChangePppoeUserPlans(
  ids: number[],
  planName: string
): Promise<{
  ok: boolean;
  plan: string;
  updated: number;
  bounced: number;
  failed: { id: number; username?: string; error: string }[];
  results: Awaited<ReturnType<typeof changePppoeUserPlan>>[];
}> {
  const plan = String(planName || '').trim();
  const uniqueIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];

  // Phase 1: update DB + MikroTik comment/profile (no bounce yet)
  const phase1: Awaited<ReturnType<typeof changePppoeUserPlan>>[] = [];
  for (const id of uniqueIds) {
    phase1.push(await changePppoeUserPlan(id, plan, { bounce: false }));
  }

  // Phase 2: bounce all enabled secrets in parallel (~5s total)
  const bounceJobs = phase1
    .filter((r) => r.ok && r.sync.ok)
    .map(async (r) => {
      const user = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(r.id) as any;
      if (!user?.router_id) return { ...r, sessionRefresh: null as typeof r.sessionRefresh };
      if (String(user.status || '').toLowerCase() === 'disabled') {
        return { ...r, sessionRefresh: null as typeof r.sessionRefresh };
      }
      const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(user.router_id) as any;
      if (!router?.host || !router?.api_user) return { ...r, sessionRefresh: null as typeof r.sessionRefresh };
      const sessionRefresh = await bouncePppSessionForRefresh(router, user.username, SESSION_REFRESH_MS);
      return { ...r, sessionRefresh };
    });

  const results = phase1.map((r) => ({ ...r }));
  const bouncedResults = await Promise.all(bounceJobs);
  for (const br of bouncedResults) {
    const idx = results.findIndex((r) => r.id === br.id);
    if (idx >= 0) results[idx] = br;
  }

  const failed = results
    .filter((r) => {
      if (r.error) return true;
      if (!r.sync?.ok && r.sync?.error && r.sync.error !== 'no router') return true;
      return false;
    })
    .map((r) => ({
      id: r.id,
      username: r.username,
      error: r.error || r.sync?.error || 'failed',
    }));

  return {
    ok: failed.length === 0,
    plan,
    updated: results.filter((r) => !r.error).length,
    bounced: results.filter((r) => r.sessionRefresh?.bounced).length,
    failed,
    results,
  };
}

export async function syncUserToRouter(
  user: any,
  action: 'restore' | 'expire' | 'disable' | 'enable'
): Promise<{ ok: boolean; error?: string }> {
  if (!user?.router_id) return { ok: false, error: 'no router' };
  const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(user.router_id) as any;
  if (!router?.host || !router?.api_user) return { ok: false, error: 'router-not-configured' };
  try {
    if (action === 'expire') {
      // Within grace: switch PPP profile to non-payment only.
      // Do NOT rewrite the secret comment — it keeps the original plan/due for payment restore.
      const expire =
        user.expiration_profile && user.expiration_profile !== 'default'
          ? user.expiration_profile
          : 'non-payments';
      try {
        await ensurePppProfile(router, expire);
      } catch {
        /* profile may already exist */
      }
      await updatePppSecret(router, user.username, {
        profile: expire,
        disabled: false,
      });
      await setPppSecretEnabled(router, user.username, true);
    } else if (action === 'disable') {
      // Past grace: disable only. Leave comment and profile untouched so payment
      // still reads the original plan/due from the preserved comment.
      await setPppSecretEnabled(router, user.username, false);
      try {
        await removePppActiveByName(router, user.username);
      } catch {
        /* best-effort */
      }
    } else if (action === 'enable' || action === 'restore') {
      const mtProfile = mikrotikProfileForPlan(user.profile);
      await updatePppSecret(router, user.username, {
        password: user.password || '',
        profile: mtProfile || undefined,
        comment: commentFromUser({ ...user, status: 'Active' }),
        disabled: false,
      });
      await setPppSecretEnabled(router, user.username, true);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function recordPppoePayment(
  userId: number,
  opts: {
    months?: number;
    plan?: string;
    expiration_profile?: string;
    payment_date?: string;
    discount_days?: number;
    external_ref?: string;
    source?: string;
  } = {}
) {
  const user = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(userId) as any;
  if (!user) throw new Error('User not found');

  const previousStatus = String(user.status || '');
  const refreshSession = needsSessionRefresh(previousStatus);

  const months = Math.max(1, Math.floor(Number(opts.months) || 1));
  const previousDue: string = (user.subscription_due || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const newDue = addMonthsPreserveDay(previousDue, months);
  const plan = opts.plan || user.profile;
  const prof = db.prepare('SELECT price FROM profiles WHERE name = ?').get(plan) as { price: number } | undefined;
  const unit = prof?.price ?? (Number(user.price) || 0);
  const subtotal = unit * months;
  const discountDays = Math.max(0, Math.floor(Number(opts.discount_days) || 0));
  const discount = Math.round((unit / 30) * discountDays * 100) / 100;
  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  const expirationProfile = opts.expiration_profile || user.expiration_profile || 'non-payments';
  const paymentDate = opts.payment_date
    ? new Date(`${String(opts.payment_date).slice(0, 10)}T00:00:00Z`).toISOString()
    : new Date().toISOString();

  db.prepare(
    `UPDATE pppoe_users SET subscription_due = ?, profile = ?, price = ?, expiration_profile = ?,
       status = 'Active', online = 1, nonpayment_since = NULL, reminder_sent = NULL WHERE id = ?`
  ).run(newDue, plan, unit, expirationProfile, userId);

  db.prepare(
    'INSERT INTO transactions (pppoe_user_id, customer_name, amount, type, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, user.customer_name || user.username, total, 'payment', paymentDate);

  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'info',
    'billing',
    `Payment for ${user.username}: ${plan} +${months}mo, due ${previousDue} → ${newDue}, total ${total}${opts.source ? ` (${opts.source})` : ''}${opts.external_ref ? ` ref=${opts.external_ref}` : ''}`
  );

  const updated = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(userId) as any;
  const sync = await syncUserToRouter(updated, 'restore');

  let sessionRefresh: { bounced: boolean; waitMs: number; error?: string } | null = null;
  if (refreshSession && sync.ok && updated?.router_id) {
    const router = db.prepare('SELECT * FROM routers WHERE id = ?').get(updated.router_id) as any;
    if (router?.host && router?.api_user) {
      sessionRefresh = await bouncePppSessionForRefresh(router, updated.username, SESSION_REFRESH_MS);
      db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
        sessionRefresh.bounced ? 'info' : 'warning',
        'mikrotik',
        sessionRefresh.bounced
          ? `Session refresh bounce for ${updated.username} after payment (was ${previousStatus}, ${SESSION_REFRESH_MS}ms)`
          : `Session refresh bounce failed for ${updated.username}: ${sessionRefresh.error || 'unknown'}`
      );
    }
  }

  const company = db.prepare('SELECT * FROM company WHERE id = 1').get() as any;
  return {
    ok: true,
    months,
    plan,
    previousDue,
    previousStatus,
    subscriptionDue: newDue,
    subtotal,
    discount,
    total,
    amount: total,
    sync,
    sessionRefresh,
    receipt: {
      company: company?.name || 'ISP Billing',
      account: updated.account_number,
      customer: updated.customer_name || updated.username,
      username: updated.username,
      plan,
      months,
      paymentDate: paymentDate.slice(0, 10),
      previousDue,
      newDue,
      subtotal,
      discount,
      discountDays,
      total,
    },
    user: updated,
  };
}

function randomToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

export function createPaymentLink(opts: {
  pppoeUserId: number;
  months?: number;
  amount?: number | null;
  ttlHours?: number;
  baseUrl?: string;
}) {
  const user = db.prepare('SELECT * FROM pppoe_users WHERE id = ?').get(opts.pppoeUserId) as any;
  if (!user) throw new Error('User not found');
  const months = Math.max(1, Math.floor(Number(opts.months) || 1));
  const prof = db.prepare('SELECT price FROM profiles WHERE name = ?').get(user.profile) as { price: number } | undefined;
  const amount = opts.amount != null ? Number(opts.amount) : (Number(user.price) || prof?.price || 0) * months;
  const token = randomToken();
  const ttl = Math.max(1, Math.floor(Number(opts.ttlHours) || 72));
  const expiresAt = new Date(Date.now() + ttl * 3600000).toISOString();

  const info = db.prepare(
    `INSERT INTO payment_links (pppoe_user_id, token, amount, months, status, expires_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(opts.pppoeUserId, token, amount, months, expiresAt);

  const path = `/pay/${token}`;
  const resolved = resolvePublicBaseUrl(opts.baseUrl);
  const url = resolved.baseUrl ? `${resolved.baseUrl}${path}` : path;
  return {
    id: Number(info.lastInsertRowid),
    token,
    path,
    url,
    baseUrl: resolved.baseUrl || null,
    source: resolved.source,
    warning: resolved.warning || null,
    amount,
    months,
    expiresAt,
    username: user.username,
    customer: user.customer_name,
    account: user.account_number,
  };
}

export function getPaymentLinkPublic(token: string) {
  const link = db
    .prepare(
      `SELECT pl.*, u.username, u.customer_name, u.account_number, u.profile, u.subscription_due, u.contact, u.email, u.price
       FROM payment_links pl JOIN pppoe_users u ON u.id = pl.pppoe_user_id WHERE pl.token = ?`
    )
    .get(token) as any;
  if (!link) return null;
  const company = db.prepare('SELECT name, logo, address, phone, email FROM company WHERE id = 1').get() as any;
  const expired = link.status === 'pending' && link.expires_at && Date.parse(link.expires_at) < Date.now();
  if (expired && link.status === 'pending') {
    db.prepare("UPDATE payment_links SET status = 'expired' WHERE id = ?").run(link.id);
    link.status = 'expired';
  }
  return {
    token: link.token,
    status: link.status,
    amount: link.amount,
    months: link.months,
    expiresAt: link.expires_at,
    paidAt: link.paid_at,
    externalRef: link.external_ref,
    customer: link.customer_name || link.username,
    account: link.account_number,
    username: link.username,
    plan: link.profile,
    due: link.subscription_due,
    company: {
      name: company?.name || 'ISP Billing',
      logo: company?.logo || null,
      address: company?.address || null,
      phone: company?.phone || null,
      email: company?.email || null,
    },
  };
}

export async function markPaymentLinkPaid(token: string, externalRef?: string) {
  const link = db.prepare('SELECT * FROM payment_links WHERE token = ?').get(token) as any;
  if (!link) throw new Error('Payment link not found');
  if (link.status === 'paid') {
    return { ok: true, alreadyPaid: true, link };
  }
  if (link.status === 'expired' || (link.expires_at && Date.parse(link.expires_at) < Date.now())) {
    throw new Error('Payment link expired');
  }
  const result = await recordPppoePayment(link.pppoe_user_id, {
    months: link.months || 1,
    source: 'pay-link',
    external_ref: externalRef || undefined,
  });
  db.prepare(
    `UPDATE payment_links SET status = 'paid', paid_at = datetime('now'), external_ref = ? WHERE id = ?`
  ).run(externalRef || null, link.id);
  return { ok: true, alreadyPaid: false, payment: result, link };
}

export function listPaymentLinks(limit = 100) {
  const resolved = resolvePublicBaseUrl();
  const rows = db
    .prepare(
      `SELECT pl.id, pl.token, pl.amount, pl.months, pl.status, pl.expires_at AS expiresAt, pl.paid_at AS paidAt,
              pl.created_at AS createdAt, pl.external_ref AS externalRef,
              u.username, u.customer_name AS customer, u.account_number AS account
       FROM payment_links pl
       JOIN pppoe_users u ON u.id = pl.pppoe_user_id
       ORDER BY pl.id DESC LIMIT ?`
    )
    .all(limit) as any[];
  return rows.map((r) => {
    const path = `/pay/${r.token}`;
    return {
      ...r,
      path,
      url: resolved.baseUrl ? `${resolved.baseUrl}${path}` : path,
      baseUrl: resolved.baseUrl || null,
    };
  });
}

/** Ensure a fresh pending pay link exists for reminder messages. */
export function ensureFreshPayLink(userId: number, baseUrl?: string) {
  const existing = db
    .prepare(
      `SELECT * FROM payment_links WHERE pppoe_user_id = ? AND status = 'pending' AND datetime(expires_at) > datetime('now')
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId) as any;
  if (existing) {
    const path = `/pay/${existing.token}`;
    const resolved = resolvePublicBaseUrl(baseUrl);
    return {
      token: existing.token,
      path,
      url: resolved.baseUrl ? `${resolved.baseUrl}${path}` : path,
      baseUrl: resolved.baseUrl || null,
      source: resolved.source,
      warning: resolved.warning || null,
      amount: existing.amount,
      months: existing.months,
    };
  }
  return createPaymentLink({ pppoeUserId: userId, months: 1, baseUrl });
}

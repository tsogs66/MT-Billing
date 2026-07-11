import { db } from './db.js';
import { setPppSecretEnabled, setPppSecretProfile } from './ppp-secret.js';
import type { RouterConn } from './mikrotik.js';

export interface NotifySettings {
  reminder_enabled: number;
  days_before: number;
  email_enabled: number;
  sms_enabled: number;
  autodisable_enabled: number;
  autodisable_hours: number;
  email_from: string;
  sms_sender: string;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_secure?: number | null;
  smtp_user?: string | null;
  smtp_pass?: string | null;
  smtp_from?: string | null;
  sms_api_url?: string | null;
  sms_api_user?: string | null;
  sms_api_pass?: string | null;
  sms_type?: number | null;
}

export function getSettings(): NotifySettings {
  return db.prepare('SELECT * FROM notify_settings WHERE id = 1').get() as NotifySettings;
}

// Never leak stored secrets to the client; report only whether they are set.
export function getPublicSettings() {
  const s = getSettings();
  return {
    ...s,
    smtp_pass: undefined,
    sms_api_pass: undefined,
    smtp_pass_set: !!s.smtp_pass,
    sms_api_pass_set: !!s.sms_api_pass,
  };
}

const COLS = [
  'reminder_enabled', 'days_before', 'email_enabled', 'sms_enabled', 'autodisable_enabled',
  'autodisable_hours', 'email_from', 'sms_sender', 'smtp_host', 'smtp_port', 'smtp_secure',
  'smtp_user', 'smtp_pass', 'smtp_from', 'sms_api_url', 'sms_api_user', 'sms_api_pass', 'sms_type',
];
const BOOL_COLS = new Set(['reminder_enabled', 'email_enabled', 'sms_enabled', 'autodisable_enabled', 'smtp_secure']);

export function updateSettings(patch: Record<string, any>) {
  const cur = getSettings() as Record<string, any>;
  for (const col of COLS) {
    if (!(col in patch)) continue;
    // Ignore blank password fields so a save doesn't wipe stored secrets.
    if ((col === 'smtp_pass' || col === 'sms_api_pass') && (patch[col] == null || patch[col] === '')) continue;
    let val = patch[col];
    if (BOOL_COLS.has(col)) val = val ? 1 : 0;
    cur[col] = val;
  }
  db.prepare(
    `UPDATE notify_settings SET
       reminder_enabled=@reminder_enabled, days_before=@days_before, email_enabled=@email_enabled,
       sms_enabled=@sms_enabled, autodisable_enabled=@autodisable_enabled, autodisable_hours=@autodisable_hours,
       email_from=@email_from, sms_sender=@sms_sender, smtp_host=@smtp_host, smtp_port=@smtp_port,
       smtp_secure=@smtp_secure, smtp_user=@smtp_user, smtp_pass=@smtp_pass, smtp_from=@smtp_from,
       sms_api_url=@sms_api_url, sms_api_user=@sms_api_user, sms_api_pass=@sms_api_pass, sms_type=@sms_type
     WHERE id=1`
  ).run({
    reminder_enabled: cur.reminder_enabled ? 1 : 0,
    days_before: Number(cur.days_before) || 3,
    email_enabled: cur.email_enabled ? 1 : 0,
    sms_enabled: cur.sms_enabled ? 1 : 0,
    autodisable_enabled: cur.autodisable_enabled ? 1 : 0,
    autodisable_hours: Number(cur.autodisable_hours) || 24,
    email_from: cur.email_from || 'billing@pa-north.net',
    sms_sender: cur.sms_sender || 'PA-NORTH',
    smtp_host: cur.smtp_host || null,
    smtp_port: Number(cur.smtp_port) || 587,
    smtp_secure: cur.smtp_secure ? 1 : 0,
    smtp_user: cur.smtp_user || null,
    smtp_pass: cur.smtp_pass || null,
    smtp_from: cur.smtp_from || null,
    sms_api_url: cur.sms_api_url || null,
    sms_api_user: cur.sms_api_user || null,
    sms_api_pass: cur.sms_api_pass || null,
    sms_type: Number(cur.sms_type) || 1,
  });
  return getPublicSettings();
}

async function getMailer(): Promise<any> {
  try {
    const spec = 'nodemailer';
    const m: any = await import(spec);
    return m.default || m;
  } catch {
    return null;
  }
}

// Normalize a PH mobile number to international format for the SMS gateway.
function normalizePhone(n: string): string {
  const digits = (n || '').replace(/[^0-9]/g, '');
  if (digits.startsWith('63')) return digits;
  if (digits.startsWith('0')) return `63${digits.slice(1)}`;
  if (digits.startsWith('9') && digits.length === 10) return `63${digits}`;
  return digits;
}

async function sendEmailSmtp(s: NotifySettings, to: string, subject: string, message: string) {
  const mailer = await getMailer();
  if (!mailer) return { status: 'failed', detail: 'SMTP configured but nodemailer not installed' };
  try {
    const transport = mailer.createTransport({
      host: s.smtp_host,
      port: Number(s.smtp_port) || 587,
      secure: !!s.smtp_secure,
      auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass || '' } : undefined,
    });
    await transport.sendMail({ from: s.smtp_from || s.email_from, to, subject, text: message });
    return { status: 'sent', detail: `sent via SMTP ${s.smtp_host}` };
  } catch (e: any) {
    return { status: 'failed', detail: `SMTP error: ${e?.message || 'send failed'}` };
  }
}

async function sendSmsBulk(s: NotifySettings, to: string, message: string) {
  try {
    const url = new URL(s.sms_api_url as string);
    url.searchParams.set('un', s.sms_api_user || '');
    url.searchParams.set('pwd', s.sms_api_pass || '');
    url.searchParams.set('dstno', normalizePhone(to));
    url.searchParams.set('msg', message);
    url.searchParams.set('type', String(Number(s.sms_type) || 1));
    url.searchParams.set('agreedterm', 'YES');
    if (s.sms_sender) url.searchParams.set('sendid', s.sms_sender);
    const r = await fetch(url.toString(), { method: 'GET' });
    const body = (await r.text()).trim();
    // iSMS returns a numeric status code (e.g. 2000 = success) in the body.
    const ok = r.ok && /2000|success|ok/i.test(body);
    return ok ? { status: 'sent', detail: `iSMS: ${body || 'ok'}` } : { status: 'failed', detail: `iSMS: ${body || `HTTP ${r.status}`}` };
  } catch (e: any) {
    return { status: 'failed', detail: `SMS gateway error: ${e?.message || 'unreachable'}` };
  }
}

function daysUntil(due?: string | null): number | null {
  if (!due) return null;
  const dueMs = new Date(`${due.slice(0, 10)}T00:00:00Z`).getTime();
  const todayMs = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((dueMs - todayMs) / 86400000);
}

/**
 * Deliver a single notification. Real delivery happens when a gateway webhook
 * is configured (NOTIFY_EMAIL_WEBHOOK / NOTIFY_SMS_WEBHOOK); otherwise the
 * message is recorded as simulated so the workflow is fully demonstrable
 * without external credentials.
 */
async function deliver(channel: 'email' | 'sms', recipient: string | null, subject: string, message: string) {
  if (!recipient) return { status: 'failed', detail: `no ${channel} address on file` };
  const s = getSettings();

  if (channel === 'email' && s.smtp_host) return sendEmailSmtp(s, recipient, subject, message);
  if (channel === 'sms' && s.sms_api_url && s.sms_api_user && s.sms_api_pass) return sendSmsBulk(s, recipient, message);

  const webhook = channel === 'email' ? process.env.NOTIFY_EMAIL_WEBHOOK : process.env.NOTIFY_SMS_WEBHOOK;
  if (webhook) {
    try {
      const r = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, to: recipient, subject, message }),
      });
      return r.ok ? { status: 'sent', detail: 'delivered via gateway' } : { status: 'failed', detail: `gateway HTTP ${r.status}` };
    } catch {
      return { status: 'failed', detail: 'gateway unreachable' };
    }
  }
  return { status: 'sent', detail: `simulated (no ${channel} gateway configured)` };
}

function record(n: {
  channel: string;
  recipient: string | null;
  client_id?: number | null;
  customer_name?: string | null;
  subject?: string;
  message: string;
  type: string;
  status: string;
  detail: string;
}) {
  db.prepare(
    `INSERT INTO notifications (channel, recipient, client_id, customer_name, subject, message, type, status, detail)
     VALUES (@channel, @recipient, @client_id, @customer_name, @subject, @message, @type, @status, @detail)`
  ).run({
    channel: n.channel,
    recipient: n.recipient,
    client_id: n.client_id ?? null,
    customer_name: n.customer_name ?? null,
    subject: n.subject ?? null,
    message: n.message,
    type: n.type,
    status: n.status,
    detail: n.detail,
  });
}

interface Client {
  id: number;
  username: string;
  customer_name: string;
  email: string | null;
  contact: string | null;
  subscription_due: string | null;
  account_number?: string | null;
  profile?: string | null;
  price?: number | null;
}

/** Personalize template tokens with the recipient's own details (per-user on send). */
export function fillTemplate(text: string, client: Client, extras?: Record<string, string>): string {
  if (!text) return text;
  const amount =
    client.price != null
      ? `\u20b1${Number(client.price).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '';
  const map: Record<string, string> = {
    name: client.customer_name || client.username || '',
    account: client.account_number || '',
    plan: client.profile || '',
    amount,
    due: (client.subscription_due || '').slice(0, 10),
    username: client.username || '',
    ...(extras || {}),
  };
  return text.replace(/\{(name|account|plan|amount|due|username|company)\}/gi, (_m, k) => map[String(k).toLowerCase()] ?? '');
}

export function companyName(): string {
  const company = db.prepare('SELECT name FROM company WHERE id = 1').get() as { name?: string } | undefined;
  return company?.name || 'Pa-North';
}

/** Fill subject + message for one client (used by Send preview + notifyClient). */
export function previewForClient(
  client: Client,
  subject: string,
  message: string
): { subject: string; message: string; client: Record<string, string | number> } {
  const extras = { company: companyName() };
  const subjectF = fillTemplate(subject, client, extras);
  const messageF = fillTemplate(message, client, extras);
  const amount =
    client.price != null
      ? `\u20b1${Number(client.price).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '';
  return {
    subject: subjectF,
    message: messageF,
    client: {
      id: client.id,
      name: client.customer_name || client.username || '',
      username: client.username || '',
      account: client.account_number || '',
      plan: client.profile || '',
      due: (client.subscription_due || '').slice(0, 10),
      amount,
    },
  };
}

async function notifyClient(client: Client, channels: ('email' | 'sms')[], subject: string, message: string, type: string) {
  const extras = { company: companyName() };
  const subjectF = fillTemplate(subject, client, extras);
  const messageF = fillTemplate(message, client, extras);
  const results: string[] = [];
  for (const ch of channels) {
    const recipient = ch === 'email' ? client.email : client.contact;
    const r = await deliver(ch, recipient || null, subjectF, messageF);
    record({
      channel: ch,
      recipient: recipient || null,
      client_id: client.id,
      customer_name: client.customer_name,
      subject: subjectF,
      message: messageF,
      type,
      status: r.status,
      detail: r.detail,
    });
    results.push(`${ch}:${r.status}`);
  }
  return results;
}

/** Manual broadcast/one-off send initiated from the Notifications page. */
export async function sendManual(opts: {
  channel: 'email' | 'sms' | 'both';
  target: 'all' | 'client' | 'selected';
  clientId?: number;
  clientIds?: number[];
  service?: string;
  subject?: string;
  message: string;
}) {
  const channels: ('email' | 'sms')[] = opts.channel === 'both' ? ['email', 'sms'] : [opts.channel];
  const base = 'SELECT id, username, customer_name, email, contact, subscription_due, account_number, profile, price FROM pppoe_users';
  let clients: Client[];
  if (opts.target === 'client' && opts.clientId) {
    clients = db.prepare(`${base} WHERE id = ?`).all(opts.clientId) as Client[];
  } else if (opts.target === 'selected' && opts.clientIds?.length) {
    const ph = opts.clientIds.map(() => '?').join(',');
    clients = db.prepare(`${base} WHERE id IN (${ph})`).all(...opts.clientIds) as Client[];
  } else {
    clients = db.prepare(base).all() as Client[];
  }
  let sent = 0;
  let skipped = 0;
  for (const c of clients) {
    const hasTarget = channels.some((ch) => (ch === 'email' ? c.email : c.contact));
    if (!hasTarget) {
      skipped++;
      continue;
    }
    await notifyClient(c, channels, opts.subject || 'Notice from Pa-North', opts.message, 'manual');
    sent++;
  }
  return { recipients: clients.length, sent, skipped };
}

/** Reminder (N days before expiry) + apply expire profile + auto-disable after grace period. */
export async function runAutomations() {
  const s = getSettings();
  const now = Date.now();
  const summary = { remindersSent: 0, marked: 0, disabled: 0, expireProfilesApplied: 0 };

  const all = db
    .prepare(
      `SELECT id, username, customer_name, profile, status, email, contact, subscription_due, nonpayment_since,
              reminder_sent, router_id, price, account_number, expiration_profile, expire_applied,
              address, plc_port, lat, lng, service, password
       FROM pppoe_users`
    )
    .all() as (Client & {
      status: string;
      profile: string;
      nonpayment_since: string | null;
      reminder_sent: string | null;
      router_id?: number;
      price?: number;
      account_number?: string;
      expiration_profile?: string | null;
      expire_applied?: string | null;
      address?: string | null;
      plc_port?: string | null;
      lat?: number | null;
      lng?: number | null;
      service?: string | null;
      password?: string | null;
    })[];

  const company = db.prepare('SELECT name FROM company WHERE id = 1').get() as { name?: string } | undefined;
  const companyName = company?.name || 'Pa-North';

  for (const u of all) {
    const d = daysUntil(u.subscription_due);
    if (d == null) continue;
    const due = String(u.subscription_due).slice(0, 10);
    const expireProfile = String(u.expiration_profile || 'default').trim();
    const hasExpireProfile = expireProfile && expireProfile !== 'default' && expireProfile !== u.profile;

    // Within notification "days before" window (or already past due): apply Profile on Expiry on MikroTik.
    // Billing plan in DB stays unchanged; only the live PPP secret profile switches.
    if (
      hasExpireProfile &&
      u.status !== 'disabled' &&
      d <= s.days_before &&
      u.expire_applied !== due
    ) {
      if (u.router_id) {
        const router = db.prepare('SELECT host, port, api_user, api_pass FROM routers WHERE id = ?').get(u.router_id) as RouterConn | undefined;
        if (router?.host && router?.api_user) {
          try {
            await setPppSecretProfile(
              router,
              {
                username: u.username,
                profile: u.profile,
                subscription_due: due,
                account_number: u.account_number,
                expiration_profile: expireProfile,
                customer_name: u.customer_name,
                address: u.address,
                contact: u.contact,
                email: u.email,
                lat: u.lat,
                lng: u.lng,
                plc_port: u.plc_port,
                status: d < 0 ? 'expired' : u.status,
                service: u.service,
              },
              expireProfile
            );
            db.prepare(
              `UPDATE pppoe_users SET expire_applied = ?, status = CASE
                 WHEN ? < 0 AND status IN ('Active','expired') THEN 'expired'
                 ELSE status END WHERE id = ?`
            ).run(due, d, u.id);
            db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
              'info',
              'mikrotik',
              `Applied expire profile "${expireProfile}" for ${u.username} (${d < 0 ? 'past due' : `${d}d before due`})`
            );
            summary.expireProfilesApplied++;
          } catch (e: any) {
            db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
              'warning',
              'mikrotik',
              `Expire profile apply failed for ${u.username}: ${e?.message || 'error'}`
            );
          }
        }
      } else {
        db.prepare('UPDATE pppoe_users SET expire_applied = ? WHERE id = ?').run(due, u.id);
      }
    }

    // Expiry / payment reminder (N days before due date)
    if (s.reminder_enabled && (u.status === 'Active' || u.status === 'expired') && d >= 0 && d <= s.days_before && u.reminder_sent !== due) {
      const channels: ('email' | 'sms')[] = [];
      if (s.email_enabled) channels.push('email');
      if (s.sms_enabled) channels.push('sms');
      if (channels.length) {
        const amount = Number(u.price) || 0;
        const subject = `${companyName} — Payment reminder`;
        const msg = `Hi ${u.customer_name || u.username}, this is a friendly reminder that your ${u.profile} plan (Account #${u.account_number || u.username}) is due on ${due} (in ${d} day${d === 1 ? '' : 's'}). Amount due: PHP ${amount.toFixed(2)}. Please settle on or before the due date to avoid interruption of service. Thank you! — ${companyName}`;
        await notifyClient(u, channels, subject, msg, 'expiry_reminder');
        db.prepare('UPDATE pppoe_users SET reminder_sent = ? WHERE id = ?').run(due, u.id);
        summary.remindersSent++;
      }
    }

    // Non-payment tracking + auto-disable on MikroTik after configured hours
    if (d < 0 && u.status !== 'disabled') {
      if (!u.nonpayment_since) {
        db.prepare("UPDATE pppoe_users SET nonpayment_since = ?, status = 'non-payment' WHERE id = ?").run(new Date(now).toISOString(), u.id);
        summary.marked++;
      } else if (s.autodisable_enabled) {
        const hours = (now - Date.parse(u.nonpayment_since)) / 3600000;
        if (hours >= s.autodisable_hours) {
          db.prepare("UPDATE pppoe_users SET status = 'disabled', online = 0 WHERE id = ?").run(u.id);
          if (u.router_id) {
            const router = db.prepare('SELECT host, port, api_user, api_pass FROM routers WHERE id = ?').get(u.router_id) as RouterConn | undefined;
            if (router?.host && router?.api_user) {
              try {
                await setPppSecretEnabled(router, u.username, false);
              } catch (e: any) {
                db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
                  'warning',
                  'mikrotik',
                  `Auto-disable PPP secret failed for ${u.username}: ${e?.message || 'error'}`
                );
              }
            }
          }
          const channels: ('email' | 'sms')[] = [];
          if (s.email_enabled) channels.push('email');
          if (s.sms_enabled) channels.push('sms');
          const waitLabel =
            s.autodisable_hours >= 24 && s.autodisable_hours % 24 === 0
              ? `${s.autodisable_hours / 24} day(s)`
              : `${s.autodisable_hours} hour(s)`;
          const msg = `Hi ${u.customer_name || u.username}, your service has been temporarily disabled on the network due to non-payment for more than ${waitLabel}. Please settle your balance to restore your connection. — ${companyName}`;
          if (channels.length) await notifyClient(u, channels, 'Service disabled — payment overdue', msg, 'auto_disable');
          db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
            'warning',
            'billing',
            `Auto-disabled ${u.username} on MikroTik after ${Math.round(hours)}h non-payment`
          );
          summary.disabled++;
        }
      }
    }
  }
  return summary;
}

let started = false;
export function startNotifyScheduler(intervalMs = 5 * 60 * 1000) {
  if (started) return;
  started = true;
  runAutomations().catch(() => undefined);
  setInterval(() => runAutomations().catch(() => undefined), intervalMs);
}

export function listNotifications(limit = 200) {
  return db
    .prepare('SELECT id, channel, recipient, customer_name AS customer, subject, message, type, status, detail, created_at AS date FROM notifications ORDER BY id DESC LIMIT ?')
    .all(limit);
}

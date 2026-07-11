import { useEffect, useState } from 'react';
import { Mail, MessageSquare, Send, PlayCircle, Bell, Clock } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge, Toggle, TabBar, Flash, DataTable, FormField } from '../components/ui';
import { api } from '../api';

const TYPE_LABEL: Record<string, string> = {
  manual: 'Manual',
  expiry_reminder: 'Expiry reminder',
  auto_disable: 'Auto-disable',
};

const TEMPLATES = [
  {
    key: 'maintenance',
    label: 'Scheduled Maintenance',
    subject: 'Scheduled Network Maintenance',
    message:
      'Dear valued subscriber, we will be performing scheduled network maintenance in your area. A brief service interruption may occur during this window. We apologize for any inconvenience and thank you for your patience.',
  },
  {
    key: 'repair',
    label: 'Repair in Progress',
    subject: 'Network Repair in Progress',
    message:
      'Dear subscriber, our technical team is currently repairing a network issue affecting your area. We are working to restore normal service as quickly as possible and will keep you updated. Thank you for your understanding.',
  },
  {
    key: 'commissioning',
    label: 'Commissioning / Activation',
    subject: 'Service Commissioning',
    message:
      'Hello! Your connection is scheduled for commissioning and activation. Kindly ensure your equipment is powered on and accessible. Please contact our support team if you need any assistance.',
  },
  {
    key: 'outage',
    label: 'Internet Outage',
    subject: 'Internet Outage Notice',
    message:
      'Dear subscriber, we are aware of an internet outage affecting your area and are coordinating with our upstream provider to restore service at the earliest time. We appreciate your patience and apologize for the inconvenience.',
  },
  {
    key: 'payment_reminder',
    label: 'Payment Reminder',
    subject: 'Payment Reminder',
    message:
      'Hi {name}, this is a friendly reminder that your {plan} plan (Account #{account}) is due on {due}. Amount due: {amount}. Please settle on or before the due date to avoid interruption of service. Thank you!',
  },
  {
    key: 'payment_confirmation',
    label: 'Payment Confirmation',
    subject: 'Payment Confirmation',
    message:
      'Hi {name}, we have received your payment of {amount} for your {plan} plan (Account #{account}). Your service is active until {due}. Thank you for your payment!',
  },
];

const TABS = [
  { key: 'send', label: 'Send' },
  { key: 'automation', label: 'Reminders' },
  { key: 'smtp', label: 'Email (SMTP)' },
  { key: 'sms', label: 'Bulk SMS' },
  { key: 'log', label: 'Log' },
];

type PreviewClient = {
  id: number;
  name: string;
  username: string;
  account: string;
  plan: string;
  due: string;
  amount: string;
};

/** Live filled preview — same token fill used per recipient on send. */
function MessagePreview({
  clients,
  selectedIds,
  target,
  subject,
  message,
  showSubject,
}: {
  clients: any[];
  selectedIds: number[];
  target: 'all' | 'selected';
  subject: string;
  message: string;
  showSubject: boolean;
}) {
  const previewId =
    target === 'selected' && selectedIds.length
      ? selectedIds[0]
      : clients[0]?.id ?? null;

  const [preview, setPreview] = useState<{
    subject: string;
    message: string;
    client: PreviewClient;
  } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!message.trim() && !subject.trim()) {
      setPreview(null);
      setErr('');
      return;
    }
    if (!previewId && !clients.length) {
      setPreview(null);
      setErr('Add a client to preview personalization.');
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      api
        .post('/notifications/preview', {
          clientId: previewId || undefined,
          subject,
          message,
        })
        .then((r) => {
          if (!cancelled) {
            setPreview(r.data);
            setErr('');
          }
        })
        .catch((e: any) => {
          if (!cancelled) {
            setPreview(null);
            setErr(e?.response?.data?.error || e?.message || 'Preview failed');
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [subject, message, previewId, clients.length]);

  const label =
    preview?.client?.name ||
    clients.find((c) => c.id === previewId)?.customer ||
    clients.find((c) => c.id === previewId)?.username ||
    '—';

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-emerald-900">
          Preview — filled with this subscriber&apos;s details
        </p>
        <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">
          {label}
          {target === 'all' || selectedIds.length > 1
            ? ' · each recipient gets their own values on send'
            : ''}
        </span>
      </div>
      {err ? (
        <p className="text-xs text-rose-600">{err}</p>
      ) : preview ? (
        <div className="space-y-2 text-sm">
          {showSubject && preview.subject ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/70">Subject</p>
              <p className="font-medium text-slate-800">{preview.subject}</p>
            </div>
          ) : null}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700/70">Message</p>
            <pre className="whitespace-pre-wrap font-sans text-slate-700">{preview.message || '(empty)'}</pre>
          </div>
          <p className="text-[10px] text-emerald-800/80">
            {[preview.client.account && `#${preview.client.account}`, preview.client.plan, preview.client.amount, preview.client.due && `due ${preview.client.due}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Type a message with tokens (e.g. {'{name}'}, {'{due}'}) to see the filled result…</p>
      )}
    </div>
  );
}

export default function Notifications() {
  const [settings, setSettings] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [channel, setChannel] = useState<'email' | 'sms' | 'both'>('email');
  const [target, setTarget] = useState<'all' | 'selected'>('all');
  const [selected, setSelected] = useState<number[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [subject, setSubject] = useState('Notice from Pa-North');
  const [message, setMessage] = useState('');
  const [banner, setBanner] = useState('');
  const [bannerType, setBannerType] = useState<'success' | 'error' | 'info'>('success');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('send');
  const [smtpPass, setSmtpPass] = useState('');
  const [smsPass, setSmsPass] = useState('');
  const [disableUnit, setDisableUnit] = useState<'hours' | 'days'>(() => {
    try {
      return (localStorage.getItem('mt_autodisable_unit') as 'hours' | 'days') || 'hours';
    } catch {
      return 'hours';
    }
  });

  const loadLogs = () => api.get('/notifications').then((r) => setLogs(r.data));

  useEffect(() => {
    api.get('/notifications/settings').then((r) => setSettings(r.data));
    api.get('/clients').then((r) => setClients(r.data));
    loadLogs();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('mt_autodisable_unit', disableUnit);
    } catch {
      /* ignore */
    }
  }, [disableUnit]);

  const applyTemplate = (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    setSubject(t.subject);
    setMessage(t.message);
  };

  const toggleClient = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const filteredClients = clients.filter(
    (c) =>
      !clientSearch ||
      (c.customer || '').toLowerCase().includes(clientSearch.toLowerCase()) ||
      (c.username || '').toLowerCase().includes(clientSearch.toLowerCase())
  );

  const saveSettings = async (patch: any) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    const r = await api.put('/notifications/settings', next);
    setSettings(r.data);
  };

  const flash = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setBanner(msg);
    setBannerType(type);
    setTimeout(() => setBanner(''), 5000);
  };

  const send = async () => {
    if (!message.trim()) {
      flash('Please enter a message.', 'error');
      return;
    }
    if (target === 'selected' && selected.length === 0) {
      flash('Please select at least one client.', 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post('/notifications/send', {
        channel,
        target,
        clientIds: target === 'selected' ? selected : undefined,
        subject,
        message,
      });
      flash(`Sent to ${r.data.sent} client(s) via ${channel.toUpperCase()} (${r.data.skipped} skipped — no address on file).`);
      loadLogs();
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    try {
      const r = await api.post('/notifications/run');
      flash(`Automations run: ${r.data.remindersSent} reminder(s), ${r.data.expireProfilesApplied || 0} expire profile(s) applied, ${r.data.marked} marked non-payment, ${r.data.disabled} auto-disabled.`);
      loadLogs();
    } finally {
      setBusy(false);
    }
  };

  const setS = (patch: any) => setSettings((s: any) => ({ ...s, ...patch }));
  const saveGateway = async () => {
    setBusy(true);
    try {
      const payload: any = { ...settings };
      if (smtpPass) payload.smtp_pass = smtpPass;
      if (smsPass) payload.sms_api_pass = smsPass;
      const r = await api.put('/notifications/settings', payload);
      setSettings(r.data);
      setSmtpPass('');
      setSmsPass('');
      flash('Gateway settings saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <Layout title="Notifications"><div className="text-slate-400">Loading…</div></Layout>;

  return (
    <Layout title="Notifications">
      <Flash message={banner} type={bannerType} onDismiss={() => setBanner('')} />

      <TabBar tabs={TABS} active={tab} onChange={setTab} className="mb-5" />

      {tab === 'send' && (
        <Card title="Send Notification">
          <div className="space-y-3">
            <FormField label="Channel" hint="Uses each client's saved email and/or SMS contact number.">
              <div className="flex gap-2">
                {([['email', 'Email', Mail], ['sms', 'SMS', MessageSquare], ['both', 'Both', Send]] as const).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setChannel(key)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border ${channel === key ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>
            </FormField>

            <FormField label="Recipients">
              <div className="flex gap-2 mb-2">
                {(['all', 'selected'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTarget(t)}
                    className={`px-3 py-1.5 rounded-lg text-sm border ${target === t ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {t === 'all' ? 'All clients' : `Selected (${selected.length})`}
                  </button>
                ))}
              </div>
              {target === 'selected' && (
                <div className="border border-slate-200 rounded-lg">
                  <input
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Search clients..."
                    className="w-full text-sm px-3 py-2 border-b border-slate-100 focus:outline-none"
                  />
                  <div className="max-h-40 overflow-y-auto">
                    {filteredClients.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleClient(c.id)} />
                        <span className="text-slate-700">{c.customer || c.username}</span>
                        <span className="text-slate-400 text-xs ml-auto">{c.email || c.contact || 'no contact'}</span>
                      </label>
                    ))}
                    {filteredClients.length === 0 && <div className="px-3 py-3 text-sm text-slate-400">No clients found.</div>}
                  </div>
                </div>
              )}
            </FormField>

            <FormField label="Message template">
              <select className="input" defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">— Choose a preformatted template —</option>
                {TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                Each recipient gets their own values. Tokens:{' '}
                <code>{'{name}'}</code>, <code>{'{username}'}</code>, <code>{'{account}'}</code>,{' '}
                <code>{'{plan}'}</code>, <code>{'{amount}'}</code>, <code>{'{due}'}</code>, <code>{'{company}'}</code>.
              </p>
            </FormField>

            {channel !== 'sms' && (
              <FormField label="Subject (email)">
                <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </FormField>
            )}
            <FormField label="Message">
              <textarea className="input min-h-[110px]" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hi {name}, your {plan} plan (Account #{account}) is due on {due}…" />
            </FormField>

            <MessagePreview
              clients={clients}
              selectedIds={selected}
              target={target}
              subject={subject}
              message={message}
              showSubject={channel !== 'sms'}
            />

            <button type="button" className="btn-primary" onClick={send} disabled={busy}>
              <Send size={16} /> {busy ? 'Sending…' : target === 'all' ? 'Send to all clients' : `Send to ${selected.length} selected`}
            </button>
          </div>
        </Card>
      )}

      {tab === 'automation' && (
        <Card title="Reminders & Grace Period">
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-600">
              After SMTP/SMS is configured, the panel automatically:
              <ul className="list-disc ml-5 mt-1.5 space-y-0.5 text-slate-500">
                <li>Sends payment reminders based on each user&apos;s expiration date</li>
                <li>
                  Applies each user&apos;s <b>Profile on Expiry</b> on MikroTik starting
                  {' '}<b>days before</b> due
                </li>
                <li>
                  After expiration, waits the <b>grace period</b> below, then disables the MikroTik PPP secret
                </li>
              </ul>
            </div>

            <Row icon={<Bell size={16} className="text-brand-500" />} label="Payment reminders" desc="Notify clients before their plan expires">
              <Toggle label="Expiry reminders" on={!!settings.reminder_enabled} onChange={() => saveSettings({ reminder_enabled: settings.reminder_enabled ? 0 : 1 })} />
            </Row>

            <div className="pl-7 space-y-3">
              <div className="flex items-center justify-between text-sm gap-3 flex-wrap">
                <div>
                  <div className="font-medium text-slate-700">Days before expiration</div>
                  <div className="text-xs text-slate-400">When to send reminders and apply Profile on Expiry</div>
                </div>
                <input
                  type="number"
                  min={1}
                  className="input w-24 text-center"
                  value={settings.days_before}
                  onChange={(e) => saveSettings({ days_before: Math.max(1, Number(e.target.value) || 1) })}
                />
              </div>

              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-2"><Toggle label="Email reminders" on={!!settings.email_enabled} onChange={() => saveSettings({ email_enabled: settings.email_enabled ? 0 : 1 })} /> Email</label>
                <label className="flex items-center gap-2"><Toggle label="SMS reminders" on={!!settings.sms_enabled} onChange={() => saveSettings({ sms_enabled: settings.sms_enabled ? 0 : 1 })} /> SMS</label>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3" />

            <Row
              icon={<Clock size={16} className="text-amber-500" />}
              label="Grace period"
              desc="Wait after expiration before disabling the user on MikroTik"
            >
              <Toggle
                label="Auto-disable after grace period"
                on={!!settings.autodisable_enabled}
                onChange={() => saveSettings({ autodisable_enabled: settings.autodisable_enabled ? 0 : 1 })}
              />
            </Row>

            <div className="pl-7 space-y-2">
              <div className="flex items-center justify-between text-sm gap-3 flex-wrap">
                <div>
                  <div className="font-medium text-slate-700">Grace period length</div>
                  <div className="text-xs text-slate-400">
                    Time after due date before the PPP secret is disabled on the router
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    className="input w-24 text-center"
                    disabled={!settings.autodisable_enabled}
                    value={
                      disableUnit === 'days'
                        ? Math.max(1, Math.round((settings.autodisable_hours || 24) / 24))
                        : settings.autodisable_hours || 24
                    }
                    onChange={(e) => {
                      const n = Math.max(1, Number(e.target.value) || 1);
                      saveSettings({
                        autodisable_hours: disableUnit === 'days' ? n * 24 : n,
                      });
                    }}
                  />
                  <select
                    className="input w-28"
                    disabled={!settings.autodisable_enabled}
                    value={disableUnit}
                    onChange={(e) => {
                      const unit = e.target.value as 'hours' | 'days';
                      const currentHours = Number(settings.autodisable_hours) || 24;
                      const display = unit === 'days' ? Math.max(1, Math.round(currentHours / 24)) : currentHours;
                      setDisableUnit(unit);
                      saveSettings({
                        autodisable_hours: unit === 'days' ? display * 24 : display,
                      });
                    }}
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Example: grace period <b>24 hours</b> → user expires today → MikroTik disable tomorrow.
                Currently stored as <b>{settings.autodisable_hours || 24} hour(s)</b>.
              </p>
            </div>

            <div className="border-t border-slate-100 pt-3 flex items-center justify-between flex-wrap gap-2">
              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                <Clock size={14} /> Checks run every 5 minutes. Profile on Expiry is set per user in Add/Edit User.
              </div>
              <button type="button" className="inline-flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 text-slate-600" onClick={runNow} disabled={busy}>
                <PlayCircle size={15} /> Run checks now
              </button>
            </div>
          </div>
        </Card>
      )}

      {tab === 'smtp' && (
        <Card title="Email (SMTP) Setup">
          <div className="max-w-xl space-y-3">
            <p className="text-sm text-slate-500">Configure an SMTP server to actually deliver email notifications and receipts. Leave empty to keep messages in simulated mode.</p>
            <label className="flex items-center gap-2 text-sm">
              <Toggle label="Email notifications enabled" on={!!settings.email_enabled} onChange={() => saveSettings({ email_enabled: settings.email_enabled ? 0 : 1 })} /> Email notifications enabled
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="SMTP Host">
                <input className="input" placeholder="smtp.gmail.com" value={settings.smtp_host || ''} onChange={(e) => setS({ smtp_host: e.target.value })} />
              </FormField>
              <FormField label="Port">
                <input className="input" type="number" value={settings.smtp_port || 587} onChange={(e) => setS({ smtp_port: Number(e.target.value) })} />
              </FormField>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Toggle label="Use SSL/TLS" on={!!settings.smtp_secure} onChange={() => setS({ smtp_secure: settings.smtp_secure ? 0 : 1 })} /> Use SSL/TLS (port 465)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="SMTP Username">
                <input className="input" value={settings.smtp_user || ''} onChange={(e) => setS({ smtp_user: e.target.value })} />
              </FormField>
              <FormField label={settings.smtp_pass_set ? 'SMTP Password (saved)' : 'SMTP Password'}>
                <input className="input" type="password" placeholder={settings.smtp_pass_set ? '••••••• (leave blank to keep)' : ''} value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} />
              </FormField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="From Address">
                <input className="input" placeholder="billing@pa-north.net" value={settings.smtp_from || ''} onChange={(e) => setS({ smtp_from: e.target.value })} />
              </FormField>
              <FormField label="Default From (fallback)">
                <input className="input" value={settings.email_from || ''} onChange={(e) => setS({ email_from: e.target.value })} />
              </FormField>
            </div>
            <button type="button" className="btn-primary" onClick={saveGateway} disabled={busy}>{busy ? 'Saving…' : 'Save SMTP Settings'}</button>
          </div>
        </Card>
      )}

      {tab === 'sms' && (
        <Card title="Bulk SMS Setup (bulksms.com.ph / iSMS)">
          <div className="max-w-xl space-y-3">
            <p className="text-sm text-slate-500">
              Connect your <a className="text-brand-600 underline" href="https://www.bulksms.com.ph/sms_api.php" target="_blank" rel="noreferrer">bulksms.com.ph</a> (iSMS) account to send real SMS. Requests use the <code>un</code>, <code>pwd</code>, <code>dstno</code>, <code>msg</code>, <code>type</code>, <code>agreedterm</code> and <code>sendid</code> parameters.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Toggle label="SMS notifications enabled" on={!!settings.sms_enabled} onChange={() => saveSettings({ sms_enabled: settings.sms_enabled ? 0 : 1 })} /> SMS notifications enabled
            </label>
            <FormField label="API Endpoint">
              <input className="input" value={settings.sms_api_url || ''} onChange={(e) => setS({ sms_api_url: e.target.value })} />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="API Username (un)">
                <input className="input" value={settings.sms_api_user || ''} onChange={(e) => setS({ sms_api_user: e.target.value })} />
              </FormField>
              <FormField label={settings.sms_api_pass_set ? 'API Password (pwd) (saved)' : 'API Password (pwd)'}>
                <input className="input" type="password" placeholder={settings.sms_api_pass_set ? '••••••• (leave blank to keep)' : ''} value={smsPass} onChange={(e) => setSmsPass(e.target.value)} />
              </FormField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Sender ID (sendid)">
                <input className="input" maxLength={11} value={settings.sms_sender || ''} onChange={(e) => setS({ sms_sender: e.target.value })} />
              </FormField>
              <FormField label="Message Type">
                <select className="input" value={settings.sms_type || 1} onChange={(e) => setS({ sms_type: Number(e.target.value) })}>
                  <option value={1}>ASCII (English) — up to 153 chars</option>
                  <option value={2}>Unicode — up to 63 chars</option>
                </select>
              </FormField>
            </div>
            <button type="button" className="btn-primary" onClick={saveGateway} disabled={busy}>{busy ? 'Saving…' : 'Save Bulk SMS Settings'}</button>
          </div>
        </Card>
      )}

      {tab === 'log' && (
        <Card title="Notification Log" noPadding>
          <div className="p-5">
            <DataTable
              columns={[
                { key: 'time', label: 'Time' },
                { key: 'channel', label: 'Channel' },
                { key: 'type', label: 'Type' },
                { key: 'recipient', label: 'Recipient' },
                { key: 'message', label: 'Message', className: 'max-w-[280px]' },
                { key: 'status', label: 'Status' },
              ]}
              rows={logs.map((l) => ({
                key: l.id,
                cells: [
                  <span className="text-slate-400 whitespace-nowrap">{new Date(l.date).toLocaleString()}</span>,
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    {l.channel === 'email' ? <Mail size={14} /> : <MessageSquare size={14} />} {l.channel}
                  </span>,
                  <span className="text-slate-500">{TYPE_LABEL[l.type] || l.type}</span>,
                  <span className="text-slate-600">
                    {l.customer}
                    <div className="text-[11px] text-slate-400">{l.recipient || '—'}</div>
                  </span>,
                  <span className="text-slate-500 truncate block max-w-[280px]" title={l.message}>{l.message}</span>,
                  <span>
                    <StatusBadge status={l.status} />
                    <div className="text-[11px] text-slate-400">{l.detail}</div>
                  </span>,
                ],
              }))}
              emptyMessage="No notifications yet."
            />
          </div>
        </Card>
      )}
    </Layout>
  );
}

function Row({ icon, label, desc, children }: { icon: React.ReactNode; label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <div className="text-sm font-medium text-slate-700">{label}</div>
          <div className="text-xs text-slate-400">{desc}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

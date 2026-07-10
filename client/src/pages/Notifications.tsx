import { useEffect, useState } from 'react';
import { Mail, MessageSquare, Send, PlayCircle, Bell, Clock, PowerOff } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge } from '../components/ui';
import { api } from '../api';

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`relative w-9 h-5 rounded-full transition-colors ${on ? 'bg-brand-500' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

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
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('send');
  const [smtpPass, setSmtpPass] = useState('');
  const [smsPass, setSmsPass] = useState('');

  const loadLogs = () => api.get('/notifications').then((r) => setLogs(r.data));

  useEffect(() => {
    api.get('/notifications/settings').then((r) => setSettings(r.data));
    api.get('/clients').then((r) => setClients(r.data));
    loadLogs();
  }, []);

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

  const flash = (msg: string) => {
    setBanner(msg);
    setTimeout(() => setBanner(''), 5000);
  };

  const send = async () => {
    if (!message.trim()) {
      flash('Please enter a message.');
      return;
    }
    if (target === 'selected' && selected.length === 0) {
      flash('Please select at least one client.');
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
      flash(`Automations run: ${r.data.remindersSent} reminder(s) sent, ${r.data.marked} marked non-payment, ${r.data.disabled} auto-disabled.`);
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

  const TABS: [string, string][] = [
    ['send', 'Send'],
    ['automation', 'Reminders & Auto-disable'],
    ['smtp', 'Email (SMTP)'],
    ['sms', 'Bulk SMS'],
    ['log', 'Log'],
  ];

  if (!settings) return <Layout title="Notifications"><div className="text-slate-400">Loading…</div></Layout>;

  return (
    <Layout title="Notifications">
      {banner && <div className="mb-4 text-sm bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg px-4 py-2.5">{banner}</div>}

      <div className="flex items-center gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm border-b-2 whitespace-nowrap ${tab === key ? 'border-brand-500 text-brand-600 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'send' && (
        <Card title="Send Notification">
          <div className="space-y-3">
            <div>
              <span className="text-sm text-slate-600 mb-1 block">Channel</span>
              <div className="flex gap-2">
                {([['email', 'Email', Mail], ['sms', 'SMS', MessageSquare], ['both', 'Both', Send]] as const).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    onClick={() => setChannel(key)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border ${channel === key ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1">Uses each client's saved email and/or SMS contact number.</p>
            </div>

            <div>
              <span className="text-sm text-slate-600 mb-1 block">Recipients</span>
              <div className="flex gap-2 mb-2">
                {(['all', 'selected'] as const).map((t) => (
                  <button
                    key={t}
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
            </div>

            <div>
              <span className="text-sm text-slate-600 mb-1 block">Message template</span>
              <select className="input" defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">— Choose a preformatted template —</option>
                {TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                Tokens are personalized per subscriber: <code>{'{name}'}</code>, <code>{'{account}'}</code>, <code>{'{plan}'}</code>, <code>{'{amount}'}</code>, <code>{'{due}'}</code>.
              </p>
            </div>

            {channel !== 'sms' && (
              <label className="block">
                <span className="text-sm text-slate-600 mb-1 block">Subject (email)</span>
                <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </label>
            )}
            <label className="block">
              <span className="text-sm text-slate-600 mb-1 block">Message</span>
              <textarea className="input min-h-[110px]" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type your announcement or reminder…" />
            </label>
            <button className="btn-primary" onClick={send} disabled={busy}>
              <Send size={16} /> {busy ? 'Sending…' : target === 'all' ? 'Send to all clients' : `Send to ${selected.length} selected`}
            </button>
          </div>
        </Card>
      )}

      {tab === 'automation' && (
        <Card title="Reminder & Auto-disable Settings">
          <div className="space-y-4">
            <Row icon={<Bell size={16} className="text-brand-500" />} label="Expiry reminders" desc="Notify clients before their plan expires">
              <Toggle on={!!settings.reminder_enabled} onChange={() => saveSettings({ reminder_enabled: settings.reminder_enabled ? 0 : 1 })} />
            </Row>
            <div className="flex items-center justify-between text-sm pl-7">
              <span className="text-slate-500">Send reminder this many days before expiration</span>
              <input
                type="number"
                min={1}
                className="input w-20 text-center"
                value={settings.days_before}
                onChange={(e) => saveSettings({ days_before: Number(e.target.value) })}
              />
            </div>

            <div className="flex items-center gap-4 pl-7 text-sm">
              <label className="flex items-center gap-2"><Toggle on={!!settings.email_enabled} onChange={() => saveSettings({ email_enabled: settings.email_enabled ? 0 : 1 })} /> Email</label>
              <label className="flex items-center gap-2"><Toggle on={!!settings.sms_enabled} onChange={() => saveSettings({ sms_enabled: settings.sms_enabled ? 0 : 1 })} /> SMS</label>
            </div>

            <div className="border-t border-slate-100 pt-3" />

            <Row icon={<PowerOff size={16} className="text-rose-500" />} label="Auto-disable on non-payment" desc="Disconnect overdue clients automatically">
              <Toggle on={!!settings.autodisable_enabled} onChange={() => saveSettings({ autodisable_enabled: settings.autodisable_enabled ? 0 : 1 })} />
            </Row>
            <div className="flex items-center justify-between text-sm pl-7">
              <span className="text-slate-500">Disable after this many hours of non-payment</span>
              <input
                type="number"
                min={1}
                className="input w-20 text-center"
                value={settings.autodisable_hours}
                onChange={(e) => saveSettings({ autodisable_hours: Number(e.target.value) })}
              />
            </div>

            <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
              <div className="text-xs text-slate-400 flex items-center gap-1.5"><Clock size={14} /> Runs automatically every 5 minutes.</div>
              <button className="inline-flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 text-slate-600" onClick={runNow} disabled={busy}>
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
              <Toggle on={!!settings.email_enabled} onChange={() => saveSettings({ email_enabled: settings.email_enabled ? 0 : 1 })} /> Email notifications enabled
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-sm text-slate-600 mb-1 block">SMTP Host</span>
                <input className="input" placeholder="smtp.gmail.com" value={settings.smtp_host || ''} onChange={(e) => setS({ smtp_host: e.target.value })} /></label>
              <label className="block"><span className="text-sm text-slate-600 mb-1 block">Port</span>
                <input className="input" type="number" value={settings.smtp_port || 587} onChange={(e) => setS({ smtp_port: Number(e.target.value) })} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Toggle on={!!settings.smtp_secure} onChange={() => setS({ smtp_secure: settings.smtp_secure ? 0 : 1 })} /> Use SSL/TLS (port 465)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-sm text-slate-600 mb-1 block">SMTP Username</span>
                <input className="input" value={settings.smtp_user || ''} onChange={(e) => setS({ smtp_user: e.target.value })} /></label>
              <label className="block"><span className="text-sm text-slate-600 mb-1 block">SMTP Password {settings.smtp_pass_set && <span className="text-emerald-600 text-xs">(saved)</span>}</span>
                <input className="input" type="password" placeholder={settings.smtp_pass_set ? '••••••• (leave blank to keep)' : ''} value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} /></label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-sm text-slate-600 mb-1 block">From Address</span>
                <input className="input" placeholder="billing@pa-north.net" value={settings.smtp_from || ''} onChange={(e) => setS({ smtp_from: e.target.value })} /></label>
              <label className="block"><span className="text-sm text-slate-600 mb-1 block">Default From (fallback)</span>
                <input className="input" value={settings.email_from || ''} onChange={(e) => setS({ email_from: e.target.value })} /></label>
            </div>
            <button className="btn-primary" onClick={saveGateway} disabled={busy}>{busy ? 'Saving…' : 'Save SMTP Settings'}</button>
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
              <Toggle on={!!settings.sms_enabled} onChange={() => saveSettings({ sms_enabled: settings.sms_enabled ? 0 : 1 })} /> SMS notifications enabled
            </label>
            <label className="block"><span className="text-sm text-slate-600 mb-1 block">API Endpoint</span>
              <input className="input" value={settings.sms_api_url || ''} onChange={(e) => setS({ sms_api_url: e.target.value })} /></label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-sm text-slate-600 mb-1 block">API Username (un)</span>
                <input className="input" value={settings.sms_api_user || ''} onChange={(e) => setS({ sms_api_user: e.target.value })} /></label>
              <label className="block"><span className="text-sm text-slate-600 mb-1 block">API Password (pwd) {settings.sms_api_pass_set && <span className="text-emerald-600 text-xs">(saved)</span>}</span>
                <input className="input" type="password" placeholder={settings.sms_api_pass_set ? '••••••• (leave blank to keep)' : ''} value={smsPass} onChange={(e) => setSmsPass(e.target.value)} /></label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-sm text-slate-600 mb-1 block">Sender ID (sendid)</span>
                <input className="input" maxLength={11} value={settings.sms_sender || ''} onChange={(e) => setS({ sms_sender: e.target.value })} /></label>
              <label className="block"><span className="text-sm text-slate-600 mb-1 block">Message Type</span>
                <select className="input" value={settings.sms_type || 1} onChange={(e) => setS({ sms_type: Number(e.target.value) })}>
                  <option value={1}>ASCII (English) — up to 153 chars</option>
                  <option value={2}>Unicode — up to 63 chars</option>
                </select></label>
            </div>
            <button className="btn-primary" onClick={saveGateway} disabled={busy}>{busy ? 'Saving…' : 'Save Bulk SMS Settings'}</button>
          </div>
        </Card>
      )}

      {tab === 'log' && (
      <div>
        <Card title="Notification Log">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-left border-b border-slate-100">
                  <th className="py-2 font-medium">Time</th>
                  <th className="py-2 font-medium">Channel</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Recipient</th>
                  <th className="py-2 font-medium">Message</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-slate-50">
                    <td className="py-2 text-slate-400 whitespace-nowrap">{new Date(l.date).toLocaleString()}</td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1 text-slate-600">
                        {l.channel === 'email' ? <Mail size={14} /> : <MessageSquare size={14} />} {l.channel}
                      </span>
                    </td>
                    <td className="py-2 text-slate-500">{TYPE_LABEL[l.type] || l.type}</td>
                    <td className="py-2 text-slate-600">{l.customer}<div className="text-[11px] text-slate-400">{l.recipient || '—'}</div></td>
                    <td className="py-2 text-slate-500 max-w-[280px] truncate" title={l.message}>{l.message}</td>
                    <td className="py-2"><StatusBadge status={l.status} /><div className="text-[11px] text-slate-400">{l.detail}</div></td>
                  </tr>
                ))}
                {logs.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-400">No notifications yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
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

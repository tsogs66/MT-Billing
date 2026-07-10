import { useEffect, useState } from 'react';
import { Database, Download, KeyRound, Save, Settings2, Shield, Info } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, Stat } from '../components/ui';
import { api } from '../api';

interface PanelInfo {
  version: string;
  nodeVersion: string;
  dbSize: number;
  dbModified: string | null;
  counts: Record<string, number>;
}

const TIMEZONES = [
  'Asia/Manila',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
];

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [info, setInfo] = useState<PanelInfo | null>(null);
  const [saved, setSaved] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [backingUp, setBackingUp] = useState(false);

  const load = () => api.get('/settings').then((r) => {
    setSettings(r.data.settings);
    setInfo(r.data.info);
  });

  useEffect(() => { load(); }, []);

  const save = async () => {
    const r = await api.put('/settings', settings);
    setSettings(r.data.settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const changePassword = async () => {
    setPwMsg('');
    setPwErr('');
    if (pw.next !== pw.confirm) {
      setPwErr('New passwords do not match');
      return;
    }
    try {
      await api.put('/settings/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg('Password updated successfully');
    } catch (e: any) {
      setPwErr(e?.response?.data?.error || 'Failed to change password');
    }
  };

  const downloadBackup = async () => {
    setBackingUp(true);
    try {
      const res = await api.get('/settings/backup', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers['content-disposition'] || '';
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] || 'mt-billing-backup.sqlite';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBackingUp(false);
    }
  };

  if (!settings || !info) {
    return <Layout title="System Settings"><div className="text-slate-400">Loading...</div></Layout>;
  }

  const set = (key: string, value: string) => setSettings({ ...settings, [key]: value });

  return (
    <Layout title="System Settings">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card title="General" right={<Settings2 size={18} className="text-slate-400" />}>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm text-slate-600 mb-1 block">Panel Name</span>
              <input className="input" value={settings.panel_name} onChange={(e) => set('panel_name', e.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm text-slate-600 mb-1 block">Timezone</span>
              <select className="input" value={settings.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-slate-600 mb-1 block">Date Format</span>
              <select className="input" value={settings.date_format} onChange={(e) => set('date_format', e.target.value)}>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-slate-600 mb-1 block">Notification Email</span>
              <input className="input" type="email" placeholder="admin@example.com" value={settings.notification_email} onChange={(e) => set('notification_email', e.target.value)} />
            </label>
            <div className="flex items-center gap-3 pt-2">
              <button className="btn-primary" onClick={save}><Save size={16} /> Save Changes</button>
              {saved && <span className="text-sm text-emerald-600">Saved!</span>}
            </div>
          </div>
        </Card>

        <Card title="Billing & Map" right={<Shield size={18} className="text-slate-400" />}>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm text-slate-600 mb-1 block">Map Auto-Refresh (seconds)</span>
              <input className="input" type="number" min={10} max={300} value={settings.map_refresh_sec} onChange={(e) => set('map_refresh_sec', e.target.value)} />
            </label>
            <label className="block">
              <span className="text-sm text-slate-600 mb-1 block">Billing Grace Period (days)</span>
              <input className="input" type="number" min={0} max={30} value={settings.billing_grace_days} onChange={(e) => set('billing_grace_days', e.target.value)} />
              <span className="text-xs text-slate-400 mt-1 block">Days after expiration before auto-suspension</span>
            </label>
            <label className="flex items-center gap-3 pt-1">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                checked={settings.auto_suspend_expired === '1'}
                onChange={(e) => set('auto_suspend_expired', e.target.checked ? '1' : '0')}
              />
              <span className="text-sm text-slate-600">Auto-suspend expired subscribers</span>
            </label>
            <label className="block">
              <span className="text-sm text-slate-600 mb-1 block">Session Timeout (hours)</span>
              <input className="input" type="number" min={1} max={72} value={settings.session_timeout_hours} onChange={(e) => set('session_timeout_hours', e.target.value)} />
            </label>
            <div className="flex items-center gap-3 pt-2">
              <button className="btn-primary" onClick={save}><Save size={16} /> Save Changes</button>
            </div>
          </div>
        </Card>

        <Card title="Change Password" right={<KeyRound size={18} className="text-slate-400" />}>
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm text-slate-600 mb-1 block">Current Password</span>
              <input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm text-slate-600 mb-1 block">New Password</span>
              <input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm text-slate-600 mb-1 block">Confirm New Password</span>
              <input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </label>
            {pwErr && <p className="text-sm text-rose-600">{pwErr}</p>}
            {pwMsg && <p className="text-sm text-emerald-600">{pwMsg}</p>}
            <button className="btn-primary" onClick={changePassword} disabled={!pw.current || !pw.next || !pw.confirm}>
              Update Password
            </button>
          </div>
        </Card>

        <Card title="Database Backup" right={<Database size={18} className="text-slate-400" />}>
          <p className="text-sm text-slate-500 mb-4">
            Download a full SQLite snapshot of the panel database. Store backups securely and restore by replacing
            <code className="mx-1 text-xs bg-slate-100 px-1.5 py-0.5 rounded">server/data/mt-billing.db</code>
            while the server is stopped.
          </p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Stat label="Database Size" value={formatBytes(info.dbSize)} />
            <Stat label="Last Modified" value={info.dbModified ? new Date(info.dbModified).toLocaleString() : '—'} />
          </div>
          <button className="btn-primary" onClick={downloadBackup} disabled={backingUp}>
            <Download size={16} /> {backingUp ? 'Preparing...' : 'Download Backup'}
          </button>
        </Card>

        <Card title="Panel Info" right={<Info size={18} className="text-slate-400" />} className="xl:col-span-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Version" value={info.version} />
            <Stat label="Node.js" value={info.nodeVersion} />
            <Stat label="Subscribers" value={info.counts.subscribers} />
            <Stat label="Transactions" value={info.counts.transactions} />
            <Stat label="Routers" value={info.counts.routers} />
            <Stat label="Users" value={info.counts.users} />
            <Stat label="Log Entries" value={info.counts.logs} />
          </div>
        </Card>
      </div>
    </Layout>
  );
}

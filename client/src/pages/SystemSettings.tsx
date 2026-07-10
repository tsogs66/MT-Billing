import { useEffect, useRef, useState } from 'react';
import {
  Settings as SettingsIcon, Sun, Moon, Monitor, Database as DbIcon, Bot, Clock, KeyRound,
  Router as RouterIcon, Globe2, Download, Trash2, RefreshCw, Plus, Pencil, X,
} from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge } from '../components/ui';
import { api } from '../api';

const TABS = [
  ['panel', 'Panel Settings'],
  ['ngrok', 'Ngrok Remote Access'],
  ['database', 'Database Management'],
  ['ai', 'AI Settings'],
  ['time', 'Time Synchronization'],
  ['account', 'Account Reset'],
  ['routers', 'Router Management'],
] as const;

export default function SystemSettings() {
  const [tab, setTab] = useState('panel');
  const [app, setApp] = useState<any>(null);
  const [banner, setBanner] = useState('');

  const load = () => api.get('/settings/app').then((r) => setApp(r.data));
  useEffect(() => {
    load();
  }, []);

  const flash = (m: string) => {
    setBanner(m);
    setTimeout(() => setBanner(''), 4000);
  };
  const setA = (patch: any) => setApp((s: any) => ({ ...s, ...patch }));
  const saveApp = async (extra: any = {}) => {
    const r = await api.put('/settings/app', { ...app, ...extra });
    setApp(r.data);
    flash('Settings saved.');
  };

  if (!app) return <Layout title="System Settings"><div className="text-slate-400">Loading…</div></Layout>;

  return (
    <Layout title="System Settings">
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

      {tab === 'panel' && <PanelSettings app={app} setA={setA} save={saveApp} />}
      {tab === 'ngrok' && <NgrokSettings app={app} setA={setA} save={saveApp} flash={flash} reload={load} />}
      {tab === 'database' && <DatabaseManagement flash={flash} />}
      {tab === 'ai' && <AiSettings app={app} setA={setA} save={saveApp} />}
      {tab === 'time' && <TimeSync app={app} setA={setA} save={saveApp} flash={flash} />}
      {tab === 'account' && <AccountReset flash={flash} />}
      {tab === 'routers' && <RouterManagement flash={flash} />}
    </Layout>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="card max-w-4xl">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        {icon}
        <h3 className="text-brand-600 font-bold text-lg">{title}</h3>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function PanelSettings({ app, setA, save }: any) {
  const themes = [
    ['light', 'Light', Sun],
    ['dark', 'Dark', Moon],
    ['system', 'System', Monitor],
  ] as const;
  return (
    <Section icon={<SettingsIcon size={20} className="text-brand-500" />} title="Panel Settings">
      <div className="space-y-5 max-w-2xl">
        <div>
          <span className="text-sm font-semibold text-slate-700 mb-1 block">Theme</span>
          <div className="grid grid-cols-3 rounded-lg border border-slate-200 overflow-hidden">
            {themes.map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setA({ theme: key })}
                className={`flex items-center justify-center gap-2 py-2.5 text-sm ${app.theme === key ? 'bg-white text-brand-600 font-medium shadow-inner' : 'bg-slate-50 text-slate-500 hover:bg-white'}`}
              >
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Language</span>
            <select className="input" value={app.language} onChange={(e) => setA({ language: e.target.value })}>
              <option value="en">English</option>
              <option value="fil">Filipino</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Currency</span>
            <select className="input" value={app.currency} onChange={(e) => setA({ currency: e.target.value })}>
              <option value="PHP">PHP (₱)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => save()}>Save Panel Settings</button>
        </div>
      </div>
    </Section>
  );
}

function NgrokSettings({ app, setA, save, flash, reload }: any) {
  const [token, setToken] = useState('');
  const toggle = async () => {
    try {
      const r = await api.post('/ngrok/toggle');
      flash(r.data.status === 'running' ? `Tunnel started: ${r.data.url}` : 'Tunnel stopped.');
      reload();
    } catch (e: any) {
      flash(e?.response?.data?.error || 'Failed to toggle tunnel.');
    }
  };
  return (
    <Section icon={<Globe2 size={20} className="text-brand-500" />} title="Ngrok Remote Access">
      <div className="space-y-4 max-w-2xl">
        <p className="text-sm text-slate-500">Expose the panel securely over the internet via an ngrok tunnel.</p>
        <div className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3">
          <div>
            <div className="text-sm font-medium text-slate-700">Tunnel status</div>
            <div className="text-xs text-slate-400">{app.ngrok_url ? app.ngrok_url : 'Not running'}</div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={app.ngrok_status === 'running' ? 'running' : 'offline'} />
            <button className="btn-primary" onClick={toggle}>{app.ngrok_status === 'running' ? 'Stop' : 'Start'} Tunnel</button>
          </div>
        </div>
        <label className="block">
          <span className="text-sm font-semibold text-slate-700 mb-1 block">Auth Token {app.ngrok_authtoken_set && <span className="text-emerald-600 text-xs">(saved)</span>}</span>
          <input className="input" type="password" placeholder={app.ngrok_authtoken_set ? '••••••• (leave blank to keep)' : 'ngrok authtoken'} value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Region</span>
            <select className="input" value={app.ngrok_region} onChange={(e) => setA({ ngrok_region: e.target.value })}>
              {['us', 'eu', 'ap', 'au', 'sa', 'jp', 'in'].map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Local Port</span>
            <input className="input" type="number" value={app.ngrok_port} onChange={(e) => setA({ ngrok_port: Number(e.target.value) })} />
          </label>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => save(token ? { ngrok_authtoken: token } : {})}>Save Ngrok Settings</button>
        </div>
      </div>
    </Section>
  );
}

function DatabaseManagement({ flash }: any) {
  const [backups, setBackups] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('No file chosen');
  const [fileData, setFileData] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.get('/db/backups').then((r) => setBackups(r.data));
  useEffect(() => {
    load();
  }, []);

  const createBackup = async () => {
    setBusy(true);
    try {
      await api.post('/db/backup');
      flash('Backup created.');
      load();
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => setFileData(String(reader.result));
    reader.readAsDataURL(f);
  };

  const restore = async () => {
    if (!fileData) {
      flash('Choose a backup file first.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/db/restore', { data: fileData });
      flash('Database restored. Restart the server to load it.');
    } catch (e: any) {
      flash(e?.response?.data?.error || 'Restore failed.');
    } finally {
      setBusy(false);
    }
  };

  const download = async (name: string) => {
    const r = await api.get(`/db/backups/${name}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(r.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const del = async (name: string) => {
    await api.delete(`/db/backups/${name}`);
    load();
  };

  const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`);

  return (
    <Section icon={<DbIcon size={20} className="text-brand-500" />} title="Database Management">
      <div className="space-y-5">
        <button className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 text-white font-medium py-2.5 rounded-lg" onClick={createBackup} disabled={busy}>
          <DbIcon size={16} /> Create New Backup
        </button>

        <div className="rounded-lg bg-amber-50/60 border border-amber-100 p-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">Restore from downloaded backup</div>
          <div className="flex items-center gap-3 mb-3">
            <button className="btn-primary" onClick={() => fileRef.current?.click()}>Choose file</button>
            <span className="text-sm text-slate-500">{fileName}</span>
            <input ref={fileRef} type="file" accept=".db,application/octet-stream" className="hidden" onChange={onFile} />
          </div>
          <button className="w-full flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-500 text-white font-medium py-2.5 rounded-lg disabled:opacity-60" onClick={restore} disabled={busy || !fileData}>
            <RefreshCw size={16} /> Upload &amp; Restore
          </button>
        </div>

        <div>
          <div className="text-sm font-semibold text-slate-700 mb-2">Available Backups</div>
          {backups.length === 0 ? (
            <div className="text-center text-slate-400 py-6">No database backups found.</div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
              {backups.map((b) => (
                <div key={b.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div>
                    <div className="text-slate-700 font-medium">{b.name}</div>
                    <div className="text-xs text-slate-400">{new Date(b.created).toLocaleString()} · {fmtSize(b.size)}</div>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400">
                    <button title="Download" className="hover:text-sky-600" onClick={() => download(b.name)}><Download size={16} /></button>
                    <button title="Delete" className="hover:text-rose-600" onClick={() => del(b.name)}><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function AiSettings({ app, setA, save }: any) {
  const [key, setKey] = useState('');
  return (
    <Section icon={<Bot size={20} className="text-brand-500" />} title="AI Settings">
      <div className="space-y-4 max-w-2xl">
        <p className="text-sm text-slate-500">
          Full Claude &amp; Cursor API setup lives under{' '}
          <a href="/ai-scripting" className="text-brand-600 hover:underline font-medium">AI Scripting → Setup</a>.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="w-4 h-4" checked={!!app.ai_enabled} onChange={(e) => setA({ ai_enabled: e.target.checked ? 1 : 0 })} /> Enable AI Scripting assistant
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Default provider</span>
            <select className="input" value={app.ai_provider} onChange={(e) => setA({ ai_provider: e.target.value })}>
              <option value="anthropic">Claude (Anthropic)</option>
              <option value="cursor">Cursor Cloud Agents</option>
              <option value="openai">OpenAI</option>
              <option value="google">Google Gemini</option>
              <option value="ollama">Ollama (local)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Claude model</span>
            <input className="input" value={app.ai_model} onChange={(e) => setA({ ai_model: e.target.value })} placeholder="claude-sonnet-4-20250514" />
          </label>
        </div>
        <label className="block">
          <span className="text-sm font-semibold text-slate-700 mb-1 block">Claude API Key {app.ai_api_key_set && <span className="text-emerald-600 text-xs">(saved)</span>}</span>
          <input className="input" type="password" placeholder={app.ai_api_key_set ? '••••••• (leave blank to keep)' : 'sk-ant-...'} value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => save(key ? { ai_api_key: key } : {})}>Save AI Settings</button>
        </div>
      </div>
    </Section>
  );
}

function TimeSync({ app, setA, save, flash }: any) {
  const [now, setNow] = useState('');
  const refresh = () => api.get('/time').then((r) => setNow(r.data.serverTime));
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, []);
  const syncNow = async () => {
    const r = await api.post('/time/sync');
    setNow(r.data.serverTime);
    flash('Time synchronized.');
  };
  const zones = ['Asia/Manila', 'Asia/Singapore', 'Asia/Tokyo', 'UTC', 'America/Los_Angeles', 'Europe/London'];
  return (
    <Section icon={<Clock size={20} className="text-brand-500" />} title="Time Synchronization">
      <div className="space-y-4 max-w-2xl">
        <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
          <div className="text-xs text-slate-400">Server time</div>
          <div className="text-lg font-semibold text-slate-800">{now ? new Date(now).toLocaleString('en-US', { timeZone: app.tz }) : '—'}</div>
          <div className="text-xs text-slate-400">{app.tz}</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Timezone</span>
            <select className="input" value={app.tz} onChange={(e) => setA({ tz: e.target.value })}>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">NTP Server</span>
            <input className="input" value={app.ntp_server} onChange={(e) => setA({ ntp_server: e.target.value })} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button className="inline-flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 text-slate-600" onClick={syncNow}><RefreshCw size={15} /> Sync now</button>
          <button className="btn-primary" onClick={() => save()}>Save Time Settings</button>
        </div>
      </div>
    </Section>
  );
}

function AccountReset({ flash }: any) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (pw.length < 6) {
      flash('Password must be at least 6 characters.');
      return;
    }
    if (pw !== confirm) {
      flash('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/account/reset-password', { newPassword: pw });
      flash('Password updated.');
      setPw('');
      setConfirm('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section icon={<KeyRound size={20} className="text-brand-500" />} title="Account Reset">
      <div className="space-y-4 max-w-md">
        <p className="text-sm text-slate-500">Change the password for the current panel account.</p>
        <label className="block">
          <span className="text-sm font-semibold text-slate-700 mb-1 block">New Password</span>
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-slate-700 mb-1 block">Confirm Password</span>
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Reset Password'}</button>
      </div>
    </Section>
  );
}

function RouterManagement({ flash }: any) {
  const [routers, setRouters] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);

  const load = () => api.get('/routers').then((r) => setRouters(r.data));
  useEffect(() => {
    load();
  }, []);

  const del = async (id: number) => {
    await api.delete(`/routers/${id}`);
    flash('Router removed.');
    load();
  };

  return (
    <Section icon={<RouterIcon size={20} className="text-brand-500" />} title="Router Management">
      <div className="space-y-3">
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setEdit({ name: '', host: '', port: 8728, api_user: '', api_pass: '', board: '', type: 'pppoe', status: 'online' })}>
            <Plus size={16} /> Add Router
          </button>
        </div>
        <div className="border border-slate-100 rounded-lg divide-y divide-slate-100">
          {routers.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-medium text-slate-800">{r.name}</div>
                <div className="text-xs text-slate-400">{r.host}:{r.port} · {(r.type || '').toUpperCase()} · {r.board || 'no board'}</div>
              </div>
              <div className="flex items-center gap-3 text-slate-400">
                <StatusBadge status={r.status} />
                <button className="hover:text-sky-600" onClick={() => setEdit(r)}><Pencil size={16} /></button>
                <button className="hover:text-rose-600" onClick={() => del(r.id)}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
          {routers.length === 0 && <div className="px-4 py-6 text-center text-slate-400 text-sm">No routers configured.</div>}
        </div>
      </div>

      {edit && (
        <RouterModal
          router={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            flash('Router saved.');
            load();
          }}
        />
      )}
    </Section>
  );
}

function RouterModal({ router, onClose, onSaved }: any) {
  const [form, setForm] = useState({ ...router, api_pass: '' });
  const [busy, setBusy] = useState(false);
  const isEdit = !!router.id;
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));
  const save = async () => {
    if (!form.name?.trim()) return;
    setBusy(true);
    try {
      if (isEdit) await api.put(`/routers/${router.id}`, form);
      else await api.post('/routers', form);
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">{isEdit ? 'Edit Router' : 'Add Router'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <Labeled label="Name"><input className="input" value={form.name || ''} onChange={(e) => set({ name: e.target.value })} /></Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Host / IP"><input className="input" value={form.host || ''} onChange={(e) => set({ host: e.target.value })} /></Labeled>
            <Labeled label="API Port"><input className="input" type="number" value={form.port || 8728} onChange={(e) => set({ port: Number(e.target.value) })} /></Labeled>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="API User"><input className="input" value={form.api_user || ''} onChange={(e) => set({ api_user: e.target.value })} /></Labeled>
            <Labeled label="API Password"><input className="input" type="password" placeholder={isEdit ? '(leave blank to keep)' : ''} value={form.api_pass || ''} onChange={(e) => set({ api_pass: e.target.value })} /></Labeled>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Type">
              <select className="input" value={form.type || 'pppoe'} onChange={(e) => set({ type: e.target.value })}>
                <option value="pppoe">PPPoE</option>
                <option value="ipoe">IPoE</option>
              </select>
            </Labeled>
            <Labeled label="Board"><input className="input" value={form.board || ''} onChange={(e) => set({ board: e.target.value })} /></Labeled>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-slate-600 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

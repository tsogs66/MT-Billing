import { useEffect, useState } from 'react';
import { Activity, Globe2, RefreshCw, Users } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, TabBar, Toolbar } from '../components/ui';
import { api } from '../api';
import { formatBps } from '../lib/traffic';

function formatBytes(n: number): string {
  const v = Number(n) || 0;
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)} TB`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)} KB`;
  return `${Math.round(v)} B`;
}

const TABS = [
  { key: 'users', label: 'Per User', icon: Users },
  { key: 'services', label: 'Websites & Platforms', icon: Globe2 },
];

export default function UsageStats() {
  const [tab, setTab] = useState('users');
  const [days, setDays] = useState(7);
  const [users, setUsers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const load = () => {
    setBusy(true);
    api
      .get('/usage/summary', { params: { days } })
      .then((r) => {
        setUsers(r.data.users || []);
        setServices(r.data.services || []);
      })
      .catch(() => {
        setUsers([]);
        setServices([]);
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const openUser = async (u: any) => {
    setSelected(u);
    if (!u.userId) {
      setHistory([]);
      return;
    }
    try {
      const r = await api.get(`/usage/users/${u.userId}/history`, { params: { days: 30 } });
      setHistory(r.data.history || []);
    } catch {
      setHistory([]);
    }
  };

  const poll = async () => {
    setBusy(true);
    try {
      await api.post('/usage/poll');
      load();
    } finally {
      setBusy(false);
    }
  };

  const maxServiceHits = Math.max(1, ...services.map((s) => Number(s.hits) || 0));

  return (
    <Layout title="Usage Statistics">
      <Card noPadding interactive className="overflow-hidden">
        <TabBar tabs={TABS} active={tab} onChange={setTab} className="px-2" />
        <Toolbar
          left={
            <div className="text-sm text-slate-500">
              Traffic samples from MikroTik · DNS cache for platforms · last{' '}
              <select className="input py-1 text-xs inline-block w-auto ml-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
              </select>
            </div>
          }
          right={
            <>
              <button type="button" className="btn-secondary" onClick={poll} disabled={busy}>
                <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> Sample now
              </button>
            </>
          }
        />

        {tab === 'users' && (
          <div className="p-4 pt-0 grid lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                    <th className="py-2 font-medium">Subscriber</th>
                    <th className="py-2 font-medium">Plan</th>
                    <th className="py-2 font-medium text-right">Download</th>
                    <th className="py-2 font-medium text-right">Upload</th>
                    <th className="py-2 font-medium text-right">Peak ↓</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr
                      key={u.username}
                      className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${selected?.username === u.username ? 'bg-brand-50/50' : ''}`}
                      onClick={() => openUser(u)}
                    >
                      <td className="py-2.5">
                        <div className="font-semibold text-slate-800">{u.username}</div>
                        <div className="text-xs text-slate-400">{u.customer}</div>
                      </td>
                      <td className="py-2.5 text-slate-600">{u.profile || '—'}</td>
                      <td className="py-2.5 text-right font-medium text-emerald-700">{formatBytes(u.rxBytes)}</td>
                      <td className="py-2.5 text-right font-medium text-sky-700">{formatBytes(u.txBytes)}</td>
                      <td className="py-2.5 text-right text-xs text-slate-500">{formatBps(u.peakRxBps)}</td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-400">
                        No usage samples yet. Click Sample now while clients are online.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="lg:col-span-2 rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <div className="flex items-center gap-2 font-semibold text-slate-800 mb-3">
                <Activity size={16} /> {selected ? selected.username : 'Select a user'}
              </div>
              {!selected && <div className="text-sm text-slate-400">Click a subscriber to view 30-day history.</div>}
              {selected && (
                <div className="space-y-2 max-h-80 overflow-auto">
                  {history.map((h) => (
                    <div key={h.day} className="flex justify-between text-xs bg-white rounded-lg px-3 py-2 border border-slate-100">
                      <span className="font-medium text-slate-700">{h.day}</span>
                      <span className="text-emerald-700">{formatBytes(h.rxBytes)} ↓</span>
                      <span className="text-sky-700">{formatBytes(h.txBytes)} ↑</span>
                    </div>
                  ))}
                  {history.length === 0 && <div className="text-sm text-slate-400">No daily history yet.</div>}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'services' && (
          <div className="p-4 pt-0 space-y-3">
            <div className="text-xs text-slate-400 mb-2">
              Estimated from DNS cache lookups on your MikroTik (popularity signal — not exact bytes per site).
            </div>
            {services.map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <div className="w-36 shrink-0">
                  <div className="font-semibold text-slate-800 text-sm">{s.name}</div>
                  <div className="text-[11px] text-slate-400">{s.category}</div>
                </div>
                <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.max(4, (Number(s.hits) / maxServiceHits) * 100)}%` }}
                  />
                </div>
                <div className="w-16 text-right text-xs font-semibold text-slate-600">{s.hits}</div>
              </div>
            ))}
            {services.length === 0 && (
              <div className="py-10 text-center text-slate-400 text-sm">
                No platform data yet. Ensure the router has DNS caching enabled, then Sample now.
              </div>
            )}
          </div>
        )}
      </Card>
    </Layout>
  );
}

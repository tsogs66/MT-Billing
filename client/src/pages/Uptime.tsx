import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Activity, CheckCircle2, AlertTriangle, XCircle, Gauge } from 'lucide-react';
import Layout from '../components/Layout';
import { Card } from '../components/ui';
import { api } from '../api';

interface Sample { t: number; up: boolean; ms: number | null }
interface Monitor {
  id: string;
  name: string;
  category: string;
  url: string;
  status: 'up' | 'down' | 'degraded' | 'pending';
  latencyMs: number | null;
  code: number;
  lastChecked: number | null;
  uptimePct: number;
  avgMs: number | null;
  history: Sample[];
}
interface Summary { total: number; up: number; degraded: number; down: number; avgMs: number | null; lastRun: number | null }

const STATUS: Record<string, { label: string; cls: string; dot: string }> = {
  up: { label: 'Operational', cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  degraded: { label: 'Degraded', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  down: { label: 'Down', cls: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500' },
  pending: { label: 'Checking...', cls: 'bg-slate-100 text-slate-500', dot: 'bg-slate-300' },
};

function ago(ts: number | null) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function Sparkline({ history }: { history: Sample[] }) {
  const pts = history.slice(-24);
  if (pts.length < 2) return <div className="h-8 flex items-center text-[11px] text-slate-300">collecting…</div>;
  const vals = pts.map((p) => (p.up ? p.ms ?? 0 : 0));
  const max = Math.max(1, ...vals);
  const w = 120;
  const h = 32;
  const step = w / (pts.length - 1);
  const path = pts
    .map((p, i) => {
      const y = p.up ? h - ((p.ms ?? 0) / max) * (h - 4) - 2 : h - 2;
      return `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={path} fill="none" stroke="#0ea5e9" strokeWidth={1.5} />
      {pts.map((p, i) => (
        <circle key={i} cx={i * step} cy={p.up ? h - ((p.ms ?? 0) / max) * (h - 4) - 2 : h - 2} r={1.6} fill={p.up ? '#0ea5e9' : '#ef4444'} />
      ))}
    </svg>
  );
}

export default function Uptime() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [checking, setChecking] = useState(false);

  const load = () =>
    api.get('/uptime').then((r) => {
      setMonitors(r.data.monitors);
      setSummary(r.data.summary);
    });

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const refresh = async () => {
    setChecking(true);
    try {
      const r = await api.post('/uptime/check');
      setMonitors(r.data.monitors);
      setSummary(r.data.summary);
    } finally {
      setChecking(false);
    }
  };

  const grouped = useMemo(() => {
    const g: Record<string, Monitor[]> = {};
    for (const m of monitors) (g[m.category] ||= []).push(m);
    return g;
  }, [monitors]);

  return (
    <Layout title="Uptime Monitor">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-5">
        <Card><Metric icon={<Activity size={16} />} label="Monitored" value={summary?.total ?? '—'} tone="text-slate-700" /></Card>
        <Card><Metric icon={<CheckCircle2 size={16} />} label="Operational" value={summary?.up ?? '—'} tone="text-emerald-600" /></Card>
        <Card><Metric icon={<AlertTriangle size={16} />} label="Degraded" value={summary?.degraded ?? '—'} tone="text-amber-600" /></Card>
        <Card><Metric icon={<XCircle size={16} />} label="Down" value={summary?.down ?? '—'} tone="text-rose-600" /></Card>
        <Card><Metric icon={<Gauge size={16} />} label="Avg latency" value={summary?.avgMs != null ? `${summary.avgMs} ms` : '—'} tone="text-sky-600" /></Card>
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-slate-400">
          Last check: <span className="text-slate-600">{ago(summary?.lastRun ?? null)}</span> · auto-refreshes every 30s
        </div>
        <button className="btn-primary" onClick={refresh} disabled={checking}>
          <RefreshCw size={16} className={checking ? 'animate-spin' : ''} /> {checking ? 'Checking...' : 'Check now'}
        </button>
      </div>

      <div className="space-y-5">
        {Object.entries(grouped).map(([category, list]) => (
          <Card key={category} title={category}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-1">
              {list.map((m) => {
                const st = STATUS[m.status] || STATUS.pending;
                return (
                  <div key={m.id} className="flex items-center gap-4 py-2.5 border-b border-slate-50 last:border-0">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot} ${m.status === 'up' ? 'animate-pulse' : ''}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-800 truncate">{m.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">{m.url.replace(/^https?:\/\//, '')}</div>
                    </div>
                    <div className="hidden sm:block"><Sparkline history={m.history} /></div>
                    <div className="text-right w-16 shrink-0">
                      <div className="text-sm font-medium text-slate-700">{m.latencyMs != null ? `${m.latencyMs} ms` : '—'}</div>
                      <div className="text-[11px] text-slate-400">{m.uptimePct}% up</div>
                    </div>
                    <span className={`badge ${st.cls} w-24 justify-center shrink-0`}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </Layout>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center ${tone}`}>{icon}</div>
      <div>
        <div className={`text-lg font-bold ${tone}`}>{value}</div>
        <div className="text-xs text-slate-400">{label}</div>
      </div>
    </div>
  );
}

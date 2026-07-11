import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Activity, CheckCircle2, AlertTriangle, XCircle, Globe2 } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatTile } from '../components/ui';
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
  source?: 'global' | 'regional' | 'unknown';
  detail?: string;
  reportCount1h?: number;
  reportCount24h?: number;
  officialIndicator?: string | null;
  regionStatus?: 'up' | 'down' | 'degraded' | 'unknown';
  regionDetail?: string;
}
interface Summary {
  total: number;
  up: number;
  degraded: number;
  down: number;
  avgMs: number | null;
  reports1h?: number;
  mode?: string;
  lastRun: number | null;
}

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
  const w = 120;
  const h = 32;
  const step = w / (pts.length - 1);
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      {pts.map((p, i) => {
        const x = i * step;
        const y = p.up ? h * 0.35 : h * 0.75;
        const next = pts[i + 1];
        return (
          <g key={i}>
            {next && (
              <line
                x1={x}
                y1={y}
                x2={(i + 1) * step}
                y2={next.up ? h * 0.35 : h * 0.75}
                stroke={p.up && next.up ? '#10b981' : '#f43f5e'}
                strokeWidth={1.5}
              />
            )}
            <circle cx={x} cy={y} r={1.8} fill={p.up ? '#10b981' : '#f43f5e'} />
          </g>
        );
      })}
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
      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-sm text-sky-900 max-w-4xl">
        <div className="flex items-start gap-2">
          <Globe2 size={16} className="mt-0.5 shrink-0 text-sky-600" />
          <div>
            <span className="font-semibold">Global / regional status</span>
            {' — '}status is taken from worldwide outage feeds and official status pages (APAC where available),
            not from whether this panel can reach the site on the local network.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatTile label="Monitored" value={summary?.total ?? '—'} icon={Activity} tone="text-slate-700" delay={0} />
        <StatTile label="Operational" value={summary?.up ?? '—'} icon={CheckCircle2} tone="text-emerald-600" accent="from-emerald-500/15 to-transparent" delay={50} />
        <StatTile label="Degraded" value={summary?.degraded ?? '—'} icon={AlertTriangle} tone="text-amber-600" accent="from-amber-500/15 to-transparent" delay={100} />
        <StatTile label="Down" value={summary?.down ?? '—'} icon={XCircle} tone="text-rose-600" accent="from-rose-500/15 to-transparent" delay={150} />
        <StatTile
          label="Reports (1h)"
          value={summary?.reports1h ?? '—'}
          icon={Globe2}
          tone="text-sky-600"
          accent="from-sky-500/15 to-transparent"
          delay={200}
        />
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-sm text-slate-500">
          Last check: <span className="font-medium text-slate-700">{ago(summary?.lastRun ?? null)}</span>
          {' · '}auto-refreshes every 30s · source: global / APAC status feeds
        </div>
        <button type="button" className="btn-primary" onClick={refresh} disabled={checking}>
          <RefreshCw size={16} className={checking ? 'animate-spin' : ''} /> {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>

      <div className="space-y-5">
        {Object.entries(grouped).map(([category, list]) => (
          <Card key={category} title={category} icon={Activity} interactive>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-1">
              {list.map((m) => {
                const st = STATUS[m.status] || STATUS.pending;
                const reports = m.reportCount1h || 0;
                return (
                  <div key={m.id} className="flex items-center gap-4 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 rounded-lg px-1 transition-colors">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot} ${m.status === 'up' ? 'animate-pulse-soft' : ''}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-800 truncate">{m.name}</div>
                      <div className="text-[11px] text-slate-400 truncate" title={m.detail}>
                        {m.detail || m.url.replace(/^https?:\/\//, '')}
                      </div>
                    </div>
                    <div className="hidden sm:block"><Sparkline history={m.history} /></div>
                    <div className="text-right w-20 shrink-0">
                      <div className="text-sm font-semibold text-slate-700">
                        {reports > 0 ? `${reports} rpt` : m.regionStatus && m.regionStatus !== 'unknown' ? 'APAC' : 'Global'}
                      </div>
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

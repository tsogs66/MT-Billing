import { useEffect, useRef, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api';

interface Point { t: number; upload: number; download: number }
interface GraphCfg { id: string; iface: string; enabled: boolean }

const STORAGE_KEY = 'mt_iface_graphs';
const MAX_POINTS = 30;
const POLL_MS = 2000;

function fmtRate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(2)} kbps`;
  return `${Math.round(bps)} bps`;
}

function fmtAxis(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(0)}M`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)}k`;
  return `${Math.round(bps)}`;
}

function loadGraphs(names: string[]): GraphCfg[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {
    /* ignore */
  }
  return names.slice(0, 3).map((iface, i) => ({ id: `g${i}`, iface, enabled: true }));
}

export default function InterfaceTraffic() {
  const [names, setNames] = useState<string[]>([]);
  const [graphs, setGraphs] = useState<GraphCfg[]>([]);
  const [history, setHistory] = useState<Record<string, Point[]>>({});
  const [, force] = useState(0);
  const ready = useRef(false);

  useEffect(() => {
    api.get('/interfaces').then((r) => {
      setNames(r.data.names);
      setGraphs(loadGraphs(r.data.names));
      ready.current = true;
      force((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    if (ready.current) localStorage.setItem(STORAGE_KEY, JSON.stringify(graphs));
  }, [graphs]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await api.get('/interfaces/traffic');
        if (!alive) return;
        const t = r.data.t as number;
        setHistory((prev) => {
          const next = { ...prev };
          for (const it of r.data.interfaces as { name: string; upload: number; download: number }[]) {
            const arr = (next[it.name] || []).concat({ t, upload: it.upload, download: it.download });
            next[it.name] = arr.slice(-MAX_POINTS);
          }
          return next;
        });
      } catch {
        /* ignore transient errors */
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const addGraph = () => {
    const used = new Set(graphs.map((g) => g.iface));
    const iface = names.find((n) => !used.has(n)) || names[0];
    setGraphs((g) => [...g, { id: `g${Date.now()}`, iface, enabled: true }]);
  };

  const update = (id: string, patch: Partial<GraphCfg>) =>
    setGraphs((g) => g.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: string) => setGraphs((g) => g.filter((x) => x.id !== id));

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-slate-500">Live Interface Traffic</h2>
        <button className="btn-primary" onClick={addGraph}>
          <Plus size={16} /> Add Graph
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {graphs.map((g) => (
          <GraphCard
            key={g.id}
            cfg={g}
            names={names}
            data={g.enabled ? history[g.iface] || [] : []}
            onToggle={() => update(g.id, { enabled: !g.enabled })}
            onSelect={(iface) => update(g.id, { iface })}
            onDelete={() => remove(g.id)}
          />
        ))}
        {graphs.length === 0 && (
          <div className="card p-8 text-center text-slate-400 col-span-full">
            No graphs yet. Click <b>Add Graph</b> to monitor an interface.
          </div>
        )}
      </div>
    </div>
  );
}

function GraphCard({
  cfg,
  names,
  data,
  onToggle,
  onSelect,
  onDelete,
}: {
  cfg: GraphCfg;
  names: string[];
  data: Point[];
  onToggle: () => void;
  onSelect: (iface: string) => void;
  onDelete: () => void;
}) {
  const last = data[data.length - 1];
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-slate-400">Enabled</span>
        <button
          onClick={onToggle}
          className={`relative w-9 h-5 rounded-full transition-colors ${cfg.enabled ? 'bg-brand-500' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${cfg.enabled ? 'translate-x-4' : ''}`} />
        </button>
        <select
          value={cfg.iface}
          onChange={(e) => onSelect(e.target.value)}
          className="ml-auto text-sm border border-slate-200 rounded-lg px-2 py-1.5 max-w-[190px] focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onClick={onDelete} className="text-slate-300 hover:text-rose-500" title="Remove graph">
          <Trash2 size={16} />
        </button>
      </div>

      <div className="relative h-40">
        {cfg.enabled && last && (
          <div className="absolute right-1 top-1 z-10 text-[11px] bg-white/80 rounded px-2 py-1 border border-slate-100 leading-tight">
            <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Upload: {fmtRate(last.upload)}</div>
            <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Download: {fmtRate(last.download)}</div>
          </div>
        )}
        {!cfg.enabled ? (
          <div className="h-full flex items-center justify-center text-sm text-slate-300">Graph disabled</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`up-${cfg.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id={`down-${cfg.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={fmtAxis} width={38} />
              <Tooltip
                labelFormatter={() => ''}
                formatter={(v: number, key) => [fmtRate(v), key === 'upload' ? 'Upload' : 'Download']}
                contentStyle={{ fontSize: 12 }}
              />
              <Area type="monotone" dataKey="download" stroke="#ef4444" strokeWidth={1.5} fill={`url(#down-${cfg.id})`} isAnimationActive={false} />
              <Area type="monotone" dataKey="upload" stroke="#3b82f6" strokeWidth={1.5} fill={`url(#up-${cfg.id})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

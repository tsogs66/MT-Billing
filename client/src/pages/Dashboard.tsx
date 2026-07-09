import { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Cpu, HardDrive, MemoryStick, Server, Users, WifiOff, AlertTriangle, Search } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, Progress, Stat } from '../components/ui';
import { api, peso } from '../api';
import { useRouterDevice } from '../context/RouterContext';

interface Host {
  board: string;
  cpuTemp: number;
  cpuUsage: number;
  ramPct: number;
  ramUsed?: number;
  ramTotal?: number;
  diskPct: number;
}
interface RouterStat {
  name: string;
  board: string;
  live: boolean;
  uptime: string;
  cpuLoad: number;
  memPct: number;
  memTotal: number;
  activePPPoE: number;
  offline: number;
  expired: number;
}
interface Sales {
  series: { label: string; value: number }[];
  total: number;
  transactions: number;
  avgPerDay: number;
  best: number;
  today: number;
}

const RANGES = [
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '6m', label: '6 Months' },
  { key: '1y', label: '1 Year' },
];

function bytes(n?: number) {
  if (!n) return '—';
  const g = n / 1024 ** 3;
  if (g >= 1) return `${g.toFixed(1)}G`;
  return `${(n / 1024 ** 2).toFixed(0)}M`;
}

export default function Dashboard() {
  const { current } = useRouterDevice();
  const [host, setHost] = useState<Host | null>(null);
  const [router, setRouter] = useState<RouterStat | null>(null);
  const [sales, setSales] = useState<Sales | null>(null);
  const [queues, setQueues] = useState<{ name: string; avgRate: number }[]>([]);
  const [range, setRange] = useState('7d');
  const [queueSearch, setQueueSearch] = useState('');

  useEffect(() => {
    api.get('/dashboard/host').then((r) => setHost(r.data));
    api.get('/dashboard/queues').then((r) => setQueues(r.data));
  }, []);

  useEffect(() => {
    if (current) api.get(`/dashboard/router/${current.id}`).then((r) => setRouter(r.data));
  }, [current]);

  useEffect(() => {
    api.get(`/sales?range=${range}`).then((r) => setSales(r.data));
  }, [range]);

  const maxQueue = useMemo(() => Math.max(1, ...queues.map((q) => q.avgRate)), [queues]);
  const filteredQueues = queues.filter((q) => q.name.toLowerCase().includes(queueSearch.toLowerCase()));

  return (
    <Layout title="Dashboard">
      <h2 className="text-base font-semibold text-slate-500 mb-3">System Overview</h2>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Host Panel Status */}
        <Card title="Host Panel Status">
          <div className="space-y-4">
            <Row label="Board" value={host?.board ?? '—'} />
            <Row
              label={<span className="flex items-center gap-2"><Cpu size={15} className="text-slate-400" />CPU Temp</span>}
              value={host ? `${host.cpuTemp}°C` : '—'}
            />
            <Row
              label={<span className="flex items-center gap-2"><Cpu size={15} className="text-slate-400" />CPU Usage</span>}
              value={host ? `${host.cpuUsage}%` : '—'}
            />
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="flex items-center gap-2 text-slate-600"><MemoryStick size={15} className="text-slate-400" />RAM Usage</span>
                <span className="text-slate-500">
                  {host ? `${host.ramPct}%` : '—'} {host?.ramUsed ? `(${bytes(host.ramUsed)}/${bytes(host.ramTotal)})` : ''}
                </span>
              </div>
              <Progress value={host?.ramPct ?? 0} color="bg-sky-500" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="flex items-center gap-2 text-slate-600"><HardDrive size={15} className="text-slate-400" />SD Card</span>
                <span className="text-slate-500">{host ? `${host.diskPct}%` : '—'}</span>
              </div>
              <Progress value={host?.diskPct ?? 0} color="bg-amber-500" />
            </div>
          </div>
        </Card>

        {/* Router */}
        <Card title={`Router: ${router?.name ?? current?.name ?? ''}`} right={
          <span className={`badge ${router?.live ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {router?.live ? 'live' : 'sample data'}
          </span>
        }>
          <div className="space-y-4">
            <Row label={<span className="flex items-center gap-2"><Server size={15} className="text-slate-400" />Board Name</span>} value={router?.board ?? '—'} />
            <Row label="Uptime" value={router?.uptime ?? '—'} />
            <Row label="CPU Load" value={router ? `${router.cpuLoad}%` : '—'} />
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-600">Memory</span>
                <span className="text-slate-500">{router ? `${router.memPct}% of ${router.memTotal}GB` : '—'}</span>
              </div>
              <Progress value={router?.memPct ?? 0} color="bg-emerald-500" />
            </div>
            <div className="grid grid-cols-3 gap-3 pt-2">
              <MiniStat icon={<Users size={16} />} label="Active PPPoE" value={router?.activePPPoE ?? 0} tone="text-emerald-600" />
              <MiniStat icon={<WifiOff size={16} />} label="Offline" value={router?.offline ?? 0} tone="text-amber-600" />
              <MiniStat icon={<AlertTriangle size={16} />} label="Expired" value={router?.expired ?? 0} tone="text-rose-600" />
            </div>
          </div>
        </Card>
      </div>

      {/* Sales Overview */}
      <h2 className="text-base font-semibold text-slate-500 mt-6 mb-3">Sales Overview</h2>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2" right={
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`text-xs px-2.5 py-1 rounded-md ${range === r.key ? 'bg-brand-500 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        } title="Net Revenue">
          <div className="flex items-end gap-8 mb-2">
            <div>
              <div className="text-2xl font-bold text-slate-800">{peso(sales?.total ?? 0)}</div>
              <div className="text-xs text-slate-400">Net Revenue</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-800">{sales?.transactions ?? 0}</div>
              <div className="text-xs text-slate-400">Transactions</div>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sales?.series ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => String(v).slice(5)} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} width={40} />
                <Tooltip formatter={(v: number) => peso(v)} labelStyle={{ color: '#334155' }} />
                <Area type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2} fill="url(#rev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Quick Insights">
          <div className="space-y-5">
            <Stat label="Average / day" value={peso(sales?.avgPerDay ?? 0)} />
            <Stat label="Best day" value={peso(sales?.best ?? 0)} />
            <Stat label="Today" value={peso(sales?.today ?? 0)} />
          </div>
        </Card>
      </div>

      {/* Queue Tree Ranking */}
      <div className="mt-6">
        <Card title="Queue Tree Ranking (Avg Rate)" right={
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2 text-slate-400" />
            <input
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              placeholder="Search queue name..."
              className="text-sm border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        }>
          <div className="space-y-3">
            {filteredQueues.map((q, i) => (
              <div key={q.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600">{q.name}</span>
                  <span className="text-slate-500 font-medium">
                    {q.avgRate >= 1 ? `${q.avgRate.toFixed(2)} Mbps` : `${(q.avgRate * 1000).toFixed(2)} Kbps`}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(q.avgRate / maxQueue) * 100}%`,
                      background: `linear-gradient(90deg, hsl(${210 - i * 25} 80% 55%), hsl(${350 - i * 15} 85% 60%))`,
                    }}
                  />
                </div>
              </div>
            ))}
            {filteredQueues.length === 0 && <div className="text-sm text-slate-400 py-4 text-center">No queues match your search.</div>}
          </div>
        </Card>
      </div>
    </Layout>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

function MiniStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-center">
      <div className={`flex items-center justify-center gap-1 ${tone}`}>{icon}<span className="text-lg font-bold">{value}</span></div>
      <div className="text-[11px] text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}

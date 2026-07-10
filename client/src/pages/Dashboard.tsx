import { useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Cpu, HardDrive, MemoryStick, Server, Users, WifiOff, AlertTriangle, Search,
  Activity, CircleDot, TrendingUp, Wallet, Calendar,
} from 'lucide-react';
import Layout from '../components/Layout';
import { Card, Progress, Stat, StatTile, SectionTitle, TabPills } from '../components/ui';
import { api, peso } from '../api';
import { useRouterDevice } from '../context/RouterContext';
import InterfaceTraffic from '../components/InterfaceTraffic';

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
  const [statusCounts, setStatusCounts] = useState<any>(null);
  const [range, setRange] = useState('7d');
  const [queueSearch, setQueueSearch] = useState('');

  useEffect(() => {
    api.get('/dashboard/host').then((r) => setHost(r.data));
    api.get('/dashboard/queues').then((r) => setQueues(r.data));
    const loadStatus = () => api.get('/dashboard/status').then((r) => setStatusCounts(r.data));
    loadStatus();
    const t = setInterval(loadStatus, 15000);
    return () => clearInterval(t);
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
      <SectionTitle icon={Activity}>Account Status</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <StatTile label="Online" value={statusCounts?.online ?? '—'} dot="bg-emerald-500" tone="text-emerald-600" icon={CircleDot} accent="from-emerald-500/15 to-transparent" delay={0} />
        <StatTile label="Offline" value={statusCounts?.offline ?? '—'} dot="bg-amber-500" tone="text-amber-600" icon={WifiOff} accent="from-amber-500/15 to-transparent" delay={50} />
        <StatTile label="Active" value={statusCounts?.active ?? '—'} dot="bg-sky-500" tone="text-sky-600" icon={Users} accent="from-sky-500/15 to-transparent" delay={100} />
        <StatTile label="Expired" value={statusCounts?.expired ?? '—'} dot="bg-rose-500" tone="text-rose-600" icon={AlertTriangle} accent="from-rose-500/15 to-transparent" delay={150} />
        <StatTile label="Non-payment" value={statusCounts?.nonPayment ?? '—'} dot="bg-orange-500" tone="text-orange-600" icon={Wallet} accent="from-orange-500/15 to-transparent" delay={200} />
        <StatTile label="Inactive" value={statusCounts?.inactive ?? '—'} dot="bg-slate-400" tone="text-slate-500" icon={CircleDot} accent="from-slate-500/10 to-transparent" delay={250} />
      </div>

      <SectionTitle icon={Server}>System Overview</SectionTitle>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-8">
        <Card title="Host Panel Status" icon={Cpu} interactive>
          <div className="space-y-4">
            <Row label="Board" value={host?.board ?? '—'} />
            <Row
              label={<span className="flex items-center gap-2"><Cpu size={15} className="text-brand-500" />CPU Temp</span>}
              value={host ? `${host.cpuTemp}°C` : '—'}
            />
            <Row
              label={<span className="flex items-center gap-2"><Cpu size={15} className="text-brand-500" />CPU Usage</span>}
              value={host ? `${host.cpuUsage}%` : '—'}
            />
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="flex items-center gap-2 text-slate-600 font-medium"><MemoryStick size={15} className="text-sky-500" />RAM Usage</span>
                <span className="text-slate-500">
                  {host ? `${host.ramPct}%` : '—'} {host?.ramUsed ? `(${bytes(host.ramUsed)}/${bytes(host.ramTotal)})` : ''}
                </span>
              </div>
              <Progress value={host?.ramPct ?? 0} color="bg-gradient-to-r from-sky-400 to-sky-500" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="flex items-center gap-2 text-slate-600 font-medium"><HardDrive size={15} className="text-amber-500" />SD Card</span>
                <span className="text-slate-500">{host ? `${host.diskPct}%` : '—'}</span>
              </div>
              <Progress value={host?.diskPct ?? 0} color="bg-gradient-to-r from-amber-400 to-amber-500" />
            </div>
          </div>
        </Card>

        <Card
          title={`Router: ${router?.name ?? current?.name ?? ''}`}
          icon={Server}
          interactive
          right={
            <span className={`badge ${router?.live ? 'bg-emerald-100 text-emerald-700 ring-emerald-200/60' : 'bg-slate-100 text-slate-500'}`}>
              {router?.live ? '● live' : 'sample data'}
            </span>
          }
        >
          <div className="space-y-4">
            <Row label={<span className="flex items-center gap-2"><Server size={15} className="text-brand-500" />Board Name</span>} value={router?.board ?? '—'} />
            <Row label="Uptime" value={router?.uptime ?? '—'} />
            <Row label="CPU Load" value={router ? `${router.cpuLoad}%` : '—'} />
            <div>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="text-slate-600 font-medium">Memory</span>
                <span className="text-slate-500">{router ? `${router.memPct}% of ${router.memTotal}GB` : '—'}</span>
              </div>
              <Progress value={router?.memPct ?? 0} color="bg-gradient-to-r from-emerald-400 to-emerald-500" />
            </div>
            <div className="grid grid-cols-3 gap-3 pt-2">
              <MiniStat icon={<Users size={16} />} label="Active PPPoE" value={router?.activePPPoE ?? 0} tone="text-emerald-600" bg="bg-emerald-50 border-emerald-100" />
              <MiniStat icon={<WifiOff size={16} />} label="Offline" value={router?.offline ?? 0} tone="text-amber-600" bg="bg-amber-50 border-amber-100" />
              <MiniStat icon={<AlertTriangle size={16} />} label="Expired" value={router?.expired ?? 0} tone="text-rose-600" bg="bg-rose-50 border-rose-100" />
            </div>
          </div>
        </Card>
      </div>

      <SectionTitle icon={TrendingUp}>Sales Overview</SectionTitle>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-2" title="Net Revenue" icon={Wallet} interactive right={
          <TabPills tabs={RANGES} active={range} onChange={setRange} />
        }>
          <div className="flex flex-wrap items-end gap-8 mb-4">
            <div>
              <div className="text-3xl font-bold text-slate-900 tracking-tight">{peso(sales?.total ?? 0)}</div>
              <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mt-1">Net Revenue</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-slate-900 tracking-tight">{sales?.transactions ?? 0}</div>
              <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mt-1">Transactions</div>
            </div>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sales?.series ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => String(v).slice(5)} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} width={40} />
                <Tooltip formatter={(v: number) => peso(v)} labelStyle={{ color: '#334155' }} contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }} />
                <Area type="monotone" dataKey="value" stroke="#f97316" strokeWidth={2.5} fill="url(#rev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Quick Insights" icon={Calendar} interactive>
          <div className="space-y-6">
            <Stat label="Average / day" value={peso(sales?.avgPerDay ?? 0)} icon={TrendingUp} />
            <Stat label="Best day" value={peso(sales?.best ?? 0)} icon={Wallet} />
            <Stat label="Today" value={peso(sales?.today ?? 0)} icon={Calendar} />
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <Card title="Queue Tree Ranking (Avg Rate)" interactive right={
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              placeholder="Search queue name..."
              className="text-sm border border-slate-200 rounded-xl pl-9 pr-3 py-2 w-56 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400 bg-white/80"
            />
          </div>
        }>
          <div className="space-y-3">
            {filteredQueues.map((q, i) => (
              <div key={q.name}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-slate-600 font-medium">{q.name}</span>
                  <span className="text-slate-500 font-semibold">
                    {q.avgRate >= 1 ? `${q.avgRate.toFixed(2)} Mbps` : `${(q.avgRate * 1000).toFixed(2)} Kbps`}
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(q.avgRate / maxQueue) * 100}%`,
                      background: `linear-gradient(90deg, hsl(${25 + i * 8} 90% 55%), hsl(${15 + i * 5} 85% 50%))`,
                    }}
                  />
                </div>
              </div>
            ))}
            {filteredQueues.length === 0 && <div className="text-sm text-slate-400 py-6 text-center">No queues match your search.</div>}
          </div>
        </Card>
      </div>

      <InterfaceTraffic />
    </Layout>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm py-0.5">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function MiniStat({ icon, label, value, tone, bg }: { icon: React.ReactNode; label: string; value: number; tone: string; bg: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-center ${bg} transition-transform hover:scale-[1.02]`}>
      <div className={`flex items-center justify-center gap-1 ${tone}`}>{icon}<span className="text-lg font-bold">{value}</span></div>
      <div className="text-[11px] text-slate-500 mt-0.5 font-medium">{label}</div>
    </div>
  );
}

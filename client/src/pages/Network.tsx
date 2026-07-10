import { useEffect, useState } from 'react';
import { Share2, Shield, Route, Bot } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge } from '../components/ui';
import { api } from '../api';

const TABS = [
  ['wan', 'WAN & Failover', Share2],
  ['firewall', 'Firewall', Shield],
  ['routes', 'Routes & VLANs', Route],
  ['multiwan', 'AI Multi-WAN', Bot],
] as const;

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className={`relative w-10 h-5 rounded-full transition-colors ${on ? 'bg-brand-500' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  );
}

export default function Network() {
  const [tab, setTab] = useState('wan');
  return (
    <Layout title="Network Management">
      <div className="flex items-center gap-1 border-b border-slate-200 mb-5 overflow-x-auto">
        {TABS.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm border-b-2 whitespace-nowrap ${tab === key ? 'border-brand-500 text-brand-600 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'wan' && <WanFailover Toggle={Toggle} />}
      {tab === 'firewall' && <Firewall />}
      {tab === 'routes' && <RoutesVlans />}
      {tab === 'multiwan' && <MultiWan />}
    </Layout>
  );
}

function WanFailover({ Toggle: T }: { Toggle: typeof Toggle }) {
  const [routes, setRoutes] = useState<any[]>([]);
  const load = () => api.get('/network/wan').then((r) => setRoutes(r.data));
  useEffect(() => {
    load();
  }, []);

  const allEnabled = routes.length > 0 && routes.every((r) => r.enabled);
  const toggleOne = async (id: number) => {
    await api.post(`/network/wan/${id}/toggle`);
    load();
  };
  const toggleAll = async () => {
    await api.post('/network/wan/toggle-all', { enabled: !allEnabled });
    load();
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-800">Master Failover Switch</div>
            <div className="text-sm text-slate-400">Enable or disable all WAN routes that have 'check-gateway' configured.</div>
          </div>
          <button
            onClick={toggleAll}
            className={`text-white text-sm font-medium px-4 py-2 rounded-lg ${allEnabled ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
          >
            {allEnabled ? 'Disable All' : 'Enable All'}
          </button>
        </div>
      </Card>

      <Card title="Monitored WAN Routes">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-400 text-left border-b border-slate-100">
              <th className="py-2 font-medium">Gateway</th>
              <th className="py-2 font-medium">Check Method</th>
              <th className="py-2 font-medium">Distance</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium text-right">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.id} className="border-b border-slate-50">
                <td className="py-2.5 text-sky-600 font-medium">{r.gateway}</td>
                <td className="py-2.5 text-slate-600">{r.checkMethod}</td>
                <td className="py-2.5 text-slate-600">{r.distance}</td>
                <td className="py-2.5"><StatusBadge status={r.enabled ? 'Active' : 'disabled'} /></td>
                <td className="py-2.5">
                  <div className="flex justify-end"><T on={!!r.enabled} onChange={() => toggleOne(r.id)} /></div>
                </td>
              </tr>
            ))}
            {routes.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">No monitored WAN routes.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Firewall() {
  const [rules, setRules] = useState<any[]>([]);
  useEffect(() => {
    api.get('/network/firewall').then((r) => setRules(r.data));
  }, []);
  return (
    <Card title="Firewall Rules" className="max-w-4xl">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-400 text-left border-b border-slate-100">
            <th className="py-2 font-medium">Chain</th>
            <th className="py-2 font-medium">Action</th>
            <th className="py-2 font-medium">Protocol</th>
            <th className="py-2 font-medium">Dst Port</th>
            <th className="py-2 font-medium">Comment</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r, i) => (
            <tr key={i} className="border-b border-slate-50">
              <td className="py-2 text-slate-600">{r.chain}</td>
              <td className="py-2 font-medium text-slate-800">{r.action}</td>
              <td className="py-2 text-slate-600">{r.proto}</td>
              <td className="py-2 text-slate-600">{r.dstPort}</td>
              <td className="py-2 text-slate-500">{r.comment}</td>
              <td className="py-2"><StatusBadge status={r.enabled ? 'Active' : 'disabled'} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function RoutesVlans() {
  const [data, setData] = useState<{ routes: any[]; vlans: any[] }>({ routes: [], vlans: [] });
  useEffect(() => {
    api.get('/network/routes').then((r) => setData(r.data));
  }, []);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 max-w-5xl">
      <Card title="Routing Table">
        <table className="w-full text-sm">
          <thead><tr className="text-slate-400 text-left border-b border-slate-100"><th className="py-2 font-medium">Destination</th><th className="py-2 font-medium">Gateway</th><th className="py-2 font-medium">Distance</th><th className="py-2 font-medium">Active</th></tr></thead>
          <tbody>
            {data.routes.map((r, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="py-2 font-mono text-slate-700">{r.dst}</td>
                <td className="py-2 text-slate-600">{r.gateway}</td>
                <td className="py-2 text-slate-600">{r.distance}</td>
                <td className="py-2"><StatusBadge status={r.active ? 'Active' : 'disabled'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="VLANs">
        <table className="w-full text-sm">
          <thead><tr className="text-slate-400 text-left border-b border-slate-100"><th className="py-2 font-medium">Name</th><th className="py-2 font-medium">VLAN ID</th><th className="py-2 font-medium">Interface</th><th className="py-2 font-medium">Comment</th></tr></thead>
          <tbody>
            {data.vlans.map((v, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="py-2 font-medium text-slate-800">{v.name}</td>
                <td className="py-2 text-slate-600">{v.vlanId}</td>
                <td className="py-2 text-slate-600">{v.iface}</td>
                <td className="py-2 text-slate-500">{v.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function MultiWan() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api.get('/network/multiwan').then((r) => setData(r.data));
  }, []);
  if (!data) return <div className="text-slate-400">Loading…</div>;
  return (
    <Card title="AI Multi-WAN" className="max-w-4xl" right={<StatusBadge status={data.enabled ? 'Active' : 'disabled'} />}>
      <div className="text-sm text-slate-500 mb-4 flex items-center gap-2"><Bot size={16} className="text-brand-500" /> Strategy: <span className="font-medium text-slate-700">{data.strategy}</span></div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-400 text-left border-b border-slate-100">
            <th className="py-2 font-medium">Link</th>
            <th className="py-2 font-medium">Role</th>
            <th className="py-2 font-medium text-right">Weight</th>
            <th className="py-2 font-medium text-right">Latency</th>
            <th className="py-2 font-medium text-right">Loss</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.links.map((l: any, i: number) => (
            <tr key={i} className="border-b border-slate-50">
              <td className="py-2 font-medium text-slate-800">{l.name}</td>
              <td className="py-2 text-slate-600 capitalize">{l.role}</td>
              <td className="py-2 text-right text-slate-600">{l.weight}%</td>
              <td className="py-2 text-right text-slate-600">{l.latencyMs} ms</td>
              <td className="py-2 text-right text-slate-600">{l.loss}%</td>
              <td className="py-2"><StatusBadge status={l.status === 'up' ? 'online' : l.status === 'standby' ? 'offline' : 'disabled'} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

import { useEffect, useState } from 'react';
import { Share2, Shield, Route, Bot } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge, TabBar, DataTable, Toggle } from '../components/ui';
import { api } from '../api';

const TABS = [
  { key: 'wan', label: 'WAN & Failover', icon: Share2 },
  { key: 'firewall', label: 'Firewall', icon: Shield },
  { key: 'routes', label: 'Routes & VLANs', icon: Route },
  { key: 'multiwan', label: 'AI Multi-WAN', icon: Bot },
] as const;

export default function Network() {
  const [tab, setTab] = useState('wan');
  return (
    <Layout title="Network Management">
      <TabBar tabs={[...TABS]} active={tab} onChange={setTab} className="mb-5" />

      {tab === 'wan' && <WanFailover />}
      {tab === 'firewall' && <Firewall />}
      {tab === 'routes' && <RoutesVlans />}
      {tab === 'multiwan' && <MultiWan />}
    </Layout>
  );
}

function WanFailover() {
  const [routes, setRoutes] = useState<any[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const load = () =>
    api.get('/network/wan').then((r) => {
      setRoutes(r.data.routes || []);
      setLive(!!r.data.live);
      setError('');
    }).catch((e) => setError(e?.response?.data?.error || 'Could not load WAN routes'));
  useEffect(() => {
    load();
  }, []);

  const allEnabled = routes.length > 0 && routes.every((r) => r.enabled);
  const toggleOne = async (id: number) => {
    try {
      await api.post(`/network/wan/${id}/toggle`);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not toggle route on MikroTik');
    }
  };
  const toggleAll = async () => {
    try {
      const r = await api.post('/network/wan/toggle-all', { enabled: !allEnabled });
      if (r.data.errors?.length) setError(`Some routes failed: ${r.data.errors.join('; ')}`);
      else setError('');
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not toggle routes on MikroTik');
    }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
      {!live && routes.length === 0 && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No live WAN routes available. Add a reachable MikroTik router with API credentials — routes with check-gateway appear here when the router is online.
        </div>
      )}
      {routes.length > 0 && (
      <Card interactive>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-800">Master Failover Switch</div>
            <div className="text-sm text-slate-400">Enable or disable all monitored WAN routes on each MikroTik router (RouterOS /ip/route).</div>
          </div>
          <button
            onClick={toggleAll}
            className={`text-white text-sm font-medium px-4 py-2 rounded-lg ${allEnabled ? 'bg-rose-500 hover:bg-rose-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
          >
            {allEnabled ? 'Disable All' : 'Enable All'}
          </button>
        </div>
      </Card>
      )}

      <Card title="Monitored WAN Routes" noPadding>
        <DataTable
          columns={[
            { key: 'router', label: 'Router' },
            { key: 'gateway', label: 'Gateway' },
            { key: 'iface', label: 'Interface' },
            { key: 'checkMethod', label: 'Check Method' },
            { key: 'distance', label: 'Distance' },
            { key: 'status', label: 'Status' },
            { key: 'enabled', label: 'Enabled', align: 'right' },
          ]}
          rows={routes.map((r) => ({
            key: r.id,
            cells: [
              <span className="text-slate-600 text-sm">{r.routerName || '—'}</span>,
              <span className="text-sky-600 font-medium">{r.gateway}</span>,
              <span className="font-mono text-xs text-slate-500">{r.interfaceName || '—'}</span>,
              r.checkMethod,
              r.distance,
              <StatusBadge status={r.enabled ? 'Active' : 'disabled'} />,
              <div className="flex justify-end">
                <Toggle on={!!r.enabled} onChange={() => toggleOne(r.id)} label={`Toggle ${r.gateway}`} />
              </div>,
            ],
          }))}
          emptyMessage={live ? 'No monitored WAN routes on connected routers.' : 'WAN routes appear when a MikroTik router is reachable.'}
        />
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
    <Card title="Firewall Rules" className="max-w-4xl" noPadding>
      <DataTable
        columns={[
          { key: 'chain', label: 'Chain' },
          { key: 'action', label: 'Action' },
          { key: 'proto', label: 'Protocol' },
          { key: 'dstPort', label: 'Dst Port' },
          { key: 'comment', label: 'Comment' },
          { key: 'status', label: 'Status' },
        ]}
        rows={rules.map((r, i) => ({
          key: i,
          cells: [
            r.chain,
            <span className="font-medium text-slate-800">{r.action}</span>,
            r.proto,
            r.dstPort,
            <span className="text-slate-500">{r.comment}</span>,
            <StatusBadge status={r.enabled ? 'Active' : 'disabled'} />,
          ],
        }))}
        emptyMessage="No firewall rules found."
      />
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
      <Card title="Routing Table" noPadding>
        <DataTable
          columns={[
            { key: 'dst', label: 'Destination' },
            { key: 'gateway', label: 'Gateway' },
            { key: 'distance', label: 'Distance' },
            { key: 'active', label: 'Active' },
          ]}
          rows={data.routes.map((r, i) => ({
            key: i,
            cells: [
              <span className="font-mono text-slate-700">{r.dst}</span>,
              r.gateway,
              r.distance,
              <StatusBadge status={r.active ? 'Active' : 'disabled'} />,
            ],
          }))}
          emptyMessage="No routes found."
        />
      </Card>
      <Card title="VLANs" noPadding>
        <DataTable
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'vlanId', label: 'VLAN ID' },
            { key: 'iface', label: 'Interface' },
            { key: 'comment', label: 'Comment' },
          ]}
          rows={data.vlans.map((v, i) => ({
            key: i,
            cells: [
              <span className="font-medium text-slate-800">{v.name}</span>,
              v.vlanId,
              v.iface,
              <span className="text-slate-500">{v.comment}</span>,
            ],
          }))}
          emptyMessage="No VLANs found."
        />
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
    <Card title="AI Multi-WAN" className="max-w-4xl" interactive right={<StatusBadge status={data.enabled ? 'Active' : 'disabled'} />} noPadding>
      <div className="px-5 pt-5 pb-4 text-sm text-slate-500 flex items-center gap-2">
        <Bot size={16} className="text-brand-500" /> Strategy: <span className="font-medium text-slate-700">{data.strategy}</span>
      </div>
      <DataTable
        columns={[
          { key: 'name', label: 'Link' },
          { key: 'role', label: 'Role' },
          { key: 'weight', label: 'Weight', align: 'right' },
          { key: 'latency', label: 'Latency', align: 'right' },
          { key: 'loss', label: 'Loss', align: 'right' },
          { key: 'status', label: 'Status' },
        ]}
        rows={data.links.map((l: any, i: number) => ({
          key: i,
          cells: [
            <span className="font-medium text-slate-800">{l.name}</span>,
            <span className="capitalize">{l.role}</span>,
            `${l.weight}%`,
            `${l.latencyMs} ms`,
            `${l.loss}%`,
            <StatusBadge status={l.status === 'up' ? 'online' : l.status === 'standby' ? 'offline' : 'disabled'} />,
          ],
        }))}
        emptyMessage="No WAN links configured."
      />
    </Card>
  );
}

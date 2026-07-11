import { useEffect, useState } from 'react';
import { Share2, Shield, Route, Bot, RefreshCw } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge, TabBar, DataTable, Toggle } from '../components/ui';
import { api } from '../api';
import { useRouterDevice } from '../context/RouterContext';

const TABS = [
  { key: 'wan', label: 'WAN & Failover', icon: Share2 },
  { key: 'firewall', label: 'Firewall', icon: Shield },
  { key: 'routes', label: 'Routes & VLANs', icon: Route },
  { key: 'multiwan', label: 'Multi-WAN', icon: Bot },
] as const;

export default function Network() {
  const [tab, setTab] = useState('wan');
  const { current } = useRouterDevice();

  return (
    <Layout title="Network Management">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <TabBar tabs={[...TABS]} active={tab} onChange={setTab} />
        <span className="text-xs text-slate-500">
          {current ? (
            <>
              Live from <span className="font-semibold text-slate-700">{current.name}</span>
              {current.host ? <span className="text-slate-400"> ({current.host})</span> : null}
            </>
          ) : (
            'Select a router in the top bar'
          )}
        </span>
      </div>

      {!current ? (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-4xl">
          Select a MikroTik router in the top bar to load WAN, firewall, routes, and multi-WAN details from that device.
        </div>
      ) : (
        <>
          {tab === 'wan' && <WanFailover routerId={current.id} routerName={current.name} />}
          {tab === 'firewall' && <Firewall routerId={current.id} />}
          {tab === 'routes' && <RoutesVlans routerId={current.id} />}
          {tab === 'multiwan' && <MultiWan routerId={current.id} />}
        </>
      )}
    </Layout>
  );
}

function WanFailover({ routerId, routerName }: { routerId: number; routerName: string }) {
  const [routes, setRoutes] = useState<any[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    return api
      .get('/network/wan', { params: { routerId } })
      .then((r) => {
        setRoutes(r.data.routes || []);
        setLive(!!r.data.live);
        setError(r.data.error || '');
      })
      .catch((e) => {
        setRoutes([]);
        setLive(false);
        setError(e?.response?.data?.error || 'Could not load WAN routes from MikroTik');
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerId]);

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
      const r = await api.post('/network/wan/toggle-all', { enabled: !allEnabled, routerId });
      if (r.data.errors?.length) setError(`Some routes failed: ${r.data.errors.join('; ')}`);
      else setError('');
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not toggle routes on MikroTik');
    }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex justify-end">
        <button type="button" className="btn-secondary text-sm" onClick={load} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
      {!live && routes.length === 0 && !error && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No monitored WAN routes on <b>{routerName}</b>. Default routes and routes with check-gateway appear here when the router is reachable.
        </div>
      )}
      {routes.length > 0 && (
        <Card interactive>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-slate-800">Master Failover Switch</div>
              <div className="text-sm text-slate-400">
                Enable or disable monitored WAN routes on {routerName} (RouterOS /ip/route).
              </div>
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
          emptyMessage={live ? 'No monitored WAN routes on this router.' : 'WAN routes appear when the selected MikroTik is reachable.'}
        />
      </Card>
    </div>
  );
}

function Firewall({ routerId }: { routerId: number }) {
  const [rules, setRules] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);

  const load = () => {
    setBusy(true);
    return api
      .get('/network/firewall', { params: { routerId } })
      .then((r) => {
        setRules(r.data.rules || []);
        setLive(!!r.data.live);
        setError(r.data.error || '');
      })
      .catch((e) => {
        setRules([]);
        setLive(false);
        setError(e?.response?.data?.error || 'Could not load firewall from MikroTik');
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerId]);

  return (
    <div className="space-y-3 max-w-5xl">
      <div className="flex justify-end">
        <button type="button" className="btn-secondary text-sm" onClick={load} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
      <Card title="Firewall Rules" noPadding>
        <DataTable
          columns={[
            { key: 'table', label: 'Table' },
            { key: 'chain', label: 'Chain' },
            { key: 'action', label: 'Action' },
            { key: 'proto', label: 'Protocol' },
            { key: 'dstPort', label: 'Dst Port' },
            { key: 'comment', label: 'Comment' },
            { key: 'status', label: 'Status' },
          ]}
          rows={rules.map((r, i) => ({
            key: r.id || i,
            cells: [
              <span className="uppercase text-[11px] font-semibold text-slate-500">{r.table}</span>,
              r.chain,
              <span className="font-medium text-slate-800">{r.action}</span>,
              r.proto,
              r.dstPort,
              <span className="text-slate-500">{r.comment || '—'}</span>,
              <StatusBadge status={r.enabled ? 'Active' : 'disabled'} />,
            ],
          }))}
          emptyMessage={live ? 'No firewall filter/NAT rules on this router.' : 'Firewall rules load from the selected MikroTik.'}
        />
      </Card>
    </div>
  );
}

function RoutesVlans({ routerId }: { routerId: number }) {
  const [data, setData] = useState<{ routes: any[]; vlans: any[] }>({ routes: [], vlans: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);

  const load = () => {
    setBusy(true);
    return api
      .get('/network/routes', { params: { routerId } })
      .then((r) => {
        setData({ routes: r.data.routes || [], vlans: r.data.vlans || [] });
        setLive(!!r.data.live);
        setError(r.data.error || '');
      })
      .catch((e) => {
        setData({ routes: [], vlans: [] });
        setLive(false);
        setError(e?.response?.data?.error || 'Could not load routes/VLANs from MikroTik');
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerId]);

  return (
    <div className="space-y-3 max-w-5xl">
      <div className="flex justify-end">
        <button type="button" className="btn-secondary text-sm" onClick={load} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card title="Routing Table" noPadding>
          <DataTable
            columns={[
              { key: 'dst', label: 'Destination' },
              { key: 'gateway', label: 'Gateway' },
              { key: 'distance', label: 'Distance' },
              { key: 'active', label: 'Active' },
            ]}
            rows={data.routes.map((r, i) => ({
              key: r.id || i,
              cells: [
                <span className="font-mono text-slate-700">{r.dst}</span>,
                <span className="text-sm">{r.gateway}</span>,
                r.distance,
                <StatusBadge status={r.active ? 'Active' : r.enabled ? 'offline' : 'disabled'} />,
              ],
            }))}
            emptyMessage={live ? 'No routes on this router.' : 'Routes load from the selected MikroTik.'}
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
              key: v.id || i,
              cells: [
                <span className="font-medium text-slate-800">{v.name}</span>,
                v.vlanId,
                v.iface,
                <span className="text-slate-500">{v.comment || '—'}</span>,
              ],
            }))}
            emptyMessage={live ? 'No VLAN interfaces on this router.' : 'VLANs load from the selected MikroTik.'}
          />
        </Card>
      </div>
    </div>
  );
}

function MultiWan({ routerId }: { routerId: number }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    return api
      .get('/network/multiwan', { params: { routerId } })
      .then((r) => {
        setData(r.data);
        setError(r.data.error || '');
      })
      .catch((e) => {
        setData({ enabled: false, strategy: '', links: [], live: false });
        setError(e?.response?.data?.error || 'Could not load multi-WAN from MikroTik');
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routerId]);

  if (!data) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-3 max-w-4xl">
      <div className="flex justify-end">
        <button type="button" className="btn-secondary text-sm" onClick={load} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
      <Card
        title="Multi-WAN"
        interactive
        right={<StatusBadge status={data.enabled ? 'Active' : 'disabled'} />}
        noPadding
      >
        <div className="px-5 pt-5 pb-4 text-sm text-slate-500 flex items-center gap-2">
          <Bot size={16} className="text-brand-500" /> Strategy:{' '}
          <span className="font-medium text-slate-700">{data.strategy || '—'}</span>
        </div>
        <DataTable
          columns={[
            { key: 'name', label: 'Link' },
            { key: 'gateway', label: 'Gateway' },
            { key: 'role', label: 'Role' },
            { key: 'weight', label: 'Weight', align: 'right' },
            { key: 'distance', label: 'Distance', align: 'right' },
            { key: 'check', label: 'Check' },
            { key: 'status', label: 'Status' },
          ]}
          rows={(data.links || []).map((l: any, i: number) => ({
            key: i,
            cells: [
              <span className="font-medium text-slate-800">{l.name}</span>,
              <span className="font-mono text-xs text-slate-500">{l.gateway}</span>,
              <span className="capitalize">{l.role}</span>,
              `${l.weight}%`,
              l.distance,
              l.checkMethod || '—',
              <StatusBadge status={l.status === 'up' ? 'online' : l.status === 'standby' ? 'offline' : 'disabled'} />,
            ],
          }))}
          emptyMessage="No WAN / check-gateway routes on this router."
        />
      </Card>
    </div>
  );
}

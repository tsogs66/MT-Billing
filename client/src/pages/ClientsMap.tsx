import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip as LTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Link } from 'react-router-dom';
import { Search, SlidersHorizontal, Maximize2, Plus, Pencil, Trash2, Server } from 'lucide-react';
import Layout from '../components/Layout';
import { Modal, ModalFooter, FormField, StatusBadge } from '../components/ui';
import { api } from '../api';
import { useRouterDevice } from '../context/RouterContext';

interface ServerNode { id: number; name: string; host?: string; status: string; lat: number; lng: number }
interface Nap { id: number; name: string; kind: string; lat: number; lng: number; ports: number; parentId: number | null }
interface Client {
  id: number; username: string; customer: string; status: string; online: boolean;
  lat: number; lng: number; napId: number; routerId?: number; service: string; address?: string;
  account?: string; plan?: string; due?: string; napName?: string; oltName?: string;
  serverName?: string; upstreamPort?: number; plcPort?: number;
  rxBps?: number; txBps?: number; rxGB?: number; txGB?: number; topology?: string;
}

type ClientState = 'online' | 'offline' | 'disabled';

function fmtRate(bps?: number): string {
  const v = bps || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} Mbps`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)} Kbps`;
  return `${Math.round(v)} bps`;
}
function fmtGB(gb?: number): string {
  const v = gb || 0;
  return `${v >= 100 ? v.toFixed(1) : v.toFixed(2)} GB`;
}

function clientState(c: Client): ClientState {
  const s = (c.status || '').toLowerCase();
  if (['disabled', 'inactive', 'expired', 'non-payment'].includes(s)) return 'disabled';
  if (c.online && c.status === 'Active') return 'online';
  return 'offline';
}

const CLIENT_COLORS: Record<ClientState, { fill: string; glow: string }> = {
  online: { fill: '#22c55e', glow: 'rgba(34,197,94,0.55)' },
  offline: { fill: '#f97316', glow: 'rgba(249,115,22,0.45)' },
  disabled: { fill: '#ef4444', glow: 'rgba(239,68,68,0.35)' },
};

function serverIcon(name: string) {
  const label = name.slice(0, 2).toUpperCase();
  return L.divIcon({
    className: 'nap-marker',
    html: `<div class="nap-pin server">${label}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function napIcon(name: string, kind: string) {
  const isOlt = kind === 'olt';
  const label = isOlt ? 'OLT' : 'N';
  return L.divIcon({
    className: 'nap-marker',
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      <div class="nap-pin ${isOlt ? 'olt' : ''}">${label}</div>
      <div style="margin-top:2px;background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:600;color:#334155;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.12)">${name}</div>
    </div>`,
    iconSize: [48, 44],
    iconAnchor: [24, 22],
  });
}

function onuIcon(state: ClientState) {
  const { fill, glow } = CLIENT_COLORS[state];
  return L.divIcon({
    className: 'onu-marker',
    html: `<span class="onu-dot ${state}" style="--onu-color:${fill};--onu-glow:${glow}"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [50, 50] });
      fitted.current = true;
    }
  }, [map, points]);
  return null;
}

const emptyNap = (): Partial<Nap> => ({
  name: '',
  kind: 'nap',
  lat: 15.1785,
  lng: 120.5945,
  ports: 8,
  parentId: null,
});

export default function ClientsMap() {
  const { current } = useRouterDevice();
  const [servers, setServers] = useState<ServerNode[]>([]);
  const [naps, setNaps] = useState<Nap[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stats, setStats] = useState<any>({});
  const [search, setSearch] = useState('');
  const [topoOpen, setTopoOpen] = useState(false);
  const [editNap, setEditNap] = useState<Partial<Nap> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    const q = current?.id ? `?routerId=${current.id}` : '';
    return api.get(`/map${q}`).then((r) => {
      setServers(r.data.servers || []);
      setNaps(r.data.naps);
      setClients(r.data.clients);
      setStats(r.data.stats);
    });
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [current?.id]);

  const olt = useMemo(() => naps.find((n) => n.kind === 'olt'), [naps]);
  const olts = useMemo(() => naps.filter((n) => n.kind === 'olt'), [naps]);
  const napNodes = useMemo(() => naps.filter((n) => n.kind === 'nap'), [naps]);
  const napsById = useMemo(() => Object.fromEntries(naps.map((n) => [n.id, n])), [naps]);

  const center: [number, number] = olt ? [olt.lat, olt.lng] : servers[0] ? [servers[0].lat, servers[0].lng] : [15.1785, 120.5945];

  const q = search.trim().toLowerCase();
  const filteredClients = clients.filter((c) => {
    if (!q) return true;
    return (
      c.username.toLowerCase().includes(q) ||
      (c.customer || '').toLowerCase().includes(q) ||
      (c.account || '').toLowerCase().includes(q) ||
      (c.address || '').toLowerCase().includes(q)
    );
  });

  const allPoints: [number, number][] = useMemo(
    () => [
      ...servers.map((s) => [s.lat, s.lng] as [number, number]),
      ...naps.map((n) => [n.lat, n.lng] as [number, number]),
      ...clients.map((c) => [c.lat, c.lng] as [number, number]),
    ],
    [servers, naps, clients]
  );

  const enterFullscreen = () => {
    const el = document.getElementById('map-wrap');
    if (el?.requestFullscreen) el.requestFullscreen();
  };

  const saveNap = async () => {
    if (!editNap?.name?.trim()) return;
    setBusy(true);
    try {
      if (editNap.id) await api.put(`/naps/${editNap.id}`, editNap);
      else await api.post('/naps', editNap);
      setEditNap(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const deleteNap = async (id: number) => {
    if (!confirm('Delete this topology node?')) return;
    try {
      await api.delete(`/naps/${id}`);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Could not delete');
    }
  };

  const lineClass = (active: boolean, backbone = false) =>
    active ? (backbone ? 'flow-line-backbone' : 'flow-line-active') : '';

  return (
    <Layout title="Clients Map">
      <div className="card p-3 mb-3 flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-slate-500 flex items-center gap-4 flex-wrap">
          <span>Servers: <b className="text-slate-700">{stats.servers ?? '—'}</b></span>
          <span>OLTs: <b className="text-slate-700">{stats.olts ?? '—'}</b></span>
          <span>NAPs: <b className="text-slate-700">{stats.naps ?? '—'}</b></span>
          <span>Clients with location: <b className="text-slate-700">{(stats.totalClients ?? 0) - (stats.withoutLocation || 0)}</b>
            <span className="text-slate-400"> ({stats.withoutLocation ?? 0} not shown)</span>
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className={`inline-flex items-center gap-2 text-sm border rounded-lg px-3 py-1.5 ${topoOpen ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 hover:bg-slate-50 text-slate-600'}`}
            onClick={() => setTopoOpen((v) => !v)}
          >
            <SlidersHorizontal size={15} /> Topology Config
          </button>
          <div className="relative">
            <Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, username, account#, address..."
              className="text-sm border border-slate-200 rounded-lg pl-8 pr-3 py-2 w-72 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-500 mb-3 flex items-center gap-3 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block animate-pulse" /> Online</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" /> Offline</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> Disabled</span>
        <span className="text-slate-400">· Lines show Server → OLT → NAP → Client (pulse = active link)</span>
        {current && <span className="text-slate-400">· Filtered to router: <b className="text-slate-600">{current.name}</b></span>}
      </div>

      {topoOpen && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <TopoPanel
            title="Server Configuration"
            action={<Link to="/routers" className="text-xs text-brand-600 hover:underline">Manage routers →</Link>}
          >
            {servers.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No servers (routers) added yet.</p>
            ) : (
              servers.map((s) => (
                <TopoRow key={s.id} name={s.name} sub={s.host || '—'} right={<StatusBadge status={s.status === 'online' ? 'online' : 'offline'} />} />
              ))
            )}
          </TopoPanel>

          <TopoPanel
            title="OLT Configuration"
            action={
              <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setEditNap({ ...emptyNap(), kind: 'olt' })}>
                <Plus size={12} className="inline" /> New OLT
              </button>
            }
          >
            {olts.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No OLT configured.</p>
            ) : (
              olts.map((o) => (
                <TopoRow
                  key={o.id}
                  name={o.name}
                  sub={`${o.ports} PONs`}
                  right={
                    <div className="flex gap-2">
                      <button type="button" className="text-xs text-sky-600" onClick={() => setEditNap({ ...o })}>Edit</button>
                      <button type="button" className="text-xs text-rose-600" onClick={() => deleteNap(o.id)}>Delete</button>
                    </div>
                  }
                />
              ))
            )}
          </TopoPanel>

          <TopoPanel
            title="NAP Configuration"
            action={
              <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setEditNap({ ...emptyNap(), parentId: olt?.id || null })}>
                <Plus size={12} className="inline" /> New NAP
              </button>
            }
          >
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {napNodes.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">No NAPs configured.</p>
              ) : (
                napNodes.map((n) => {
                  const parent = n.parentId ? napsById[n.parentId] : null;
                  return (
                    <TopoRow
                      key={n.id}
                      name={n.name}
                      sub={parent ? `From: ${parent.name}` : 'No parent OLT'}
                      right={
                        <div className="flex gap-2">
                          <button type="button" className="text-xs text-sky-600" onClick={() => setEditNap({ ...n })}>Edit</button>
                          <button type="button" className="text-xs text-rose-600" onClick={() => deleteNap(n.id)}>Delete</button>
                        </div>
                      }
                    />
                  );
                })
              )}
            </div>
          </TopoPanel>
        </div>
      )}

      <div id="map-wrap" className="card overflow-hidden relative" style={{ height: topoOpen ? '58vh' : '70vh' }}>
        <button
          onClick={enterFullscreen}
          className="absolute top-3 right-3 z-[500] bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2 shadow-sm"
        >
          <Maximize2 size={14} /> Fullscreen
        </button>
        <MapContainer center={center} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitBounds points={allPoints} />

          {/* Server → OLT backbone */}
          {servers.map((srv) => {
            if (!olt) return null;
            return (
              <Polyline
                key={`s-olt-${srv.id}`}
                positions={[[srv.lat, srv.lng], [olt.lat, olt.lng]]}
                pathOptions={{ color: '#0d9488', weight: 2.5, opacity: 0.75, className: lineClass(true, true) }}
              />
            );
          })}

          {/* OLT → NAP */}
          {olt &&
            napNodes.map((n) => (
              <Polyline
                key={`olt-nap-${n.id}`}
                positions={[[olt.lat, olt.lng], [n.lat, n.lng]]}
                pathOptions={{ color: '#2563eb', weight: 2, opacity: 0.8, className: lineClass(true, true) }}
              />
            ))}

          {/* NAP → client at stored coordinates */}
          {filteredClients.map((c) => {
            const nap = c.napId ? napsById[c.napId] : null;
            if (!nap) return null;
            const state = clientState(c);
            const active = state === 'online';
            const lineColor = state === 'online' ? '#22c55e' : state === 'offline' ? '#f97316' : '#f87171';
            return (
              <Polyline
                key={`cl-${c.id}`}
                positions={[[nap.lat, nap.lng], [c.lat, c.lng]]}
                pathOptions={{
                  color: lineColor,
                  weight: 1.5,
                  opacity: active ? 0.85 : 0.35,
                  dashArray: active ? undefined : '4 6',
                  className: active ? lineClass(true) : '',
                }}
              />
            );
          })}

          {servers.map((s) => (
            <Marker key={`srv-${s.id}`} position={[s.lat, s.lng]} icon={serverIcon(s.name)}>
              <Popup><b>{s.name}</b><br />Server / Router<br />{s.host}</Popup>
            </Marker>
          ))}

          {naps.map((n) => (
            <Marker key={n.id} position={[n.lat, n.lng]} icon={napIcon(n.name, n.kind)}>
              <Popup>
                <b>{n.name}</b> ({n.kind.toUpperCase()})<br />
                Ports: {n.ports}
              </Popup>
            </Marker>
          ))}

          {filteredClients.map((c) => {
            const state = clientState(c);
            const statusText = state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : 'Disabled';
            const statusColor = CLIENT_COLORS[state].fill;
            return (
              <Marker key={c.id} position={[c.lat, c.lng]} icon={onuIcon(state)}>
                <LTooltip direction="top" offset={[0, -8]}>
                  <div className="text-[12px] leading-snug">
                    <div className="font-semibold text-slate-800">{c.customer}</div>
                    <div><span className="text-slate-500">User:</span> {c.username}</div>
                    <div><span className="text-slate-500">Status:</span> <b style={{ color: statusColor }}>{statusText}</b></div>
                    <div><span className="text-slate-500">Topo:</span> {c.topology || '-'}</div>
                  </div>
                </LTooltip>
                <Popup maxWidth={320}>
                  <div className="text-[12px] leading-relaxed">
                    <div className="font-bold text-slate-800 text-[13px] mb-1">{c.customer}</div>
                    <Detail k="Username" v={c.username} />
                    <Detail k="Account #" v={c.account} />
                    <Detail k="Address" v={c.address} />
                    <Detail k="Coordinates" v={`${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`} />
                    <Detail k="Status" v={<b style={{ color: statusColor }}>{statusText}</b>} />
                    <Detail k="Traffic" v={`Rx ${fmtRate(c.rxBps)} · Tx ${fmtRate(c.txBps)}`} />
                    <Detail k="Usage" v={`Rx ${fmtGB(c.rxGB)} · Tx ${fmtGB(c.txGB)}`} />
                    <Detail k="Plan" v={c.plan} />
                    <Detail k="Due" v={c.due} />
                    <Detail k="NAP" v={c.napName} />
                    <Detail k="OLT" v={c.oltName} />
                    <Detail k="Topology" v={c.topology} />
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {editNap && (
        <Modal
          title={editNap.id ? `Edit ${editNap.kind?.toUpperCase()}` : `New ${editNap.kind?.toUpperCase()}`}
          onClose={() => setEditNap(null)}
          footer={<ModalFooter onCancel={() => setEditNap(null)} onConfirm={saveNap} busy={busy} />}
        >
          <div className="space-y-3">
            <FormField label="Name" required>
              <input className="input" value={editNap.name || ''} onChange={(e) => setEditNap({ ...editNap, name: e.target.value })} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Kind">
                <select className="input" value={editNap.kind || 'nap'} onChange={(e) => setEditNap({ ...editNap, kind: e.target.value })}>
                  <option value="olt">OLT</option>
                  <option value="nap">NAP</option>
                </select>
              </FormField>
              <FormField label="Ports">
                <input className="input" type="number" value={editNap.ports || 8} onChange={(e) => setEditNap({ ...editNap, ports: Number(e.target.value) })} />
              </FormField>
            </div>
            {editNap.kind === 'nap' && (
              <FormField label="Parent OLT">
                <select className="input" value={editNap.parentId || ''} onChange={(e) => setEditNap({ ...editNap, parentId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {olts.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </FormField>
            )}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Latitude">
                <input className="input" type="number" step="any" value={editNap.lat ?? ''} onChange={(e) => setEditNap({ ...editNap, lat: Number(e.target.value) })} />
              </FormField>
              <FormField label="Longitude">
                <input className="input" type="number" step="any" value={editNap.lng ?? ''} onChange={(e) => setEditNap({ ...editNap, lng: Number(e.target.value) })} />
              </FormField>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

function TopoPanel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Server size={14} className="text-brand-500" /> {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function TopoRow({ name, sub, right }: { name: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800 truncate">{name}</div>
        <div className="text-xs text-slate-400 truncate">{sub}</div>
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <span className="font-semibold text-slate-700">{k}:</span> <span className="text-slate-600">{v ?? '-'}</span>
    </div>
  );
}

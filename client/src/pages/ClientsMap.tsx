import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip as LTooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Link } from 'react-router-dom';
import { Search, SlidersHorizontal, Maximize2, Plus, Server, X, Route } from 'lucide-react';
import Layout from '../components/Layout';
import { Modal, ModalFooter, FormField, StatusBadge } from '../components/ui';
import { api } from '../api';
import { useRouterDevice } from '../context/RouterContext';

interface ServerNode { id: number; name: string; host?: string; status: string; lat: number; lng: number }
interface Nap { id: number; name: string; kind: string; lat: number; lng: number; ports: number; parentId: number | null }
interface Connector { id: number; kind: string; fromId: number; toId: number; points: [number, number][] }
interface Client {
  id: number; username: string; customer: string; status: string; online: boolean;
  lat: number; lng: number; napId: number; routerId?: number; service: string; address?: string;
  account?: string; plan?: string; due?: string; napName?: string; oltName?: string;
  serverName?: string; upstreamPort?: number; plcPort?: number;
  rxBps?: number; txBps?: number; rxGB?: number; txGB?: number; topology?: string;
}

type ClientState = 'online' | 'offline' | 'disabled';
type RouteKind = 'server-olt' | 'olt-nap' | 'nap-client';

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

function findConnector(connectors: Connector[], kind: string, fromId: number, toId: number) {
  return connectors.find((c) => c.kind === kind && c.fromId === fromId && c.toId === toId);
}

function defaultPath(a: [number, number], b: [number, number]): [number, number][] {
  return [a, b];
}

function resolvePath(
  connectors: Connector[],
  kind: string,
  fromId: number,
  toId: number,
  fallback: [number, number][]
): [number, number][] {
  const c = findConnector(connectors, kind, fromId, toId);
  if (c && c.points && c.points.length >= 2) return c.points;
  return fallback;
}

function serverIcon(name: string, active = false) {
  const label = name.slice(0, 2).toUpperCase();
  return L.divIcon({
    className: 'nap-marker',
    html: `<div class="nap-pin server ${active ? 'map-node-active' : ''}">${label}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function napIcon(name: string, kind: string, active = false) {
  const isOlt = kind === 'olt';
  const label = isOlt ? 'OLT' : 'N';
  return L.divIcon({
    className: 'nap-marker',
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      <div class="nap-pin ${isOlt ? 'olt' : ''} ${active ? 'map-node-active' : ''}">${label}</div>
      <div style="margin-top:2px;background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:600;color:#334155;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.12)">${name}</div>
    </div>`,
    iconSize: [48, 44],
    iconAnchor: [24, 22],
  });
}

function onuIcon(state: ClientState, hovered = false, selected = false) {
  const { fill, glow } = CLIENT_COLORS[state];
  const cls = ['onu-dot', state, hovered || selected ? 'hovered' : '', selected ? 'selected' : ''].filter(Boolean).join(' ');
  return L.divIcon({
    className: 'onu-marker',
    html: `<span class="${cls}" style="--onu-color:${fill};--onu-glow:${glow}"></span>`,
    iconSize: [selected ? 16 : 12, selected ? 16 : 12],
    iconAnchor: [selected ? 8 : 6, selected ? 8 : 6],
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

function MapDrawClicks({ active, onAdd }: { active: boolean; onAdd: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (active) onAdd(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

const emptyNap = (): Partial<Nap> => ({
  name: '', kind: 'nap', lat: 15.1785, lng: 120.5945, ports: 8, parentId: null,
});

export default function ClientsMap() {
  const { current } = useRouterDevice();
  const [servers, setServers] = useState<ServerNode[]>([]);
  const [naps, setNaps] = useState<Nap[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [stats, setStats] = useState<any>({});
  const [search, setSearch] = useState('');
  const [topoOpen, setTopoOpen] = useState(false);
  const [editNap, setEditNap] = useState<Partial<Nap> | null>(null);
  const [busy, setBusy] = useState(false);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Client | null>(null);
  const [routeKind, setRouteKind] = useState<RouteKind>('olt-nap');
  const [routeFrom, setRouteFrom] = useState<number | ''>('');
  const [routeTo, setRouteTo] = useState<number | ''>('');
  const [drawMode, setDrawMode] = useState(false);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);

  const load = useCallback(() => {
    const q = current?.id ? `?routerId=${current.id}` : '';
    return api.get(`/map${q}`).then((r) => {
      setServers(r.data.servers || []);
      setNaps(r.data.naps);
      setClients(r.data.clients);
      setConnectors(r.data.connectors || []);
      setStats(r.data.stats);
    });
  }, [current?.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const olt = useMemo(() => naps.find((n) => n.kind === 'olt'), [naps]);
  const olts = useMemo(() => naps.filter((n) => n.kind === 'olt'), [naps]);
  const napNodes = useMemo(() => naps.filter((n) => n.kind === 'nap'), [naps]);
  const napsById = useMemo(() => Object.fromEntries(naps.map((n) => [n.id, n])), [naps]);

  const center: [number, number] = olt ? [olt.lat, olt.lng] : servers[0] ? [servers[0].lat, servers[0].lng] : [15.1785, 120.5945];
  const highlightId = selected?.id ?? hoveredId;

  const chainFor = useCallback((clientId: number) => {
    const c = clients.find((x) => x.id === clientId);
    if (!c) return null;
    const nap = c.napId ? napsById[c.napId] : null;
    const srv = c.routerId ? servers.find((s) => s.id === c.routerId) : servers[0];
    return { clientId: c.id, napId: nap?.id, oltId: olt?.id, serverId: srv?.id };
  }, [clients, napsById, olt, servers]);

  const highlightChain = highlightId ? chainFor(highlightId) : null;

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

  const lineDim = (partOfHighlight: boolean) => {
    if (!highlightChain) return 1;
    return partOfHighlight ? 1 : 0.12;
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

  const startDraw = () => {
    if (!routeFrom || !routeTo) {
      alert('Select route endpoints first.');
      return;
    }
    const existing = findConnector(connectors, routeKind, Number(routeFrom), Number(routeTo));
    setDrawPoints(existing?.points?.slice(1, -1) || []);
    setDrawMode(true);
  };

  const saveRoute = async () => {
    if (!routeFrom || !routeTo) return;
    const ends = resolveEndpoints(routeKind, Number(routeFrom), Number(routeTo), servers, olt, napsById, clients);
    if (!ends) return;
    const points: [number, number][] = [ends[0], ...drawPoints, ends[1]];
    await api.post('/map/connectors', { kind: routeKind, fromId: routeFrom, toId: routeTo, points });
    setDrawMode(false);
    setDrawPoints([]);
    load();
  };

  const deleteRoute = async () => {
    if (!routeFrom || !routeTo) return;
    await api.delete('/map/connectors', { params: { kind: routeKind, fromId: routeFrom, toId: routeTo } });
    setDrawPoints([]);
    load();
  };

  const lineClass = (active: boolean, backbone = false) =>
    active ? (backbone ? 'flow-line-backbone' : 'flow-line-active') : '';

  const savedRouteCount = connectors.length;

  return (
    <Layout title="Topology">
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
        <span className="text-slate-400">· Hover for quick info · Click client for full details · Lines: Server → OLT → NAP → Client</span>
      </div>

      {topoOpen && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <TopoPanel title="Server Configuration" action={<Link to="/routers" className="text-xs text-brand-600 hover:underline">Manage routers →</Link>}>
              {servers.length === 0 ? <p className="text-sm text-slate-400 py-4 text-center">No servers added.</p> : servers.map((s) => (
                <TopoRow key={s.id} name={s.name} sub={s.host || '—'} right={<StatusBadge status={s.status === 'online' ? 'online' : 'offline'} />} />
              ))}
            </TopoPanel>
            <TopoPanel title="OLT Configuration" action={<button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setEditNap({ ...emptyNap(), kind: 'olt' })}><Plus size={12} className="inline" /> New OLT</button>}>
              {olts.length === 0 ? <p className="text-sm text-slate-400 py-4 text-center">No OLT configured.</p> : olts.map((o) => (
                <TopoRow key={o.id} name={o.name} sub={`${o.ports} PONs`} right={<div className="flex gap-2"><button type="button" className="text-xs text-sky-600" onClick={() => setEditNap({ ...o })}>Edit</button><button type="button" className="text-xs text-rose-600" onClick={() => deleteNap(o.id)}>Delete</button></div>} />
              ))}
            </TopoPanel>
            <TopoPanel title="NAP Configuration" action={<button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setEditNap({ ...emptyNap(), parentId: olt?.id || null })}><Plus size={12} className="inline" /> New NAP</button>}>
              <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                {napNodes.length === 0 ? <p className="text-sm text-slate-400 py-4 text-center">No NAPs.</p> : napNodes.map((n) => (
                  <TopoRow key={n.id} name={n.name} sub={n.parentId ? `From: ${napsById[n.parentId]?.name}` : 'No parent'} right={<div className="flex gap-2"><button type="button" className="text-xs text-sky-600" onClick={() => setEditNap({ ...n })}>Edit</button><button type="button" className="text-xs text-rose-600" onClick={() => deleteNap(n.id)}>Delete</button></div>} />
                ))}
              </div>
            </TopoPanel>
          </div>

          <div className="card p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Route size={16} className="text-brand-500" />
              <h3 className="text-sm font-semibold text-slate-700">Cable Route (Street Path)</h3>
              <span className="text-xs text-slate-400 ml-auto">Saved routes: {savedRouteCount}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <FormField label="Route type">
                <select className="input" value={routeKind} onChange={(e) => { setRouteKind(e.target.value as RouteKind); setRouteFrom(''); setRouteTo(''); }}>
                  <option value="server-olt">Server → OLT</option>
                  <option value="olt-nap">OLT → NAP</option>
                  <option value="nap-client">NAP → Client</option>
                </select>
              </FormField>
              <FormField label="From">
                <select className="input" value={routeFrom} onChange={(e) => setRouteFrom(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Select…</option>
                  {routeKind === 'server-olt' && servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  {routeKind === 'olt-nap' && olts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  {routeKind === 'nap-client' && napNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </FormField>
              <FormField label="To">
                <select className="input" value={routeTo} onChange={(e) => setRouteTo(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Select…</option>
                  {routeKind === 'server-olt' && olts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  {routeKind === 'olt-nap' && napNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  {routeKind === 'nap-client' && clients.map((c) => <option key={c.id} value={c.id}>{c.customer || c.username}</option>)}
                </select>
              </FormField>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary text-sm" onClick={startDraw}>{drawMode ? 'Drawing…' : 'Draw on Map'}</button>
                <button type="button" className="btn-secondary text-sm" onClick={saveRoute} disabled={!drawMode}>Save Route</button>
                <button type="button" className="text-sm text-rose-600 px-3 py-2 border border-rose-200 rounded-xl hover:bg-rose-50" onClick={deleteRoute}>Delete Saved</button>
              </div>
            </div>
            {drawMode && <p className="text-xs text-brand-700 mt-2">Click the map to add street waypoints between endpoints, then Save Route.</p>}
          </div>
        </>
      )}

      <div id="map-wrap" className="card overflow-hidden relative" style={{ height: topoOpen ? '52vh' : '70vh' }}>
        {drawMode && (
          <div className="map-draw-banner bg-brand-600 text-white text-xs font-medium px-4 py-2 rounded-lg shadow-lg">
            Drawing cable path — click map to add points ({drawPoints.length} waypoint{drawPoints.length !== 1 ? 's' : ''})
            <button type="button" className="ml-3 underline" onClick={() => { setDrawMode(false); setDrawPoints([]); }}>Cancel</button>
          </div>
        )}

        {selected && (
          <ClientPanel client={selected} onClose={() => setSelected(null)} />
        )}

        <button onClick={() => document.getElementById('map-wrap')?.requestFullscreen?.()} className="absolute top-3 right-3 z-[500] bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2 shadow-sm">
          <Maximize2 size={14} /> Fullscreen
        </button>

        <MapContainer center={center} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitBounds points={allPoints} />
          <MapDrawClicks active={drawMode} onAdd={(lat, lng) => setDrawPoints((p) => [...p, [lat, lng]])} />

          {servers.map((srv) => {
            if (!olt) return null;
            const hi = highlightChain?.serverId === srv.id && highlightChain?.oltId === olt.id;
            const path = resolvePath(connectors, 'server-olt', srv.id, olt.id, defaultPath([srv.lat, srv.lng], [olt.lat, olt.lng]));
            return (
              <Polyline key={`s-olt-${srv.id}`} positions={path} pathOptions={{
                color: '#0d9488', weight: hi ? 4 : 2.5, opacity: 0.75 * lineDim(hi), className: lineClass(true, true),
              }} />
            );
          })}

          {olt && napNodes.map((n) => {
            const hi = highlightChain?.oltId === olt.id && highlightChain?.napId === n.id;
            const path = resolvePath(connectors, 'olt-nap', olt.id, n.id, defaultPath([olt.lat, olt.lng], [n.lat, n.lng]));
            return (
              <Polyline key={`olt-nap-${n.id}`} positions={path} pathOptions={{
                color: '#2563eb', weight: hi ? 3.5 : 2, opacity: 0.8 * lineDim(hi), className: lineClass(true, true),
              }} />
            );
          })}

          {filteredClients.map((c) => {
            const nap = c.napId ? napsById[c.napId] : null;
            if (!nap) return null;
            const state = clientState(c);
            const active = state === 'online';
            const hi = highlightChain?.clientId === c.id;
            const lineColor = state === 'online' ? '#22c55e' : state === 'offline' ? '#f97316' : '#f87171';
            const path = resolvePath(connectors, 'nap-client', nap.id, c.id, defaultPath([nap.lat, nap.lng], [c.lat, c.lng]));
            return (
              <Polyline key={`cl-${c.id}`} positions={path} pathOptions={{
                color: lineColor, weight: hi ? 3 : 1.5, opacity: (active ? 0.9 : 0.35) * lineDim(hi),
                dashArray: active ? undefined : '4 6', className: active ? lineClass(true) : '',
              }} />
            );
          })}

          {drawMode && routeFrom && routeTo && (() => {
            const ends = resolveEndpoints(routeKind, Number(routeFrom), Number(routeTo), servers, olt, napsById, clients);
            if (!ends) return null;
            return (
              <Polyline positions={[ends[0], ...drawPoints, ends[1]]} pathOptions={{ color: '#f59e0b', weight: 3, dashArray: '6 4' }} />
            );
          })()}

          {servers.map((s) => (
            <Marker key={`srv-${s.id}`} position={[s.lat, s.lng]} icon={serverIcon(s.name, highlightChain?.serverId === s.id)}>
              <Popup><b>{s.name}</b><br />Server</Popup>
            </Marker>
          ))}

          {naps.map((n) => (
            <Marker key={n.id} position={[n.lat, n.lng]} icon={napIcon(n.name, n.kind, highlightChain?.napId === n.id || (n.kind === 'olt' && highlightChain?.oltId === n.id))}>
              <Popup><b>{n.name}</b> ({n.kind.toUpperCase()})</Popup>
            </Marker>
          ))}

          {filteredClients.map((c) => {
            const state = clientState(c);
            const isHover = hoveredId === c.id;
            const isSel = selected?.id === c.id;
            return (
              <Marker
                key={c.id}
                position={[c.lat, c.lng]}
                icon={onuIcon(state, isHover, isSel)}
                eventHandlers={{
                  mouseover: () => setHoveredId(c.id),
                  mouseout: () => setHoveredId((id) => (id === c.id ? null : id)),
                  click: () => setSelected(c),
                }}
              >
                <LTooltip sticky direction="top">
                  <div className="text-[12px] leading-snug min-w-[140px]">
                    <div className="font-semibold">{c.customer}</div>
                    <div className="text-slate-500">{c.username}</div>
                    <div><b style={{ color: CLIENT_COLORS[state].fill }}>{state}</b> · {c.plan}</div>
                  </div>
                </LTooltip>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {editNap && (
        <Modal title={editNap.id ? `Edit ${editNap.kind?.toUpperCase()}` : `New ${editNap.kind?.toUpperCase()}`} onClose={() => setEditNap(null)} footer={<ModalFooter onCancel={() => setEditNap(null)} onConfirm={saveNap} busy={busy} />}>
          <div className="space-y-3">
            <FormField label="Name" required><input className="input" value={editNap.name || ''} onChange={(e) => setEditNap({ ...editNap, name: e.target.value })} /></FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Kind"><select className="input" value={editNap.kind || 'nap'} onChange={(e) => setEditNap({ ...editNap, kind: e.target.value })}><option value="olt">OLT</option><option value="nap">NAP</option></select></FormField>
              <FormField label="Ports"><input className="input" type="number" value={editNap.ports || 8} onChange={(e) => setEditNap({ ...editNap, ports: Number(e.target.value) })} /></FormField>
            </div>
            {editNap.kind === 'nap' && (
              <FormField label="Parent OLT"><select className="input" value={editNap.parentId || ''} onChange={(e) => setEditNap({ ...editNap, parentId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{olts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></FormField>
            )}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Latitude"><input className="input" type="number" step="any" value={editNap.lat ?? ''} onChange={(e) => setEditNap({ ...editNap, lat: Number(e.target.value) })} /></FormField>
              <FormField label="Longitude"><input className="input" type="number" step="any" value={editNap.lng ?? ''} onChange={(e) => setEditNap({ ...editNap, lng: Number(e.target.value) })} /></FormField>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

function resolveEndpoints(
  kind: RouteKind, fromId: number, toId: number,
  servers: ServerNode[], olt: Nap | undefined, napsById: Record<number, Nap>, clients: Client[]
): [[number, number], [number, number]] | null {
  if (kind === 'server-olt') {
    const s = servers.find((x) => x.id === fromId);
    const o = napsById[toId];
    if (!s || !o) return null;
    return [[s.lat, s.lng], [o.lat, o.lng]];
  }
  if (kind === 'olt-nap') {
    const o = napsById[fromId];
    const n = napsById[toId];
    if (!o || !n) return null;
    return [[o.lat, o.lng], [n.lat, n.lng]];
  }
  const n = napsById[fromId];
  const c = clients.find((x) => x.id === toId);
  if (!n || !c) return null;
  return [[n.lat, n.lng], [c.lat, c.lng]];
}

function ClientPanel({ client, onClose }: { client: Client; onClose: () => void }) {
  const state = clientState(client);
  const color = CLIENT_COLORS[state].fill;
  return (
    <div className="map-client-panel card shadow-xl border border-slate-200 p-4 animate-fade-in-up">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="font-bold text-slate-900">{client.customer}</div>
          <div className="text-xs text-slate-500">{client.username} · {client.account}</div>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
      </div>
      <div className="text-sm space-y-1.5">
        <div><span className="text-slate-500">Status:</span> <b style={{ color }}>{state}</b></div>
        <div><span className="text-slate-500">Address:</span> {client.address || '—'}</div>
        <div><span className="text-slate-500">Location:</span> <span className="font-mono text-xs">{client.lat.toFixed(5)}, {client.lng.toFixed(5)}</span></div>
        <div><span className="text-slate-500">Plan:</span> {client.plan} · Due {client.due}</div>
        <div><span className="text-slate-500">Traffic:</span> Rx {fmtRate(client.rxBps)} · Tx {fmtRate(client.txBps)}</div>
        <div><span className="text-slate-500">Usage:</span> Rx {fmtGB(client.rxGB)} · Tx {fmtGB(client.txGB)}</div>
        <div className="pt-2 border-t border-slate-100 text-xs text-slate-500">
          <div>NAP: {client.napName} · OLT: {client.oltName}</div>
          <div className="mt-1 font-medium text-slate-700">{client.topology}</div>
        </div>
      </div>
    </div>
  );
}

function TopoPanel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2"><Server size={14} className="text-brand-500" /> {title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function TopoRow({ name, sub, right }: { name: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
      <div className="min-w-0"><div className="text-sm font-medium text-slate-800 truncate">{name}</div><div className="text-xs text-slate-400 truncate">{sub}</div></div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}

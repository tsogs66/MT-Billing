import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, Tooltip as LTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Search, SlidersHorizontal, Maximize2 } from 'lucide-react';
import Layout from '../components/Layout';
import { api } from '../api';

interface Nap { id: number; name: string; kind: string; lat: number; lng: number; ports: number; parentId: number | null }
interface Client {
  id: number; username: string; customer: string; status: string; online: boolean;
  lat: number; lng: number; napId: number; service: string;
  account?: string; plan?: string; due?: string; napName?: string; oltName?: string;
  serverName?: string; upstreamPort?: number; plcPort?: number;
  rxBps?: number; txBps?: number; rxGB?: number; txGB?: number; topology?: string;
}

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

function napIcon(name: string, kind: string) {
  const color = kind === 'olt' ? '#7c3aed' : '#2563eb';
  return L.divIcon({
    className: 'nap-marker',
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-6px)">
      <div style="background:${color};color:#fff;border-radius:5px;padding:2px 6px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3)">${name}</div>
      <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:6px solid ${color}"></div>
    </div>`,
    iconSize: [40, 28],
    iconAnchor: [20, 28],
  });
}

function onuIcon(online: boolean) {
  const color = online ? '#22c55e' : '#ef4444';
  const glow = online ? 'rgba(34,197,94,0.55)' : 'transparent';
  return L.divIcon({
    className: 'onu-marker',
    html: `<span class="onu-dot ${online ? 'online' : 'offline'}" style="--onu-color:${color};--onu-glow:${glow}"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

/** Fit the map to all topology + client points once they load. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [50, 50] });
    }
  }, [map, points]);
  return null;
}

export default function ClientsMap() {
  const [naps, setNaps] = useState<Nap[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stats, setStats] = useState<any>({});
  const [search, setSearch] = useState('');

  const load = () =>
    api.get('/map').then((r) => {
      setNaps(r.data.naps);
      setClients(r.data.clients);
      setStats(r.data.stats);
    });

  useEffect(() => {
    load();
    // Live refresh so ONU online/offline status stays current.
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const olt = useMemo(() => naps.find((n) => n.kind === 'olt'), [naps]);
  const napsById = useMemo(() => Object.fromEntries(naps.map((n) => [n.id, n])), [naps]);

  const center: [number, number] = olt ? [olt.lat, olt.lng] : [15.1785, 120.5945];

  const filteredClients = clients.filter(
    (c) => !search || c.username.toLowerCase().includes(search.toLowerCase()) || (c.customer || '').toLowerCase().includes(search.toLowerCase())
  );

  const allPoints: [number, number][] = useMemo(
    () => [...naps.map((n) => [n.lat, n.lng] as [number, number]), ...clients.map((c) => [c.lat, c.lng] as [number, number])],
    [naps, clients]
  );

  const enterFullscreen = () => {
    const el = document.getElementById('map-wrap');
    if (el?.requestFullscreen) el.requestFullscreen();
  };

  return (
    <Layout title="Clients Map">
      <div className="card p-3 mb-4 flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-slate-500 flex items-center gap-4 flex-wrap">
          <span>Servers: <b className="text-slate-700">{stats.servers ?? '—'}</b></span>
          <span>OLTs: <b className="text-slate-700">{stats.olts ?? '—'}</b></span>
          <span>NAPs: <b className="text-slate-700">{stats.naps ?? '—'}</b></span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> ONU Online: <b className="text-emerald-600">{stats.onlineOnu ?? '—'}</b></span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> ONU Offline: <b className="text-rose-600">{stats.offlineOnu ?? '—'}</b></span>
          <span>Clients with location: <b className="text-slate-700">{(stats.totalClients ?? 0) - (stats.withoutLocation || 0)}</b>
            <span className="text-slate-400"> ({stats.withoutLocation ?? 0} not shown)</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 text-slate-600">
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

      <div className="text-xs text-slate-400 mb-2 flex items-center gap-3 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block animate-pulse" /> ONU Online</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> ONU Offline</span>
        <span>· Animated links show live traffic flow: Server → OLT → NAP → ONU</span>
      </div>

      <div id="map-wrap" className="card overflow-hidden relative" style={{ height: '70vh' }}>
        <button
          onClick={enterFullscreen}
          className="absolute top-3 right-3 z-[500] bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2 shadow-sm"
        >
          <Maximize2 size={14} /> Fullscreen
        </button>
        <MapContainer center={center} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitBounds points={allPoints} />

          {/* OLT -> NAP backbone (always animated) */}
          {olt &&
            naps
              .filter((n) => n.kind === 'nap')
              .map((n) => (
                <Polyline
                  key={`l-${n.id}`}
                  positions={[[olt.lat, olt.lng], [n.lat, n.lng]]}
                  pathOptions={{ color: '#2563eb', weight: 2, opacity: 0.8, className: 'flow-line' }}
                />
              ))}

          {/* NAP -> client (animated when the ONU is online, dim & static when offline) */}
          {filteredClients.map((c) => {
            const nap = napsById[c.napId];
            if (!nap) return null;
            return (
              <Polyline
                key={`cl-${c.id}`}
                positions={[[nap.lat, nap.lng], [c.lat, c.lng]]}
                pathOptions={
                  c.online
                    ? { color: '#22c55e', weight: 1.4, opacity: 0.7, className: 'flow-line-slow' }
                    : { color: '#f87171', weight: 1, opacity: 0.35, dashArray: '2 4' }
                }
              />
            );
          })}

          {/* NAP / OLT markers */}
          {naps.map((n) => (
            <Marker key={n.id} position={[n.lat, n.lng]} icon={napIcon(n.name, n.kind)}>
              <Popup>
                <b>{n.name}</b> ({n.kind.toUpperCase()})<br />
                Ports: {n.ports}
              </Popup>
            </Marker>
          ))}

          {/* ONU markers: brief details on hover, full details on click */}
          {filteredClients.map((c) => {
            const statusColor = c.online ? '#16a34a' : '#dc2626';
            const statusText = c.online ? 'Online' : 'Offline';
            return (
              <Marker key={c.id} position={[c.lat, c.lng]} icon={onuIcon(c.online)}>
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
                    <Detail k="Status" v={<b style={{ color: statusColor }}>{statusText}</b>} />
                    <Detail k="Traffic" v={`Rx ${fmtRate(c.rxBps)} \u00b7 Tx ${fmtRate(c.txBps)}`} />
                    <Detail k="Usage" v={`Rx ${fmtGB(c.rxGB)} \u00b7 Tx ${fmtGB(c.txGB)}`} />
                    <Detail k="Plan" v={c.plan} />
                    <Detail k="Due" v={c.due} />
                    <Detail k="NAP" v={c.napName} />
                    <Detail k="Upstream Port" v={c.upstreamPort} />
                    <Detail k="OLT" v={c.oltName} />
                    <Detail k="PLC Port" v={c.plcPort} />
                    <Detail k="Topology" v={c.topology} />
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </Layout>
  );
}

function Detail({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <span className="font-semibold text-slate-700">{k}:</span> <span className="text-slate-600">{v ?? '-'}</span>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, Tooltip as LTooltip } from 'react-leaflet';
import L from 'leaflet';
import { Search, SlidersHorizontal, Maximize2 } from 'lucide-react';
import Layout from '../components/Layout';
import { api } from '../api';

interface Nap { id: number; name: string; kind: string; lat: number; lng: number; ports: number; parentId: number | null }
interface Client { id: number; username: string; customer: string; status: string; lat: number; lng: number; napId: number; service: string }

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

export default function ClientsMap() {
  const [naps, setNaps] = useState<Nap[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [stats, setStats] = useState<any>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/map').then((r) => {
      setNaps(r.data.naps);
      setClients(r.data.clients);
      setStats(r.data.stats);
    });
  }, []);

  const olt = useMemo(() => naps.find((n) => n.kind === 'olt'), [naps]);
  const napsById = useMemo(() => Object.fromEntries(naps.map((n) => [n.id, n])), [naps]);

  const center: [number, number] = olt ? [olt.lat, olt.lng] : [15.1785, 120.5945];

  const filteredClients = clients.filter(
    (c) => !search || c.username.toLowerCase().includes(search.toLowerCase()) || (c.customer || '').toLowerCase().includes(search.toLowerCase())
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
          <span>Clients with location: <b className="text-slate-700">{stats.totalClients - (stats.withoutLocation || 0)}</b>
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

      <div className="text-xs text-slate-400 mb-2">
        Clients: <span className="text-emerald-600 font-medium">Online green</span> · <span className="text-amber-600 font-medium">Offline orange</span> ·
        <span className="text-rose-600 font-medium"> Disabled red</span> — Lines show Server → OLT → NAP → Client
      </div>

      <div id="map-wrap" className="card overflow-hidden relative" style={{ height: '70vh' }}>
        <button
          onClick={enterFullscreen}
          className="absolute top-3 right-3 z-[500] bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2 shadow-sm"
        >
          <Maximize2 size={14} /> Fullscreen
        </button>
        <MapContainer center={center} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* OLT -> NAP topology lines */}
          {olt &&
            naps
              .filter((n) => n.kind === 'nap')
              .map((n) => (
                <Polyline key={`l-${n.id}`} positions={[[olt.lat, olt.lng], [n.lat, n.lng]]} pathOptions={{ color: '#3b82f6', weight: 1.5, dashArray: '5 6', opacity: 0.7 }} />
              ))}

          {/* NAP -> client lines */}
          {filteredClients.map((c) => {
            const nap = napsById[c.napId];
            if (!nap) return null;
            return (
              <Polyline key={`cl-${c.id}`} positions={[[nap.lat, nap.lng], [c.lat, c.lng]]} pathOptions={{ color: '#93c5fd', weight: 0.8, opacity: 0.4 }} />
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

          {/* Client markers */}
          {filteredClients.map((c) => {
            const color = c.status === 'Active' ? '#22c55e' : c.status === 'expired' ? '#ef4444' : '#f59e0b';
            return (
              <CircleMarker
                key={c.id}
                center={[c.lat, c.lng]}
                radius={6}
                pathOptions={{ color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 1 }}
              >
                <LTooltip>{c.customer}</LTooltip>
                <Popup>
                  <b>{c.customer}</b><br />
                  {c.username}<br />
                  Status: {c.status}<br />
                  Service: {c.service.toUpperCase()}
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </Layout>
  );
}

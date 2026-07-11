import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Search, LocateFixed, X, MapPin } from 'lucide-react';
import { api } from '../api';

export const DEFAULT_PIN: [number, number] = [13.918727824777054, 120.93881797116397];

const pinIcon = L.divIcon({
  className: 'loc-pin',
  html: `<div style="transform:translate(-50%,-100%)"><svg width="30" height="42" viewBox="0 0 24 34" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 8.5 12 22 12 22s12-13.5 12-22C24 5.4 18.6 0 12 0z" fill="#ea580c"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/></svg></div>`,
  iconSize: [30, 42],
  iconAnchor: [15, 42],
});

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function Recenter({ pos }: { pos: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(pos, map.getZoom());
  }, [map, pos]);
  return null;
}

export default function LocationEditor({
  initial,
  onDone,
  onCancel,
  large = false,
}: {
  initial?: { lat: number | null; lng: number | null };
  onDone: (coords: { lat: number; lng: number }) => void;
  onCancel: () => void;
  large?: boolean;
}) {
  const start: [number, number] =
    initial?.lat != null && initial?.lng != null ? [initial.lat, initial.lng] : DEFAULT_PIN;
  const [pos, setPos] = useState<[number, number]>(start);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ displayName: string; lat: number; lon: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState('');

  const setLat = (v: string) => setPos(([, lng]) => [v === '' ? 0 : Number(v), lng]);
  const setLng = (v: string) => setPos(([lat]) => [lat, v === '' ? 0 : Number(v)]);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setMsg('');
    setResults([]);
    try {
      const r = await api.get(`/geocode?q=${encodeURIComponent(query)}`);
      if (!r.data.length) setMsg('No results found.');
      setResults(r.data);
      if (r.data[0]) setPos([r.data[0].lat, r.data[0].lon]);
    } catch {
      setMsg('Search is unavailable right now.');
    } finally {
      setSearching(false);
    }
  };

  const useCurrent = () => {
    if (!navigator.geolocation) {
      setMsg('Geolocation is not supported by this browser.');
      return;
    }
    setMsg('Locating…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos([p.coords.latitude, p.coords.longitude]);
        setMsg('');
      },
      () => setMsg('Unable to get current location (permission denied).'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[1200] p-4" onClick={onCancel}>
      <div className={`bg-white rounded-xl shadow-2xl w-full ${large ? 'max-w-5xl' : 'max-w-2xl'}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2"><MapPin size={18} className="text-brand-600" /> Set Map Location</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-slate-500 mb-1 block">Search address (OpenStreetMap)</label>
              <div className="relative">
                <Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search()}
                  placeholder="e.g. Batangas City"
                  className="input pl-8"
                />
              </div>
            </div>
            <button className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600" onClick={search} disabled={searching}>
              {searching ? 'Searching…' : 'Search'}
            </button>
            <button className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600" onClick={useCurrent}>
              <LocateFixed size={15} /> Use Current Location
            </button>
          </div>

          {results.length > 1 && (
            <div className="max-h-28 overflow-y-auto border border-slate-100 rounded-lg text-sm">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => setPos([r.lat, r.lon])}
                  className="block w-full text-left px-3 py-1.5 hover:bg-slate-50 truncate"
                  title={r.displayName}
                >
                  {r.displayName}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Latitude</label>
              <input className="input" value={pos[0]} onChange={(e) => setLat(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Longitude</label>
              <input className="input" value={pos[1]} onChange={(e) => setLng(e.target.value)} />
            </div>
          </div>

          {msg && <div className="text-xs text-slate-500">{msg}</div>}

          <div className={`${large ? 'h-[min(62vh,520px)]' : 'h-72'} rounded-lg overflow-hidden border border-slate-100`}>
            <MapContainer center={start} zoom={15} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
              <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Recenter pos={pos} />
              <ClickHandler onPick={(lat, lng) => setPos([lat, lng])} />
              <Marker
                position={pos}
                icon={pinIcon}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const m = e.target as L.Marker;
                    const ll = m.getLatLng();
                    setPos([ll.lat, ll.lng]);
                  },
                }}
              />
            </MapContainer>
          </div>
          <p className="text-[11px] text-slate-400">Click the map or drag the pin to set the exact location.</p>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={() => onDone({ lat: Number(pos[0]), lng: Number(pos[1]) })}>Done</button>
        </div>
      </div>
    </div>
  );
}

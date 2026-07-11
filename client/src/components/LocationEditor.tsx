import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Search, LocateFixed, X, MapPin, ShieldAlert } from 'lucide-react';
import { api } from '../api';
import { Portal } from './Portal';

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

function geoErrorMessage(err: GeolocationPositionError | Error | unknown): string {
  const code = (err as GeolocationPositionError)?.code;
  if (code === 1) {
    return 'Location permission denied. On Android: Settings → Apps → Browser → Permissions → Location → Allow. On desktop: click the lock icon in the address bar → Site settings → Location → Allow, then try again.';
  }
  if (code === 2) return 'Location unavailable. Check GPS/Wi‑Fi and try again.';
  if (code === 3) return 'Location request timed out. Move outdoors or enable high-accuracy GPS and retry.';
  return (err as Error)?.message || 'Unable to get current location.';
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
  const [perm, setPerm] = useState<PermissionState | 'unsupported' | 'unknown'>('unknown');
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!navigator.permissions?.query) {
      setPerm('unsupported');
      return;
    }
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (cancelled) return;
        setPerm(status.state);
        status.onchange = () => setPerm(status.state);
      })
      .catch(() => setPerm('unsupported'));
    return () => {
      cancelled = true;
    };
  }, []);

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
      setMsg('Geolocation is not supported by this browser. Use Chrome/Edge on desktop or Android Chrome.');
      return;
    }
    setLocating(true);
    setMsg('Requesting location permission…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos([p.coords.latitude, p.coords.longitude]);
        setMsg(`Location set (±${Math.round(p.coords.accuracy || 0)} m).`);
        setLocating(false);
        setPerm('granted');
      },
      (err) => {
        setMsg(geoErrorMessage(err));
        setLocating(false);
        if (err.code === 1) setPerm('denied');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[1200] flex items-center justify-center p-3 sm:p-6 bg-black/55 backdrop-blur-sm animate-fade-in"
        role="dialog"
        aria-modal="true"
        onClick={onCancel}
      >
        <div
          className={`bg-white rounded-2xl shadow-2xl w-full ${large ? 'max-w-5xl' : 'max-w-2xl'} max-h-[min(94vh,920px)] flex flex-col mx-auto my-auto`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 shrink-0">
            <h3 className="font-semibold text-slate-700 flex items-center gap-2">
              <MapPin size={18} className="text-brand-600" /> Set Map Location
            </h3>
            <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100">
              <X size={18} />
            </button>
          </div>

          <div className="p-5 space-y-3 overflow-y-auto min-h-0 flex-1">
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
              <button type="button" className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600" onClick={search} disabled={searching}>
                {searching ? 'Searching…' : 'Search'}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700"
                onClick={useCurrent}
                disabled={locating}
              >
                <LocateFixed size={15} /> {locating ? 'Locating…' : 'Use Current Location'}
              </button>
            </div>

            {perm === 'denied' && (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                <span>Location access is blocked for this site. Enable it in browser/device settings, then tap Use Current Location again.</span>
              </div>
            )}
            {perm === 'prompt' && (
              <p className="text-xs text-slate-500">Your browser will ask for location permission when you tap Use Current Location (works on desktop and Android).</p>
            )}

            {results.length > 1 && (
              <div className="max-h-28 overflow-y-auto border border-slate-100 rounded-lg text-sm">
                {results.map((r, i) => (
                  <button
                    key={i}
                    type="button"
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

            {msg && <div className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{msg}</div>}

            <div className={`${large ? 'h-[min(55vh,480px)]' : 'h-72'} rounded-lg overflow-hidden border border-slate-100`}>
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
            <p className="text-[11px] text-slate-400">Click the map or drag the pin to set the exact location. Coordinates update Clients Map when you save the user.</p>
          </div>

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100 shrink-0">
            <button type="button" className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100" onClick={onCancel}>Cancel</button>
            <button type="button" className="btn-primary" onClick={() => onDone({ lat: Number(pos[0]), lng: Number(pos[1]) })}>Done</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

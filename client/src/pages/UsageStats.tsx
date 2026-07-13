import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Globe2, RefreshCw, Users, X } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Layout from '../components/Layout';
import { Card, TabBar, Toolbar, DataTable } from '../components/ui';
import { api } from '../api';
import { formatBps, TrafficPair } from '../lib/traffic';
import { useRouterDevice } from '../context/RouterContext';

function formatBytes(n: number): string {
  const v = Number(n) || 0;
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)} TB`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)} KB`;
  return `${Math.round(v)} B`;
}

function fmtAxis(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(0)}M`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)}k`;
  return `${Math.round(bps)}`;
}

const TABS = [
  { key: 'users', label: 'Per User', icon: Users },
  { key: 'services', label: 'Websites & Platforms', icon: Globe2 },
];

type TrafficPoint = { t: string; label: string; downloadBps: number; uploadBps: number };
type LiveService = {
  id: string;
  name: string;
  category: string;
  hits: number;
  destinations: string[];
};

export default function UsageStats() {
  const { current } = useRouterDevice();
  const [tab, setTab] = useState('users');
  const [days, setDays] = useState(7);
  const [users, setUsers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [note, setNote] = useState('');
  const [sampleCount, setSampleCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [trafficSeries, setTrafficSeries] = useState<TrafficPoint[]>([]);
  const [liveServices, setLiveServices] = useState<LiveService[]>([]);
  const [live, setLive] = useState<{
    downloadBps: number;
    uploadBps: number;
    online: boolean;
    address: string | null;
    uptime: string | null;
  } | null>(null);
  const [servicesNote, setServicesNote] = useState('');
  const [detailBusy, setDetailBusy] = useState(false);
  const [toast, setToast] = useState('');

  const load = () => {
    setBusy(true);
    api
      .get('/usage/summary', { params: { days, ...(current?.id ? { routerId: current.id } : {}) } })
      .then((r) => {
        setUsers(r.data.users || []);
        setServices(r.data.services || []);
        setNote(r.data.note || '');
        setSampleCount(Number(r.data.sampleCount) || 0);
      })
      .catch(() => {
        setUsers([]);
        setServices([]);
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    setSelected(null);
    setHistory([]);
    setTrafficSeries([]);
    setLiveServices([]);
    setLive(null);
    load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, current?.id]);

  const applyDetail = (d: any) => {
    setHistory(d.history || []);
    const samples: TrafficPoint[] = (d.samples || []).map((s: any) => ({
      t: s.t,
      label: s.label || String(s.t || '').slice(11, 16),
      downloadBps: Number(s.downloadBps) || 0,
      uploadBps: Number(s.uploadBps) || 0,
    }));
    // Append a live point so the graph moves even between poll samples.
    if (d.live && (d.live.downloadBps || d.live.uploadBps || d.live.online)) {
      const nowLabel = new Date().toISOString().slice(11, 19);
      samples.push({
        t: new Date().toISOString(),
        label: nowLabel,
        downloadBps: Number(d.live.downloadBps) || 0,
        uploadBps: Number(d.live.uploadBps) || 0,
      });
    }
    setTrafficSeries(samples.slice(-120));
    setLiveServices(d.services || []);
    setLive(d.live || null);
    setServicesNote(d.servicesNote || '');
  };

  const loadDetail = async (username: string, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setDetailBusy(true);
    try {
      const r = await api.get('/usage/detail', {
        params: { username, days: 30, hours: 6, ...(current?.id ? { routerId: current.id } : {}) },
      });
      applyDetail(r.data);
    } catch {
      if (!opts?.silent) {
        setHistory([]);
        setTrafficSeries([]);
        setLiveServices([]);
        setLive(null);
        setServicesNote('Could not load user detail.');
      }
    } finally {
      if (!opts?.silent) setDetailBusy(false);
    }
  };

  const openUser = async (u: any) => {
    setSelected(u);
    setHistory([]);
    setTrafficSeries([]);
    setLiveServices([]);
    setLive(null);
    setServicesNote('');
    if (!u?.username) return;
    await loadDetail(u.username);
  };

  // Refresh live traffic + services while a user is selected (pause when tab hidden)
  useEffect(() => {
    if (!selected?.username || tab !== 'users') return;
    let cancelled = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      clearTimer();
      if (cancelled || document.visibilityState !== 'visible') return;
      timer = window.setTimeout(tick, 8_000);
    };

    const tick = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      await loadDetail(selected.username, { silent: true });
      schedule();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
      else clearTimer();
    };

    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.username, tab, current?.id]);

  const poll = async () => {
    setBusy(true);
    setToast('');
    try {
      const r = await api.post('/usage/poll', current?.id ? { routerId: current.id } : {});
      const d = r.data || {};
      setToast(
        `Sampled ${d.samples || 0} online session(s)` +
          (d.bytesDelta != null ? ` · +${formatBytes(d.bytesDelta)} since last poll` : '')
      );
      load();
      if (selected?.username) await loadDetail(selected.username, { silent: true });
    } catch (e: any) {
      setToast(e?.response?.data?.error || 'Sample failed — check router API credentials');
    } finally {
      setBusy(false);
    }
  };

  const maxServiceHits = Math.max(1, ...services.map((s) => Number(s.hits) || 0));
  const maxLiveHits = Math.max(1, ...liveServices.map((s) => Number(s.hits) || 0));

  const userColumns = useMemo(
    () => [
      { key: 'subscriber', label: 'Subscriber' },
      { key: 'plan', label: 'Plan' },
      { key: 'live', label: 'Live', align: 'right' as const },
      { key: 'download', label: 'Download', align: 'right' as const },
      { key: 'upload', label: 'Upload', align: 'right' as const },
      { key: 'peak', label: 'Peak ↓', align: 'right' as const },
    ],
    []
  );

  const userRows = useMemo(
    () =>
      users.map((u) => {
        const liveTotal = (Number(u.downloadBps) || 0) + (Number(u.uploadBps) || 0);
        const active = selected?.username === u.username;
        return {
          key: u.username,
          sortValues: {
            subscriber: `${u.username} ${u.customer || ''}`,
            plan: u.profile || '',
            live: liveTotal,
            download: Number(u.rxBytes) || 0,
            upload: Number(u.txBytes) || 0,
            peak: Number(u.peakRxBps) || 0,
          },
          cells: [
            <button
              type="button"
              key="sub"
              className={`text-left w-full rounded-lg px-1 -mx-1 py-0.5 ${active ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50'}`}
              onClick={() => openUser(u)}
            >
              <div className="font-semibold text-slate-800">{u.username}</div>
              <div className="text-xs text-slate-400">{u.customer}</div>
            </button>,
            <span key="plan" className="text-slate-600">{u.profile || '—'}</span>,
            <span key="live" className="inline-block text-right w-full">
              <TrafficPair downloadBps={u.downloadBps} uploadBps={u.uploadBps} />
            </span>,
            <span key="dl" className="font-medium text-emerald-700">
              {formatBytes(u.rxBytes)}
            </span>,
            <span key="ul" className="font-medium text-sky-700">
              {formatBytes(u.txBytes)}
            </span>,
            <span key="peak" className="text-xs text-slate-500">
              {formatBps(u.peakRxBps)}
            </span>,
          ],
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, selected?.username]
  );

  const serviceColumns = useMemo(
    () => [
      { key: 'name', label: 'Platform' },
      { key: 'category', label: 'Category' },
      { key: 'hits', label: 'DNS hits', align: 'right' as const },
      { key: 'share', label: 'Share', align: 'right' as const, sortable: false },
    ],
    []
  );

  const serviceRows = useMemo(
    () =>
      services.map((s) => {
        const hits = Number(s.hits) || 0;
        const pct = Math.max(4, (hits / maxServiceHits) * 100);
        return {
          key: s.id,
          sortValues: {
            name: s.name || '',
            category: s.category || '',
            hits,
          },
          cells: [
            <span key="n" className="font-semibold text-slate-800">
              {s.name}
            </span>,
            <span key="c" className="text-xs text-slate-500">
              {s.category}
            </span>,
            <span key="h" className="font-semibold text-slate-700">
              {hits}
            </span>,
            <div key="bar" className="min-w-[100px] h-2.5 rounded-full bg-slate-100 overflow-hidden ml-auto">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
            </div>,
          ],
        };
      }),
    [services, maxServiceHits]
  );

  return (
    <Layout title="Usage Statistics">
      {toast && (
        <div className="mb-4 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">{toast}</div>
      )}
      <Card noPadding interactive className="overflow-hidden">
        <TabBar tabs={TABS} active={tab} onChange={setTab} className="px-2" />
        <Toolbar
          left={
            <div className="text-sm text-slate-500">
              Live MikroTik byte counters (deltas)
              {current ? ` · ${current.name}` : ''}
              {' · last '}
              <select
                className="input py-1 text-xs inline-block w-auto ml-1"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
              </select>
              {sampleCount > 0 && (
                <span className="ml-2 text-xs text-slate-400">{sampleCount} samples (24h)</span>
              )}
            </div>
          }
          right={
            <button type="button" className="btn-secondary" onClick={poll} disabled={busy}>
              <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> Sample now
            </button>
          }
        />

        {tab === 'users' && (
          <div className="p-4 pt-0">
            <p className="text-xs text-slate-400 mb-3">
              {note ||
                'Download/Upload totals are real traffic measured from each subscriber’s <pppoe-*> interface since sampling started. First sample sets a baseline; usage accumulates after that.'}{' '}
              Click a subscriber for traffic graph and live services.
            </p>
            <div className="min-w-0">
                <DataTable
                  columns={userColumns}
                  rows={userRows}
                  emptyMessage="No usage yet. Online PPPoE sessions are sampled every minute — click Sample now while clients are connected."
                />
              </div>

              {selected &&
                createPortal(
                  <div
                    className="fixed z-[80] right-4 sm:right-6 top-1/2 -translate-y-1/2 w-[min(380px,calc(100vw-1.5rem))] max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-sm shadow-2xl p-4"
                    role="dialog"
                    aria-label={`Usage for ${selected.username}`}
                  >
                    <div className="flex items-center gap-2 font-semibold text-slate-800 mb-3">
                      <Activity size={16} />
                      <span className="truncate flex-1">{selected.username}</span>
                      <button
                        type="button"
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        title="Close"
                        onClick={() => {
                          setSelected(null);
                          setHistory([]);
                          setTrafficSeries([]);
                          setLiveServices([]);
                          setLive(null);
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="space-y-4">
                      {selected.customer && (
                        <div className="text-xs text-slate-500 -mt-2">{selected.customer}</div>
                      )}

                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <span
                          className={`px-2 py-0.5 rounded-full font-medium ${
                            live?.online
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-200 text-slate-600'
                          }`}
                        >
                          {live?.online ? 'Online' : 'Offline'}
                        </span>
                        {live?.address && (
                          <span className="font-mono text-slate-600">{live.address}</span>
                        )}
                        {live?.uptime && <span className="text-slate-400">up {live.uptime}</span>}
                        {detailBusy && <RefreshCw size={12} className="animate-spin text-slate-400" />}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-slate-400">Download</div>
                          <div className="text-sm font-bold text-emerald-700">
                            {formatBps(live?.downloadBps ?? selected.downloadBps ?? 0)}
                          </div>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-slate-400">Upload</div>
                          <div className="text-sm font-bold text-sky-700">
                            {formatBps(live?.uploadBps ?? selected.uploadBps ?? 0)}
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-2">
                          Traffic
                          <span className="font-normal text-slate-400">download / upload · last samples</span>
                        </div>
                        <div className="h-40 rounded-lg bg-slate-50 border border-slate-100 px-1 pt-2">
                          {trafficSeries.length > 1 ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={trafficSeries} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="usageDl" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#059669" stopOpacity={0.35} />
                                    <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                                  </linearGradient>
                                  <linearGradient id="usageUl" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#0284c7" stopOpacity={0.3} />
                                    <stop offset="100%" stopColor="#0284c7" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                <XAxis
                                  dataKey="label"
                                  tick={{ fontSize: 9, fill: '#94a3b8' }}
                                  interval="preserveStartEnd"
                                  minTickGap={24}
                                />
                                <YAxis
                                  tickFormatter={fmtAxis}
                                  tick={{ fontSize: 9, fill: '#94a3b8' }}
                                  width={36}
                                />
                                <Tooltip
                                  formatter={(v: number, name: string) => [
                                    formatBps(Number(v) || 0),
                                    name === 'downloadBps' ? 'Download' : 'Upload',
                                  ]}
                                  labelFormatter={(l) => String(l)}
                                  contentStyle={{
                                    fontSize: 12,
                                    borderRadius: 8,
                                    border: '1px solid #e2e8f0',
                                  }}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="downloadBps"
                                  stroke="#059669"
                                  fill="url(#usageDl)"
                                  strokeWidth={1.5}
                                  isAnimationActive={false}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="uploadBps"
                                  stroke="#0284c7"
                                  fill="url(#usageUl)"
                                  strokeWidth={1.5}
                                  isAnimationActive={false}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="h-full flex items-center justify-center text-xs text-slate-400 px-3 text-center">
                              {detailBusy
                                ? 'Loading traffic…'
                                : 'No traffic samples yet. Keep the user online and click Sample now.'}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-3 mt-1.5 text-[10px] text-slate-500">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-600" /> Download
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-sky-600" /> Upload
                          </span>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-2">
                          <Globe2 size={13} /> Internet services in use
                        </div>
                        {servicesNote && (
                          <div className="text-[11px] text-slate-400 mb-2">{servicesNote}</div>
                        )}
                        <div className="space-y-1.5 max-h-48 overflow-auto">
                          {liveServices.map((s) => {
                            const pct = Math.max(6, (Number(s.hits) / maxLiveHits) * 100);
                            return (
                              <div
                                key={s.id}
                                className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2"
                                title={s.destinations?.join(', ') || undefined}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-800 truncate">{s.name}</div>
                                    <div className="text-[10px] text-slate-400">{s.category}</div>
                                  </div>
                                  <div className="text-xs font-medium text-slate-600 shrink-0">{s.hits}</div>
                                </div>
                                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                          {!detailBusy && liveServices.length === 0 && (
                            <div className="text-sm text-slate-400 py-2">
                              {live?.online
                                ? 'No classified destinations in connection tracking right now.'
                                : 'User is offline — services appear when the session is active.'}
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold text-slate-700 mb-2">Daily totals</div>
                        <div className="space-y-1.5 max-h-36 overflow-auto">
                          {history.map((h) => (
                            <div
                              key={h.day}
                              className="flex justify-between text-xs bg-slate-50 rounded-lg px-3 py-2 border border-slate-100 gap-2"
                            >
                              <span className="font-medium text-slate-700">{h.day}</span>
                              <span className="text-emerald-700">{formatBytes(h.rxBytes)} ↓</span>
                              <span className="text-sky-700">{formatBytes(h.txBytes)} ↑</span>
                            </div>
                          ))}
                          {history.length === 0 && (
                            <div className="text-sm text-slate-400">No daily history yet — keep sampling while online.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>,
                  document.body
                )}
          </div>
        )}

        {tab === 'services' && (
          <div className="p-4 pt-0 space-y-3">
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              This tab is a <b>DNS cache / connection popularity snapshot</b> from MikroTik — not exact bytes per website.
              Click <b>Sample now</b> to refresh. For per-subscriber live services, open a user under <b>Per User</b>.
            </div>
            <DataTable
              columns={serviceColumns}
              rows={serviceRows}
              emptyMessage="No platform data yet. Sample now (works even with no PPPoE sessions). Prefer router DNS so the cache fills with real hostnames."
            />
          </div>
        )}
      </Card>
    </Layout>
  );
}

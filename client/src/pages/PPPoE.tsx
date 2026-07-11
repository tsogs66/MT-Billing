import { useEffect, useState } from 'react';
import { Users, WifiOff, Activity, Layers, Server, ReceiptText, Plus, Pencil, Trash2, KeyRound, Eye, EyeOff, MapPin, DownloadCloud, RefreshCw, Link2 } from 'lucide-react';
import Layout from '../components/Layout';
import {
  StatusBadge, TabBar, Toolbar, SearchInput, DataTable, IconAction, Toast,
  Modal, ModalFooter, FormField, Card,
} from '../components/ui';
import { api, peso } from '../api';
import LocationEditor, { DEFAULT_PIN } from '../components/LocationEditor';
import { useRouterDevice } from '../context/RouterContext';
import { TrafficPair } from '../lib/traffic';
import { copyTextOrPrompt } from '../lib/clipboard';

interface PUser {
  id: number;
  username: string;
  customer: string;
  account: string;
  profile: string;
  status: string;
  subscriptionDue: string;
  price: number;
  email?: string | null;
  contact?: string | null;
  online?: boolean | number;
  sessionOnline?: boolean;
  mikrotikProfile?: string | null;
  downloadBps?: number;
  uploadBps?: number;
}

const TABS = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'offline', label: 'Offline', icon: WifiOff },
  { key: 'active', label: 'Active Connections', icon: Activity },
  { key: 'profiles', label: 'Profiles', icon: Layers },
  { key: 'servers', label: 'Servers', icon: Server },
  { key: 'plans', label: 'Billing Plans', icon: ReceiptText },
];

function userStatusLabel(u: PUser): string {
  const s = String(u.status || '').toLowerCase();
  if (u.sessionOnline || u.online === 1 || u.online === true) {
    if (s === 'expired' || s === 'non-payment') return s;
    return 'online';
  }
  if (s === 'disabled') return 'disabled';
  if (u.status === 'Active' || s === 'active') return 'offline';
  return u.status;
}

export default function PPPoE({ service, title }: { service: 'pppoe' | 'ipoe'; title: string }) {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState<PUser[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [active, setActive] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [payFor, setPayFor] = useState<PUser | null>(null);
  const [editFor, setEditFor] = useState<PUser | null>(null);
  const [toast, setToast] = useState('');
  const [fetching, setFetching] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tabError, setTabError] = useState('');
  const [tabBusy, setTabBusy] = useState(false);
  const [profileEdit, setProfileEdit] = useState<any | null>(null);
  const [showProfileAdd, setShowProfileAdd] = useState(false);
  const [planEdit, setPlanEdit] = useState<any | null>(null);
  const [showPlanAdd, setShowPlanAdd] = useState(false);
  const { current } = useRouterDevice();

  const routerQ = current?.id ? `&routerId=${current.id}` : '';
  const routerParams = current?.id ? { routerId: current.id } : {};

  const loadUsers = (opts?: { silent?: boolean }) =>
    api.get(`/pppoe/users?service=${service}${routerQ}`).then((r) => setUsers(r.data)).catch(() => {
      if (!opts?.silent) setUsers([]);
    });

  const loadProfiles = () =>
    api
      .get('/pppoe/profiles', { params: routerParams })
      .then((r) => setProfiles(Array.isArray(r.data) ? r.data : r.data.profiles || []))
      .catch(() => setProfiles([]));

  const loadActive = (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setTabBusy(true);
      setTabError('');
    }
    return api
      .get('/pppoe/active', { params: { service, ...routerParams } })
      .then((r) => {
        setActive(r.data.sessions || (Array.isArray(r.data) ? r.data : []));
        if (r.data.error) setTabError(r.data.error);
      })
      .catch((e) => {
        if (!opts?.silent) {
          setActive([]);
          setTabError(e?.response?.data?.error || 'Could not load active sessions');
        }
      })
      .finally(() => {
        if (!opts?.silent) setTabBusy(false);
      });
  };

  const loadServers = () => {
    setTabBusy(true);
    setTabError('');
    return api
      .get('/pppoe/servers', { params: routerParams })
      .then((r) => {
        setServers(r.data.servers || (Array.isArray(r.data) ? r.data : []));
        if (r.data.error) setTabError(r.data.error);
      })
      .catch((e) => {
        setServers([]);
        setTabError(e?.response?.data?.error || 'Could not load PPPoE servers');
      })
      .finally(() => setTabBusy(false));
  };

  const loadPlans = () => api.get('/billing-plans').then((r) => setPlans(r.data)).catch(() => setPlans([]));

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 6000);
  };

  const fetchFromMikrotik = async () => {
    if (!current) {
      showToast('Select a router in the top bar first.');
      return;
    }
    setFetching(true);
    try {
      const r = await api.post(`/pppoe/fetch-mikrotik?routerId=${current.id}`);
      showToast(`Fetched from ${r.data.router}: ${r.data.profilesImported} profiles, ${r.data.fetched} secrets (${r.data.created} new, ${r.data.updated} updated), ${r.data.active ?? 0} active.`);
      loadUsers();
      loadProfiles();
      loadPlans();
      if (tab === 'active') loadActive();
      if (tab === 'servers') loadServers();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Fetch from MikroTik failed.');
    } finally {
      setFetching(false);
    }
  };

  const toggleEnabled = async (u: PUser) => {
    try {
      const r = await api.post(`/pppoe/users/${u.id}/toggle-enabled`);
      showToast(`${u.username} ${r.data.status === 'disabled' ? 'disabled' : 'enabled'} in MikroTik.`);
      loadUsers();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Toggle failed.');
    }
  };

  const copyPayLink = async (u: PUser) => {
    try {
      const r = await api.post(`/payment-links/for-user/${u.id}`, { baseUrl: window.location.origin });
      const path = r.data.path || (r.data.token ? `/pay/${r.data.token}` : r.data.url);
      const full =
        typeof r.data.url === 'string' && /^https?:\/\//i.test(r.data.url)
          ? r.data.url
          : `${window.location.origin}${String(path || '').startsWith('/') ? path : `/${path || ''}`}`;
      if (!full || full.endsWith('/pay/') || full.endsWith('/undefined')) {
        showToast('Pay link was created but URL is empty.');
        return;
      }
      const ok = await copyTextOrPrompt(full, `Pay link for ${u.username} — copy:`);
      showToast(ok ? `Pay link copied for ${u.username}` : `Pay link ready — copy from the dialog`);
    } catch (e: any) {
      showToast(e?.response?.data?.error || e?.response?.data?.message || 'Could not create pay link');
    }
  };

  useEffect(() => {
    setTab('users');
    setSearch('');
    setSelected(new Set());
    setTabError('');
    loadUsers();
    loadProfiles();
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, current?.id]);

  useEffect(() => {
    if (tab === 'active') loadActive();
    if (tab === 'servers') loadServers();
    if (tab === 'profiles') loadProfiles();
    if (tab === 'plans') loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, current?.id]);

  // Live traffic polling on Users / Offline / Active tabs
  useEffect(() => {
    if (!current?.id) return;
    if (tab !== 'users' && tab !== 'offline' && tab !== 'active') return;
    const tick = () => {
      if (tab === 'active') loadActive({ silent: true });
      else loadUsers({ silent: true });
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, current?.id, service]);

  const filtered = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      (u.customer || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.account || '').includes(search)
  );
  const offline = filtered.filter((u) => !(u.sessionOnline || u.online === 1 || u.online === true) || u.status === 'disabled');
  const listUsers = tab === 'offline' ? offline : filtered;
  const allSelected = listUsers.length > 0 && listUsers.every((u) => selected.has(u.id));
  const someSelected = listUsers.some((u) => selected.has(u.id));

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        listUsers.forEach((u) => next.delete(u.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        listUsers.forEach((u) => next.add(u.id));
        return next;
      });
    }
  };

  const bulkDisable = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Disable ${ids.length} selected user(s)?`)) return;
    setBulkBusy(true);
    try {
      const r = await api.post('/pppoe/users/bulk-disable', { ids });
      showToast(`Disabled ${r.data.count} user(s).`);
      setSelected(new Set());
      loadUsers();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Bulk disable failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Permanently delete ${ids.length} selected user(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      const r = await api.post('/pppoe/users/bulk-delete', { ids });
      showToast(`Deleted ${r.data.count} user(s).`);
      setSelected(new Set());
      loadUsers();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Bulk delete failed.');
    } finally {
      setBulkBusy(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this user?')) return;
    await api.delete(`/pppoe/users/${id}`);
    loadUsers();
  };

  const deleteProfile = async (p: any) => {
    if (!confirm(`Delete profile "${p.name}"?`)) return;
    try {
      await api.delete(`/pppoe/profiles/${p.id}`, { params: routerParams });
      showToast(`Profile ${p.name} deleted.`);
      loadProfiles();
      loadPlans();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Delete failed.');
    }
  };

  const deletePlan = async (p: any) => {
    if (!confirm(`Delete billing plan "${p.name}"?`)) return;
    try {
      await api.delete(`/billing-plans/${p.id}`);
      showToast(`Plan ${p.name} deleted.`);
      loadPlans();
      loadProfiles();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Delete failed.');
    }
  };

  return (
    <Layout title={title}>
      <Card noPadding interactive className="overflow-hidden">
        <TabBar tabs={TABS} active={tab} onChange={setTab} className="px-2" />

        {(tab === 'users' || tab === 'offline') && (
          <>
            <Toolbar
              left={
                <div className="flex items-center gap-3 flex-wrap">
                  <span>
                    Total Users <span className="font-semibold text-slate-800">{tab === 'offline' ? offline.length : users.length}</span>
                  </span>
                  {someSelected && (
                    <span className="text-brand-600 font-medium text-sm">{selected.size} selected</span>
                  )}
                  {current && (
                    <span className="text-xs text-slate-400">Router: {current.name}</span>
                  )}
                </div>
              }
              right={
                <>
                  {someSelected && (
                    <>
                      <button type="button" className="btn-secondary text-amber-700 border-amber-200 hover:bg-amber-50" onClick={bulkDisable} disabled={bulkBusy}>
                        <KeyRound size={16} /> Disable selected
                      </button>
                      <button type="button" className="btn-secondary text-rose-700 border-rose-200 hover:bg-rose-50" onClick={bulkDelete} disabled={bulkBusy}>
                        <Trash2 size={16} /> Delete selected
                      </button>
                    </>
                  )}
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder={`Search ${service.toUpperCase()} user…`}
                    className="w-64"
                  />
                  <button type="button" className="btn-secondary" onClick={() => loadUsers()} title="Refresh users">
                    <RefreshCw size={16} /> Refresh
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={fetchFromMikrotik}
                    disabled={fetching}
                    title="Read /ppp/secret from the selected router"
                  >
                    <DownloadCloud size={16} /> {fetching ? 'Fetching…' : 'Fetch from MikroTik'}
                  </button>
                  <button type="button" className="btn-primary" onClick={() => setShowAdd(true)}>
                    <Plus size={16} /> Add New User
                  </button>
                </>
              }
            />

            <div className="p-4 pt-0">
              <DataTable
                columns={[
                  {
                    key: 'sel',
                    label: (
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-brand-500 rounded"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected && !allSelected;
                        }}
                        onChange={toggleSelectAll}
                        aria-label="Select all users"
                      />
                    ),
                    className: 'w-10',
                  },
                  { key: 'user', label: 'Username / Customer' },
                  { key: 'account', label: 'Account #' },
                  { key: 'profile', label: 'Profile' },
                  { key: 'status', label: 'Status' },
                  { key: 'traffic', label: (
                    <span>
                      Traffic <span className="text-emerald-600">↓</span>/<span className="text-sky-600">↑</span>
                    </span>
                  ) },
                  { key: 'due', label: 'Subscription Due' },
                  { key: 'actions', label: 'Actions', align: 'right' },
                ]}
                rows={listUsers.map((u) => ({
                  key: u.id,
                  sortValues: {
                    user: u.username,
                    account: u.account,
                    profile: u.mikrotikProfile || u.profile,
                    status: userStatusLabel(u),
                    traffic: (Number(u.downloadBps) || 0) + (Number(u.uploadBps) || 0),
                    due: u.subscriptionDue,
                  },
                  cells: [
                    <input
                      key="cb"
                      type="checkbox"
                      className="w-4 h-4 accent-brand-500 rounded"
                      checked={selected.has(u.id)}
                      onChange={() => toggleSelect(u.id)}
                      aria-label={`Select ${u.username}`}
                    />,
                    <div key="u">
                      <div className="font-semibold text-slate-800">{u.username}</div>
                      <div className="text-xs text-slate-400">{u.customer}</div>
                    </div>,
                    <span className="text-slate-500">{u.account}</span>,
                    <span className="text-slate-600 font-medium">{u.mikrotikProfile || u.profile}</span>,
                    <StatusBadge status={userStatusLabel(u)} />,
                    <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
                      {u.sessionOnline || u.online === 1 || u.online === true
                        ? <TrafficPair downloadBps={u.downloadBps} uploadBps={u.uploadBps} />
                        : '—'}
                    </span>,
                    <span className="text-slate-500">{u.subscriptionDue}</span>,
                    <div key="a" className="flex items-center justify-end gap-1">
                      <IconAction icon={Link2} title="Copy pay link" tone="sky" onClick={() => copyPayLink(u)} />
                      <IconAction icon={ReceiptText} title="Process Payment" tone="emerald" onClick={() => setPayFor(u)} />
                      <IconAction icon={Pencil} title="Edit user" tone="sky" onClick={() => setEditFor(u)} />
                      <IconAction
                        icon={KeyRound}
                        title={u.status === 'disabled' ? 'Enable in MikroTik' : 'Disable in MikroTik'}
                        tone={u.status === 'disabled' ? 'emerald' : 'rose'}
                        onClick={() => toggleEnabled(u)}
                      />
                      <IconAction icon={Trash2} title="Delete" tone="rose" onClick={() => remove(u.id)} />
                    </div>,
                  ],
                }))}
                emptyMessage="No users found."
              />
            </div>
          </>
        )}

        {tab === 'active' && (
          <>
            <Toolbar
              left={
                <span>
                  Active sessions <span className="font-semibold text-slate-800">{active.length}</span>
                  {current ? <span className="text-xs text-slate-400 ml-2">from {current.name}</span> : null}
                </span>
              }
              right={
                <>
                  <SearchInput value={search} onChange={setSearch} placeholder="Search user / IP / MAC…" className="w-64" />
                  <button type="button" className="btn-secondary" onClick={() => loadActive()} disabled={tabBusy || !current}>
                    <RefreshCw size={16} className={tabBusy ? 'animate-spin' : ''} /> Refresh
                  </button>
                </>
              }
            />
            <div className="p-4 pt-0 space-y-3">
              {!current && (
                <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Select a MikroTik router in the top bar to load live PPP active sessions.
                </div>
              )}
              {tabError && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{tabError}</div>}
              <DataTable
                columns={[
                  { key: 'user', label: 'Username' },
                  { key: 'customer', label: 'Customer' },
                  { key: 'profile', label: 'Profile' },
                  { key: 'addr', label: 'Address' },
                  { key: 'traffic', label: (
                    <span>
                      Traffic <span className="text-emerald-600">↓</span>/<span className="text-sky-600">↑</span>
                    </span>
                  ) },
                  { key: 'uptime', label: 'Uptime' },
                  { key: 'caller', label: 'Caller ID (MAC)' },
                ]}
                rows={active
                  .filter((a) => {
                    const q = search.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      String(a.username || '').toLowerCase().includes(q) ||
                      String(a.customer || '').toLowerCase().includes(q) ||
                      String(a.address || '').toLowerCase().includes(q) ||
                      String(a.caller || '').toLowerCase().includes(q) ||
                      String(a.profile || '').toLowerCase().includes(q)
                    );
                  })
                  .map((a, i) => {
                    const down = Number(a.downloadBps) || 0;
                    const up = Number(a.uploadBps) || 0;
                    return {
                      key: i,
                      sortValues: {
                        user: a.username,
                        customer: a.customer,
                        profile: a.profile,
                        addr: a.address,
                        traffic: down + up,
                        uptime: a.uptime,
                        caller: a.caller,
                      },
                      cells: [
                        <span className="font-semibold text-slate-800">{a.username}</span>,
                        a.customer,
                        a.profile,
                        <span className="font-mono text-xs">{a.address}</span>,
                        <TrafficPair downloadBps={down} uploadBps={up} />,
                        a.uptime,
                        <span className="font-mono text-sm text-sky-700">{a.caller}</span>,
                      ],
                    };
                  })}
                emptyMessage={current ? 'No active PPP sessions on this router.' : 'Select a router to view active connections.'}
              />
            </div>
          </>
        )}

        {tab === 'profiles' && (
          <>
            <Toolbar
              left={<span>PPP Profiles <span className="font-semibold text-slate-800">{profiles.length}</span></span>}
              right={
                <>
                  <button type="button" className="btn-secondary" onClick={loadProfiles} disabled={tabBusy}>
                    <RefreshCw size={16} /> Refresh
                  </button>
                  <button type="button" className="btn-primary" onClick={() => setShowProfileAdd(true)}>
                    <Plus size={16} /> Add Profile
                  </button>
                </>
              }
            />
            <div className="p-4 pt-0">
              <DataTable
                columns={[
                  { key: 'name', label: 'Name' },
                  { key: 'rate', label: 'Rate Limit' },
                  { key: 'price', label: 'Price' },
                  { key: 'type', label: 'Type' },
                  { key: 'actions', label: 'Actions', align: 'right' },
                ]}
                rows={profiles.map((p) => ({
                  key: p.id || p.name,
                  cells: [
                    <span className="font-medium text-slate-800">{p.name}</span>,
                    <span className="font-mono text-xs">{p.rateLimit || '—'}</span>,
                    peso(p.price),
                    p.type || 'pppoe',
                    <div className="flex justify-end gap-1">
                      <IconAction icon={Pencil} title="Edit" tone="sky" onClick={() => setProfileEdit(p)} />
                      <IconAction icon={Trash2} title="Delete" tone="rose" onClick={() => deleteProfile(p)} />
                    </div>,
                  ],
                }))}
                emptyMessage="No profiles. Fetch from MikroTik or add one."
              />
            </div>
          </>
        )}

        {tab === 'servers' && (
          <>
            <Toolbar
              left={
                <span>
                  PPPoE Servers <span className="font-semibold text-slate-800">{servers.length}</span>
                  {current ? <span className="text-xs text-slate-400 ml-2">from {current.name}</span> : null}
                </span>
              }
              right={
                <button type="button" className="btn-secondary" onClick={loadServers} disabled={tabBusy || !current}>
                  <RefreshCw size={16} className={tabBusy ? 'animate-spin' : ''} /> Refresh
                </button>
              }
            />
            <div className="p-4 pt-0 space-y-3">
              {!current && (
                <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Select a MikroTik router to load configured PPPoE servers (/interface/pppoe-server/server).
                </div>
              )}
              {tabError && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{tabError}</div>}
              <DataTable
                columns={[
                  { key: 'name', label: 'Service Name' },
                  { key: 'iface', label: 'Interface' },
                  { key: 'max', label: 'Max Sessions' },
                  { key: 'svc', label: 'Service' },
                  { key: 'auth', label: 'Authentication' },
                  { key: 'status', label: 'Status' },
                ]}
                rows={servers.map((s, i) => ({
                  key: s.id || i,
                  cells: [
                    <span className="font-medium text-slate-800">{s.name || '—'}</span>,
                    s.interface,
                    s.maxSessions || '—',
                    s.service,
                    <span className="font-mono text-xs">{s.authentication}</span>,
                    <StatusBadge status={s.status} />,
                  ],
                }))}
                emptyMessage={current ? 'No PPPoE servers configured on this router.' : 'Select a router to view PPPoE servers.'}
              />
            </div>
          </>
        )}

        {tab === 'plans' && (
          <>
            <Toolbar
              left={<span>Billing Plans <span className="font-semibold text-slate-800">{plans.length}</span></span>}
              right={
                <>
                  <button type="button" className="btn-secondary" onClick={loadPlans}>
                    <RefreshCw size={16} /> Refresh
                  </button>
                  <button type="button" className="btn-primary" onClick={() => setShowPlanAdd(true)}>
                    <Plus size={16} /> Add New Plan
                  </button>
                </>
              }
            />
            <div className="p-4 pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                {plans.map((p) => (
                  <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-slate-900 text-lg">{p.name}</div>
                        <div className="text-xs text-slate-400 font-mono mt-0.5">{p.rateLimit || 'No rate limit'}</div>
                      </div>
                      <div className="flex gap-1">
                        <IconAction icon={Pencil} title="Edit plan" tone="sky" onClick={() => setPlanEdit(p)} />
                        <IconAction icon={Trash2} title="Delete plan" tone="rose" onClick={() => deletePlan(p)} />
                      </div>
                    </div>
                    <div className="mt-4 text-2xl font-bold text-brand-600">{peso(p.price)}<span className="text-sm font-medium text-slate-400">/mo</span></div>
                  </div>
                ))}
              </div>
              {plans.length === 0 && <div className="text-sm text-slate-400 py-8 text-center">No billing plans yet. Click Add New Plan.</div>}
            </div>
          </>
        )}
      </Card>

      {showAdd && (
        <UserFormModal
          service={service}
          profiles={profiles}
          naps={undefined}
          editUser={null}
          routerId={current?.id}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            showToast('User created.');
            loadUsers();
          }}
        />
      )}

      {editFor && (
        <UserFormModal
          service={service}
          profiles={profiles}
          naps={undefined}
          editUser={editFor}
          routerId={current?.id}
          onClose={() => setEditFor(null)}
          onSaved={() => {
            setEditFor(null);
            showToast('User details updated.');
            loadUsers();
          }}
        />
      )}

      {payFor && (
        <ProcessPaymentModal
          user={payFor}
          profiles={profiles}
          onClose={() => setPayFor(null)}
          onPaid={(msg) => {
            setPayFor(null);
            showToast(msg);
            loadUsers();
          }}
        />
      )}

      {(showProfileAdd || profileEdit) && (
        <ProfileFormModal
          initial={profileEdit}
          routerId={current?.id}
          onClose={() => {
            setShowProfileAdd(false);
            setProfileEdit(null);
          }}
          onSaved={() => {
            setShowProfileAdd(false);
            setProfileEdit(null);
            showToast(profileEdit ? 'Profile updated.' : 'Profile created.');
            loadProfiles();
            loadPlans();
          }}
        />
      )}

      {(showPlanAdd || planEdit) && (
        <PlanFormModal
          initial={planEdit}
          onClose={() => {
            setShowPlanAdd(false);
            setPlanEdit(null);
          }}
          onSaved={() => {
            setShowPlanAdd(false);
            setPlanEdit(null);
            showToast(planEdit ? 'Plan updated.' : 'Plan created.');
            loadPlans();
            loadProfiles();
          }}
        />
      )}

      <Toast message={toast} />
    </Layout>
  );
}

function ProfileFormModal({
  initial,
  routerId,
  onClose,
  onSaved,
}: {
  initial: any | null;
  routerId?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial?.id && Number.isFinite(Number(initial.id));
  const [name, setName] = useState(initial?.name || '');
  const [rateLimit, setRateLimit] = useState(initial?.rateLimit || '');
  const [price, setPrice] = useState(String(initial?.price ?? 0));
  const [localAddress, setLocalAddress] = useState(initial?.localAddress || '');
  const [remoteAddress, setRemoteAddress] = useState(initial?.remoteAddress || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        rateLimit: rateLimit.trim(),
        price: Number(price) || 0,
        localAddress: localAddress.trim() || undefined,
        remoteAddress: remoteAddress.trim() || undefined,
        routerId,
        mikrotikId: initial?.mikrotikId,
      };
      if (isEdit) await api.put(`/pppoe/profiles/${initial.id}`, payload);
      else await api.post('/pppoe/profiles', payload);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? 'Edit Profile' : 'Add Profile'}
      subtitle="Creates/updates /ppp/profile on the selected MikroTik when credentials are set."
      onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onConfirm={save} confirmLabel={isEdit ? 'Save Changes' : 'Add Profile'} busy={busy} />}
    >
      {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 mb-4">{error}</div>}
      <div className="space-y-4">
        <FormField label="Profile Name" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Rate Limit" hint="e.g. 15M/15M or 10M/50M">
          <input className="input font-mono" value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} placeholder="15M/15M" />
        </FormField>
        <FormField label="Local Address">
          <input className="input font-mono" value={localAddress} onChange={(e) => setLocalAddress(e.target.value)} />
        </FormField>
        <FormField label="Remote Address">
          <input className="input font-mono" value={remoteAddress} onChange={(e) => setRemoteAddress(e.target.value)} />
        </FormField>
        <FormField label="Panel Price (optional)">
          <input className="input" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}

function PlanFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial?.id;
  const [name, setName] = useState(initial?.name || '');
  const [rateLimit, setRateLimit] = useState(initial?.rateLimit || '');
  const [price, setPrice] = useState(String(initial?.price ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!name.trim()) {
      setError('Plan name is required');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = { name: name.trim(), rateLimit: rateLimit.trim(), price: Number(price) || 0 };
      if (isEdit) await api.put(`/billing-plans/${initial.id}`, payload);
      else await api.post('/billing-plans', payload);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? 'Edit Billing Plan' : 'Add New Plan'}
      subtitle="Panel pricing used for payments and receipts."
      onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onConfirm={save} confirmLabel={isEdit ? 'Save Changes' : 'Create Plan'} busy={busy} />}
    >
      {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 mb-4">{error}</div>}
      <div className="space-y-4">
        <FormField label="Plan Name" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. UNLI500" autoFocus />
        </FormField>
        <FormField label="Rate Limit" hint="Shown on cards; match a PPP profile when possible.">
          <input className="input font-mono" value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} placeholder="25M/25M" />
        </FormField>
        <FormField label="Monthly Price" required>
          <input className="input" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="999" />
        </FormField>
      </div>
    </Modal>
  );
}

function printReceipt(receipt: any) {
  const line = (a: string, b: string) => `<div style="display:flex;justify-content:space-between;margin:2px 0"><span>${a}</span><span>${b}</span></div>`;
  const html = `<!doctype html><html><head><title>Receipt ${receipt.account}</title>
    <style>body{font-family:Arial,sans-serif;color:#111;padding:24px;max-width:360px;margin:auto}
    h2{margin:0 0 2px} .muted{color:#666;font-size:12px} hr{border:none;border-top:1px dashed #bbb;margin:10px 0}
    .tot{display:flex;justify-content:space-between;font-weight:700;font-size:16px;margin-top:6px}</style></head>
    <body>
      <h2>${receipt.company}</h2><div class="muted">Official Payment Receipt</div><hr/>
      ${line('Account #', receipt.account)}
      ${line('Customer', receipt.customer)}
      ${line('Plan', `${receipt.plan} × ${receipt.months} mo`)}
      ${line('Payment date', receipt.paymentDate)}
      ${line('Next due date', receipt.newDue)}
      <hr/>
      ${line('Subtotal', `\u20b1${receipt.subtotal.toFixed(2)}`)}
      ${line(`Discount (${receipt.discountDays} day/s downtime)`, `- \u20b1${receipt.discount.toFixed(2)}`)}
      <div class="tot"><span>TOTAL</span><span>\u20b1${receipt.total.toFixed(2)}</span></div>
      <hr/><div class="muted">Thank you for your payment.</div>
      <script>window.onload=function(){window.print();}</script>
    </body></html>`;
  const w = window.open('', '_blank', 'width=420,height=640');
  if (w) {
    w.document.write(html);
    w.document.close();
  }
}

function ProcessPaymentModal({ user, profiles, onClose, onPaid }: { user: PUser; profiles: any[]; onClose: () => void; onPaid: (msg: string) => void }) {
  const [plan, setPlan] = useState(user.profile || profiles[0]?.name || '');
  const [months, setMonths] = useState(1);
  const [nonPaymentProfile, setNonPaymentProfile] = useState('default');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [discountDays, setDiscountDays] = useState(0);
  const [sendReceipt, setSendReceipt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const planPrice = profiles.find((p) => p.name === plan)?.price ?? user.price ?? 0;
  const subtotal = planPrice * months;
  const discount = Math.round((planPrice / 30) * Math.max(0, discountDays) * 100) / 100;
  const total = Math.max(0, subtotal - discount);
  const hasEmail = !!user.email;

  const pay = async () => {
    setSaving(true);
    setError('');
    try {
      const r = await api.post(`/pppoe/users/${user.id}/payment`, {
        months,
        plan,
        expiration_profile: nonPaymentProfile,
        payment_date: paymentDate,
        discount_days: discountDays,
        send_receipt: sendReceipt,
      });
      printReceipt(r.data.receipt);
      onPaid(
        `Payment of ${peso(r.data.total)} recorded for ${user.username}. Due ${r.data.previousDue} \u2192 ${r.data.subscriptionDue}${r.data.emailed ? ' · receipt emailed' : ''}`
      );
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Payment failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Process Payment"
      subtitle={`For user: ${user.username}`}
      onClose={onClose}
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={pay}
          confirmLabel="Process Payment & Print"
          busy={saving}
        />
      }
    >
      {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 mb-4">{error}</div>}

      <div className="space-y-4">
        <FormField label="Billing Plan">
          <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
            {profiles.map((p) => <option key={p.id} value={p.name}>{p.name} ({peso(p.price)})</option>)}
          </select>
        </FormField>

        <div>
          <span className="text-sm font-medium text-slate-700 mb-2 block">Months of Extension</span>
          <div className="flex flex-wrap items-center gap-2">
            {[1, 2, 3, 6, 12].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonths(m)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${months === m ? 'bg-brand-500 text-white border-brand-500 shadow-glow-sm' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {m}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">Extends expiration by whole month(s) from the current due date.</span>
        </div>

        <FormField label="Non-Payment Profile" hint="Profile to apply on due date.">
          <select className="input" value={nonPaymentProfile} onChange={(e) => setNonPaymentProfile(e.target.value)}>
            <option value="default">default</option>
            {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </FormField>

        <FormField label="Payment Date">
          <input className="input" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </FormField>

        <FormField label="Discount for Downtime (Days)">
          <input className="input" type="number" min={0} value={discountDays} onChange={(e) => setDiscountDays(Math.max(0, Number(e.target.value)))} />
        </FormField>

        <label className="flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
          <span>
            <span className="text-sm font-medium text-slate-700 block">Send receipt to email</span>
            <span className="text-xs text-slate-400">{hasEmail ? user.email : 'No email set in account details.'}</span>
          </span>
          <input type="checkbox" className="mt-1 w-4 h-4 accent-brand-500" disabled={!hasEmail} checked={sendReceipt && hasEmail} onChange={(e) => setSendReceipt(e.target.checked)} />
        </label>

        <div className="border-t border-slate-100 pt-3 text-sm space-y-1 rounded-xl bg-slate-50 p-4">
          <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{peso(subtotal)}</span></div>
          <div className="flex justify-between text-slate-500"><span>Discount</span><span>- {peso(discount)}</span></div>
          <div className="flex justify-between items-center pt-1">
            <span className="font-bold text-slate-800">TOTAL</span>
            <span className="font-bold text-slate-900 text-lg">{peso(total)}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function UserFormModal({
  service,
  profiles,
  editUser,
  routerId,
  onClose,
  onSaved,
}: {
  service: string;
  profiles: any[];
  naps?: any;
  editUser?: PUser | null;
  routerId?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editUser;
  const defaultPlan = profiles.find((p) => p.name === 'UNLI500')?.name || profiles[0]?.name || '15mbps';
  const defaultExpire =
    profiles.find((p) => /non.?pay/i.test(String(p.name)))?.name || 'non-payments';
  const [form, setForm] = useState({
    username: '',
    password: '',
    profile: defaultPlan,
    subscription_due: '',
    expiration_profile: defaultExpire,
    customer_name: '',
    address: '',
    contact: '',
    email: '',
    nap_id: '',
    plc_port: '',
    lat: DEFAULT_PIN[0] as number | null,
    lng: DEFAULT_PIN[1] as number | null,
  });
  const [showPass, setShowPass] = useState(false);
  const [naps, setNaps] = useState<any[]>([]);
  const [showLoc, setShowLoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/naps').then((r) => setNaps(r.data));
    if (editUser) {
      api.get(`/pppoe/users/${editUser.id}`).then((r) => {
        const u = r.data;
        setForm({
          username: u.username || '',
          password: u.password || '',
          profile: u.profile || defaultPlan,
          subscription_due: (u.subscription_due || '').slice(0, 10),
          expiration_profile: u.expiration_profile || defaultExpire,
          customer_name: u.customer_name || '',
          address: u.address || '',
          contact: u.contact || '',
          email: u.email || '',
          nap_id: u.nap_id ? String(u.nap_id) : '',
          plc_port: u.plc_port || '',
          lat: u.lat ?? null,
          lng: u.lng ?? null,
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const selectedNap = naps.find((n) => String(n.id) === String(form.nap_id));
  const topology = selectedNap
    ? `${selectedNap.oltName || 'OLT'} \u2192 ${selectedNap.name}${form.plc_port ? ` \u2192 Port ${form.plc_port}` : ''}`
    : '-';

  const save = async () => {
    if (!form.username.trim()) {
      setError('Username is required');
      return;
    }
    if (!isEdit && !form.password.trim()) {
      setError('Password is required to create the MikroTik PPP secret');
      return;
    }
    if (!isEdit && !routerId) {
      setError('Select a router in the top bar before adding a user.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        nap_id: form.nap_id ? Number(form.nap_id) : null,
        service,
        routerId: routerId || undefined,
      };
      if (isEdit) {
        await api.put(`/pppoe/users/${editUser!.id}`, payload);
      } else {
        await api.post('/pppoe/users', payload);
      }
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        title={isEdit ? 'Edit User' : 'Add New User'}
        onClose={onClose}
        wide
        footer={
          <ModalFooter onCancel={onClose} onConfirm={save} confirmLabel={isEdit ? 'Save Changes' : 'Create User'} busy={saving} />
        }
      >
        {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 mb-4">{error}</div>}

        <div className="space-y-4">
          <FormField label="Username" required>
            <input
              className={`input ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`}
              value={form.username}
              onChange={(e) => set({ username: e.target.value })}
              readOnly={isEdit}
              autoFocus={!isEdit}
            />
          </FormField>

          <FormField label="Password">
            <div className="relative">
              <input
                className="input pr-10"
                type={showPass ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
              />
              <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </FormField>

          <FormField label="Billing Plan">
            <select className="input" value={form.profile} onChange={(e) => set({ profile: e.target.value })}>
              {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Expiration Date">
              <input className="input" type="date" value={form.subscription_due} onChange={(e) => set({ subscription_due: e.target.value })} />
            </FormField>
            <FormField label="Expiration Profile">
              <select className="input" value={form.expiration_profile} onChange={(e) => set({ expiration_profile: e.target.value })}>
                <option value="non-payments">non-payments</option>
                <option value="default">default</option>
                {profiles.filter((p) => !/^(non-payments|default)$/i.test(String(p.name))).map((p) => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="pt-1 border-t border-slate-100" />
          <h4 className="font-semibold text-slate-800">Customer Information (Optional)</h4>

          <FormField label="Full Name">
            <input className="input" value={form.customer_name} onChange={(e) => set({ customer_name: e.target.value })} />
          </FormField>
          <FormField label="Full Address">
            <input className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Contact Number">
              <input className="input" value={form.contact} onChange={(e) => set({ contact: e.target.value })} />
            </FormField>
            <FormField label="Email">
              <input className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </FormField>
          </div>

          <FormField label="NAP (Optional)">
            <select className="input" value={form.nap_id} onChange={(e) => set({ nap_id: e.target.value })}>
              <option value="">-- None --</option>
              {naps.map((n) => <option key={n.id} value={n.id}>{n.name}{n.oltName ? ` (${n.oltName})` : ''}</option>)}
            </select>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="PLC Port (Optional)">
              <input className="input" placeholder="e.g. 1, 2, 3…" value={form.plc_port} onChange={(e) => set({ plc_port: e.target.value })} />
            </FormField>
            <FormField label="Linked (Read-only)">
              <div className="input bg-slate-50 text-slate-500 truncate" title={topology}>Topology: {topology}</div>
            </FormField>
          </div>

          <div className="pt-1 border-t border-slate-100" />
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-slate-800">Map Location (Optional)</h4>
            <button type="button" onClick={() => setShowLoc(true)} className="btn-secondary text-xs py-1.5">
              <MapPin size={15} /> Edit Location
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Latitude">
              <div className="input bg-slate-50 text-slate-600 truncate">{form.lat != null ? Number(form.lat).toFixed(6) : '—'}</div>
            </FormField>
            <FormField label="Longitude">
              <div className="input bg-slate-50 text-slate-600 truncate">{form.lng != null ? Number(form.lng).toFixed(6) : '—'}</div>
            </FormField>
          </div>
          <button
            type="button"
            onClick={() => setShowLoc(true)}
            className="w-full h-20 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:bg-brand-50/50 hover:text-brand-600 hover:border-brand-300 flex items-center justify-center gap-2 text-sm transition-colors"
          >
            <MapPin size={18} /> {form.lat != null ? 'Open map to adjust the pin' : 'Open map to set a location'}
          </button>
        </div>
      </Modal>

      {showLoc && (
        <LocationEditor
          initial={{ lat: form.lat, lng: form.lng }}
          onDone={(c) => {
            set({ lat: c.lat, lng: c.lng });
            setShowLoc(false);
          }}
          onCancel={() => setShowLoc(false)}
        />
      )}
    </>
  );
}
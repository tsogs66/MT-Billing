import { useEffect, useMemo, useState } from 'react';
import {
  Users, WifiOff, Activity, Layers, Server, ReceiptText, Plus, Pencil, Trash2,
  RefreshCw, Lock, Unlock, Banknote,
} from 'lucide-react';
import Layout from '../components/Layout';
import {
  StatusBadge, TabBar, Toolbar, SearchInput, DataTable, IconAction, Toast,
  Modal, ModalFooter, FormField, Card,
} from '../components/ui';
import { api, peso } from '../api';
import { useRouterDevice } from '../context/RouterContext';
import { TrafficPair } from '../lib/traffic';

const TABS = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'offline', label: 'Offline', icon: WifiOff },
  { key: 'active', label: 'Active Connections', icon: Activity },
  { key: 'profiles', label: 'Profiles', icon: Layers },
  { key: 'servers', label: 'Servers', icon: Server },
  { key: 'plans', label: 'Billing Plans', icon: ReceiptText },
];

export default function IPoE() {
  const [tab, setTab] = useState('users');
  const [leases, setLeases] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [editLease, setEditLease] = useState<any | null>(null);
  const [payLease, setPayLease] = useState<any | null>(null);
  const [profileEdit, setProfileEdit] = useState<any | null>(null);
  const [showProfileAdd, setShowProfileAdd] = useState(false);
  const [serverEdit, setServerEdit] = useState<any | null>(null);
  const [showServerAdd, setShowServerAdd] = useState(false);
  const [planEdit, setPlanEdit] = useState<any | null>(null);
  const [showPlanAdd, setShowPlanAdd] = useState(false);
  const { current } = useRouterDevice();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 5000);
  };

  const loadLeases = (filter?: string, opts?: { silent?: boolean }) => {
    if (!current) {
      setLeases([]);
      return Promise.resolve();
    }
    if (!opts?.silent) {
      setBusy(true);
      setError('');
    }
    const f = filter || (tab === 'offline' ? 'offline' : tab === 'active' ? 'online' : 'all');
    return api
      .get('/ipoe/leases', { params: { routerId: current.id, filter: f } })
      .then((r) => {
        setLeases(r.data.leases || []);
        if (r.data.plans) setPlans(r.data.plans);
        if (r.data.profiles) setProfiles(r.data.profiles);
        if (r.data.error) setError(r.data.error);
      })
      .catch((e) => {
        if (!opts?.silent) {
          setLeases([]);
          setError(e?.response?.data?.error || 'Could not load DHCP leases');
        }
      })
      .finally(() => {
        if (!opts?.silent) setBusy(false);
      });
  };

  const loadProfiles = () => api.get('/ipoe/profiles').then((r) => setProfiles(r.data)).catch(() => setProfiles([]));
  const loadPlans = () => api.get('/ipoe/plans').then((r) => setPlans(r.data)).catch(() => setPlans([]));
  const loadServers = () => {
    if (!current) {
      setServers([]);
      return Promise.resolve();
    }
    setBusy(true);
    setError('');
    return api
      .get('/ipoe/servers', { params: { routerId: current.id } })
      .then((r) => {
        setServers(r.data.servers || []);
        if (r.data.error) setError(r.data.error);
      })
      .catch((e) => {
        setServers([]);
        setError(e?.response?.data?.error || 'Could not load DHCP servers');
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    setSearch('');
    setError('');
    if (tab === 'users' || tab === 'offline' || tab === 'active') loadLeases();
    if (tab === 'profiles') loadProfiles();
    if (tab === 'servers') loadServers();
    if (tab === 'plans') {
      loadPlans();
      loadProfiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, current?.id]);

  // Live traffic poll on Users / Offline / Active
  useEffect(() => {
    if (!current?.id) return;
    if (tab !== 'users' && tab !== 'offline' && tab !== 'active') return;
    const id = setInterval(() => loadLeases(undefined, { silent: true }), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, current?.id]);

  const filteredLeases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leases;
    return leases.filter(
      (l) =>
        String(l.name || '').toLowerCase().includes(q) ||
        String(l.address || '').toLowerCase().includes(q) ||
        String(l.mac || '').toLowerCase().includes(q) ||
        String(l.host || '').toLowerCase().includes(q) ||
        String(l.server || '').toLowerCase().includes(q) ||
        String(l.plan || '').toLowerCase().includes(q)
    );
  }, [leases, search]);

  const changePlan = async (lease: any, plan: string) => {
    try {
      await api.put(`/ipoe/leases/${encodeURIComponent(lease.mac)}`, { plan, routerId: current?.id });
      loadLeases();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Could not update plan');
    }
  };

  const toggleBlock = async (lease: any) => {
    try {
      await api.post(`/ipoe/leases/${encodeURIComponent(lease.mac)}/toggle-block`, {
        routerId: current?.id,
        id: lease.id,
        blocked: !lease.blocked,
      });
      showToast(lease.blocked ? 'Lease unblocked' : 'Lease blocked');
      loadLeases();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Toggle failed');
    }
  };

  const sectionTitle =
    tab === 'users' ? 'DHCP Leases' : tab === 'offline' ? 'Offline Leases' : tab === 'active' ? 'Active Connections' : '';
  const sectionSub =
    tab === 'users'
      ? 'List of MikroTik DHCP leases.'
      : tab === 'offline'
        ? 'List of Offline (waiting) DHCP leases.'
        : tab === 'active'
          ? 'List of Online (bound) DHCP leases.'
          : '';

  const leaseColumns = [
    { key: 'name', label: 'Name' },
    { key: 'address', label: 'IP Address' },
    { key: 'mac', label: 'MAC' },
    { key: 'host', label: 'Host' },
    { key: 'plan', label: 'Billing Plan' },
    { key: 'speed', label: tab === 'offline' ? 'Speed' : (
      <span>
        Traffic <span className="text-emerald-600">↓</span>/<span className="text-sky-600">↑</span>
      </span>
    ) },
    { key: 'due', label: 'Due' },
    { key: 'payment', label: 'Payment' },
    { key: 'status', label: 'Status' },
    { key: 'server', label: 'Server' },
    { key: 'expires', label: 'Expires' },
    { key: 'lastSeen', label: 'Last Seen' },
    { key: 'actions', label: 'Actions', align: 'right' as const, sortable: false },
  ];

  const leaseRows = filteredLeases.map((l) => ({
    key: l.id || l.mac,
    sortValues: {
      name: l.name,
      address: l.address,
      mac: l.mac,
      host: l.host,
      plan: l.plan,
      speed: (Number(l.downloadBps) || 0) + (Number(l.uploadBps) || 0) || l.downloadMbps || 0,
      due: l.due,
      payment: l.payment,
      status: l.status,
      server: l.server,
      expires: l.expires,
      lastSeen: l.lastSeen,
    },
    cells: [
      <span className="font-semibold text-slate-800">{l.name}</span>,
      <span className="font-mono text-xs">{l.address}</span>,
      <span className="font-mono text-xs">{l.mac}</span>,
      l.host,
      <select
        className="input py-1 text-xs min-w-[110px]"
        value={l.plan || ''}
        onChange={(e) => changePlan(l, e.target.value)}
      >
        <option value="">—</option>
        {plans.map((p: any) => (
          <option key={p.id || p.name} value={p.name}>{p.name}</option>
        ))}
      </select>,
      <span className="text-xs font-medium text-slate-700 whitespace-nowrap">
        {l.online && (Number(l.downloadBps) > 0 || Number(l.uploadBps) > 0 || tab === 'active' || tab === 'users')
          ? <TrafficPair downloadBps={l.downloadBps} uploadBps={l.uploadBps} />
          : l.speed}
      </span>,
      <span className="text-xs text-slate-500 whitespace-nowrap">{l.due || '—'}</span>,
      <StatusBadge status={l.payment || 'Active'} />,
      <StatusBadge status={l.status} />,
      <span className="text-xs">{l.server}</span>,
      <span className="text-xs font-mono">{l.expires || '—'}</span>,
      <span className="text-xs font-mono">{l.lastSeen || '—'}</span>,
      <div className="flex justify-end gap-1">
        <IconAction icon={Pencil} title="Edit" tone="sky" onClick={() => setEditLease(l)} />
        <IconAction icon={Banknote} title="Payment" tone="emerald" onClick={() => setPayLease(l)} />
        <IconAction
          icon={l.blocked ? Unlock : Lock}
          title={l.blocked ? 'Unblock' : 'Block'}
          tone={l.blocked ? 'emerald' : 'rose'}
          onClick={() => toggleBlock(l)}
        />
      </div>,
    ],
  }));

  return (
    <Layout title="IPoE Management">
      <Card noPadding interactive className="overflow-hidden">
        <TabBar tabs={TABS} active={tab} onChange={setTab} className="px-2" />

        {(tab === 'users' || tab === 'offline' || tab === 'active') && (
          <>
            <Toolbar
              left={
                <div>
                  <div className="font-semibold text-slate-800">{sectionTitle}</div>
                  <div className="text-xs text-slate-400">{sectionSub}</div>
                </div>
              }
              right={
                <>
                  <SearchInput value={search} onChange={setSearch} placeholder="Search IP / MAC / Host…" className="w-64" />
                  <button type="button" className="btn-secondary" onClick={() => loadLeases()} disabled={busy || !current}>
                    <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> Refresh
                  </button>
                </>
              }
            />
            <div className="p-4 pt-0 space-y-3">
              {!current && (
                <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Select a MikroTik router with API credentials to load DHCP leases.
                </div>
              )}
              {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
              <DataTable columns={leaseColumns} rows={leaseRows} emptyMessage="No DHCP leases found." stickyHeader />
            </div>
          </>
        )}

        {tab === 'profiles' && (
          <>
            <Toolbar
              left={
                <div>
                  <div className="font-semibold text-slate-800">IPoE Profiles</div>
                  <div className="text-xs text-slate-400">Speed profiles for IPoE billing plans.</div>
                </div>
              }
              right={
                <button type="button" className="btn-primary" onClick={() => setShowProfileAdd(true)}>
                  <Plus size={16} /> Add Profile
                </button>
              }
            />
            <div className="p-4 pt-0">
              <DataTable
                columns={[
                  { key: 'name', label: 'Name' },
                  { key: 'down', label: 'Download (Mbps)' },
                  { key: 'up', label: 'Upload (Mbps)' },
                  { key: 'max', label: 'Max Limit' },
                  { key: 'actions', label: 'Actions', align: 'right', sortable: false },
                ]}
                rows={profiles.map((p: any) => ({
                  key: p.id,
                  sortValues: { name: p.name, down: p.downloadMbps, up: p.uploadMbps, max: p.maxLimit },
                  cells: [
                    <span className="font-medium text-slate-800">{p.name}</span>,
                    p.downloadMbps,
                    p.uploadMbps,
                    <span className="font-mono text-xs">{p.maxLimit}</span>,
                    <div className="flex justify-end gap-1">
                      <IconAction icon={Pencil} title="Edit" tone="sky" onClick={() => setProfileEdit(p)} />
                      <IconAction
                        icon={Trash2}
                        title="Delete"
                        tone="rose"
                        onClick={async () => {
                          if (!confirm(`Delete profile "${p.name}"?`)) return;
                          try {
                            await api.delete(`/ipoe/profiles/${p.id}`);
                            loadProfiles();
                          } catch (e: any) {
                            showToast(e?.response?.data?.error || 'Delete failed');
                          }
                        }}
                      />
                    </div>,
                  ],
                }))}
                emptyMessage="No IPoE profiles yet."
              />
            </div>
          </>
        )}

        {tab === 'servers' && (
          <>
            <Toolbar
              left={
                <div>
                  <div className="font-semibold text-slate-800">DHCP Servers</div>
                  <div className="text-xs text-slate-400">Manage existing MikroTik DHCP servers and add new ones.</div>
                </div>
              }
              right={
                <>
                  <button type="button" className="btn-secondary" onClick={loadServers} disabled={!current || busy}>
                    <RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> Refresh
                  </button>
                  <button type="button" className="btn-primary" onClick={() => setShowServerAdd(true)} disabled={!current}>
                    <Plus size={16} /> Add DHCP Server
                  </button>
                </>
              }
            />
            <div className="p-4 pt-0 space-y-3">
              {!current && (
                <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Select a MikroTik router to load DHCP servers.
                </div>
              )}
              {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
              <DataTable
                columns={[
                  { key: 'name', label: 'Name' },
                  { key: 'iface', label: 'Interface' },
                  { key: 'pool', label: 'Pool' },
                  { key: 'lease', label: 'Lease' },
                  { key: 'status', label: 'Status' },
                  { key: 'actions', label: 'Actions', align: 'right', sortable: false },
                ]}
                rows={servers.map((s: any) => ({
                  key: s.id,
                  sortValues: { name: s.name, iface: s.interface, pool: s.pool, lease: s.lease, status: s.status },
                  cells: [
                    <span className="font-medium text-slate-800">{s.name}</span>,
                    s.interface,
                    s.pool,
                    s.lease,
                    <span className={s.disabled ? 'text-rose-600' : 'text-emerald-600 font-medium'}>{s.status}</span>,
                    <div className="flex justify-end gap-1">
                      <IconAction icon={Pencil} title="Edit" tone="sky" onClick={() => setServerEdit(s)} />
                      <IconAction
                        icon={Trash2}
                        title="Delete"
                        tone="rose"
                        onClick={async () => {
                          if (!confirm(`Delete DHCP server "${s.name}"?`)) return;
                          try {
                            await api.delete(`/ipoe/servers/${encodeURIComponent(s.id)}`, { params: { routerId: current?.id } });
                            loadServers();
                          } catch (e: any) {
                            showToast(e?.response?.data?.error || 'Delete failed');
                          }
                        }}
                      />
                    </div>,
                  ],
                }))}
                emptyMessage="No DHCP servers on this router."
              />
            </div>
          </>
        )}

        {tab === 'plans' && (
          <>
            <Toolbar
              left={
                <div>
                  <div className="font-semibold text-slate-800">IPoE Billing Plans</div>
                  <div className="text-xs text-slate-400">Billing plans for IPoE leases (separate from PPPoE).</div>
                </div>
              }
              right={
                <button type="button" className="btn-primary" onClick={() => setShowPlanAdd(true)}>
                  <Plus size={16} /> Add Plan
                </button>
              }
            />
            <div className="p-4 pt-0">
              <DataTable
                columns={[
                  { key: 'name', label: 'Name' },
                  { key: 'price', label: 'Price' },
                  { key: 'cycle', label: 'Cycle' },
                  { key: 'profile', label: 'Profile' },
                  { key: 'speed', label: 'Speed' },
                  { key: 'actions', label: 'Actions', align: 'right', sortable: false },
                ]}
                rows={plans.map((p: any) => ({
                  key: p.id,
                  sortValues: { name: p.name, price: p.price, cycle: p.cycle, profile: p.profile, speed: p.downloadMbps },
                  cells: [
                    <span className="font-medium text-slate-800">{p.name}</span>,
                    peso(p.price),
                    p.cycle,
                    p.profile || '—',
                    p.speed || `${p.downloadMbps}↓ / ${p.uploadMbps}↑ Mbps`,
                    <div className="flex justify-end gap-1">
                      <IconAction icon={Pencil} title="Edit" tone="sky" onClick={() => setPlanEdit(p)} />
                      <IconAction
                        icon={Trash2}
                        title="Delete"
                        tone="rose"
                        onClick={async () => {
                          if (!confirm(`Delete plan "${p.name}"?`)) return;
                          await api.delete(`/ipoe/plans/${p.id}`);
                          loadPlans();
                        }}
                      />
                    </div>,
                  ],
                }))}
                emptyMessage="No IPoE billing plans yet."
              />
            </div>
          </>
        )}
      </Card>

      {editLease && (
        <LeaseEditModal
          lease={editLease}
          plans={plans}
          onClose={() => setEditLease(null)}
          onSaved={() => {
            setEditLease(null);
            showToast('Lease updated');
            loadLeases();
          }}
        />
      )}
      {payLease && (
        <LeasePayModal
          lease={payLease}
          plans={plans}
          onClose={() => setPayLease(null)}
          onSaved={() => {
            setPayLease(null);
            showToast('Payment recorded');
            loadLeases();
          }}
        />
      )}
      {(showProfileAdd || profileEdit) && (
        <IpoeProfileModal
          initial={profileEdit}
          onClose={() => { setShowProfileAdd(false); setProfileEdit(null); }}
          onSaved={() => { setShowProfileAdd(false); setProfileEdit(null); loadProfiles(); showToast('Profile saved'); }}
        />
      )}
      {(showServerAdd || serverEdit) && (
        <DhcpServerModal
          initial={serverEdit}
          routerId={current?.id}
          onClose={() => { setShowServerAdd(false); setServerEdit(null); }}
          onSaved={() => { setShowServerAdd(false); setServerEdit(null); loadServers(); showToast('DHCP server saved'); }}
        />
      )}
      {(showPlanAdd || planEdit) && (
        <IpoePlanModal
          initial={planEdit}
          profiles={profiles}
          onClose={() => { setShowPlanAdd(false); setPlanEdit(null); }}
          onSaved={() => { setShowPlanAdd(false); setPlanEdit(null); loadPlans(); showToast('Plan saved'); }}
        />
      )}
      <Toast message={toast} />
    </Layout>
  );
}

function LeaseEditModal({ lease, plans, onClose, onSaved }: any) {
  const [name, setName] = useState(lease.name || '');
  const [plan, setPlan] = useState(lease.plan || '');
  const [due, setDue] = useState((lease.due || '').slice(0, 16).replace(' ', 'T'));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/ipoe/leases/${encodeURIComponent(lease.mac)}`, {
        name,
        plan,
        due: due ? new Date(due).toLocaleString() : '',
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Edit Lease" subtitle={lease.mac} onClose={onClose} footer={<ModalFooter onCancel={onClose} onConfirm={save} busy={busy} />}>
      <div className="space-y-4">
        <FormField label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Billing Plan">
          <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">—</option>
            {plans.map((p: any) => <option key={p.id || p.name} value={p.name}>{p.name}</option>)}
          </select>
        </FormField>
        <FormField label="Due"><input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></FormField>
      </div>
    </Modal>
  );
}

function LeasePayModal({ lease, plans, onClose, onSaved }: any) {
  const [plan, setPlan] = useState(lease.plan || plans[0]?.name || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const due = new Date();
      due.setMonth(due.getMonth() + 1);
      await api.put(`/ipoe/leases/${encodeURIComponent(lease.mac)}`, {
        plan,
        payment: 'Active',
        due: due.toLocaleString(),
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Process Payment" subtitle={lease.name} onClose={onClose} footer={<ModalFooter onCancel={onClose} onConfirm={save} confirmLabel="Mark Paid" busy={busy} />}>
      <FormField label="Billing Plan">
        <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
          {plans.map((p: any) => <option key={p.id || p.name} value={p.name}>{p.name} ({peso(p.price)})</option>)}
        </select>
      </FormField>
    </Modal>
  );
}

function IpoeProfileModal({ initial, onClose, onSaved }: any) {
  const isEdit = !!initial?.id;
  const [name, setName] = useState(initial?.name || '');
  const [down, setDown] = useState(String(initial?.downloadMbps ?? 100));
  const [up, setUp] = useState(String(initial?.uploadMbps ?? 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!name.trim()) return setError('Name required');
    setBusy(true);
    try {
      const payload = { name: name.trim(), downloadMbps: Number(down) || 0, uploadMbps: Number(up) || 0, maxLimit: `${down}M/${up}M` };
      if (isEdit) await api.put(`/ipoe/profiles/${initial.id}`, payload);
      else await api.post('/ipoe/profiles', payload);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={isEdit ? 'Edit Profile' : 'Add Profile'} onClose={onClose} footer={<ModalFooter onCancel={onClose} onConfirm={save} busy={busy} />}>
      {error && <div className="text-sm text-rose-600 mb-3">{error}</div>}
      <div className="space-y-4">
        <FormField label="Name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Download (Mbps)"><input className="input" type="number" value={down} onChange={(e) => setDown(e.target.value)} /></FormField>
          <FormField label="Upload (Mbps)"><input className="input" type="number" value={up} onChange={(e) => setUp(e.target.value)} /></FormField>
        </div>
      </div>
    </Modal>
  );
}

function DhcpServerModal({ initial, routerId, onClose, onSaved }: any) {
  const isEdit = !!initial?.id;
  const [name, setName] = useState(initial?.name || '');
  const [iface, setIface] = useState(initial?.interface || '');
  const [pool, setPool] = useState(initial?.pool || '');
  const [lease, setLease] = useState(initial?.lease || '30m');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!name || !iface || !pool) return setError('Name, interface and pool required');
    setBusy(true);
    try {
      const payload = { routerId, name, interface: iface, pool, lease };
      if (isEdit) await api.put(`/ipoe/servers/${encodeURIComponent(initial.id)}`, payload);
      else await api.post('/ipoe/servers', payload);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={isEdit ? 'Edit DHCP Server' : 'Add DHCP Server'} onClose={onClose} footer={<ModalFooter onCancel={onClose} onConfirm={save} busy={busy} />}>
      {error && <div className="text-sm text-rose-600 mb-3">{error}</div>}
      <div className="space-y-4">
        <FormField label="Name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></FormField>
        <FormField label="Interface" required><input className="input" value={iface} onChange={(e) => setIface(e.target.value)} placeholder="bridge-LAN" /></FormField>
        <FormField label="Address Pool" required><input className="input" value={pool} onChange={(e) => setPool(e.target.value)} placeholder="LAN-POOL" /></FormField>
        <FormField label="Lease Time"><input className="input" value={lease} onChange={(e) => setLease(e.target.value)} placeholder="30m" /></FormField>
      </div>
    </Modal>
  );
}

function IpoePlanModal({ initial, profiles, onClose, onSaved }: any) {
  const isEdit = !!initial?.id;
  const [name, setName] = useState(initial?.name || '');
  const [price, setPrice] = useState(String(initial?.price ?? ''));
  const [cycle, setCycle] = useState(initial?.cycle || 'Monthly');
  const [profile, setProfile] = useState(initial?.profile || profiles[0]?.name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!name.trim()) return setError('Name required');
    setBusy(true);
    try {
      const payload = { name: name.trim(), price: Number(price) || 0, cycle, profile };
      if (isEdit) await api.put(`/ipoe/plans/${initial.id}`, payload);
      else await api.post('/ipoe/plans', payload);
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={isEdit ? 'Edit Plan' : 'Add Plan'} onClose={onClose} footer={<ModalFooter onCancel={onClose} onConfirm={save} busy={busy} />}>
      {error && <div className="text-sm text-rose-600 mb-3">{error}</div>}
      <div className="space-y-4">
        <FormField label="Name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="UNLI100" /></FormField>
        <FormField label="Price"><input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></FormField>
        <FormField label="Cycle">
          <select className="input" value={cycle} onChange={(e) => setCycle(e.target.value)}>
            <option>Monthly</option>
            <option>Weekly</option>
            <option>Daily</option>
          </select>
        </FormField>
        <FormField label="Profile">
          <select className="input" value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="">—</option>
            {profiles.map((p: any) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </FormField>
      </div>
    </Modal>
  );
}

// silence unused helper in case traffic is extended later

import { useEffect, useState } from 'react';
import { Users, WifiOff, Activity, Layers, Server, ReceiptText, Plus, Pencil, Trash2, KeyRound, Eye, EyeOff, MapPin, DownloadCloud } from 'lucide-react';
import Layout from '../components/Layout';
import {
  StatusBadge, TabBar, Toolbar, SearchInput, DataTable, IconAction, Toast,
  Modal, ModalFooter, FormField, Card,
} from '../components/ui';
import { api, peso, addMonthsPreserveDay } from '../api';
import LocationEditor, { DEFAULT_PIN } from '../components/LocationEditor';
import { useRouterDevice } from '../context/RouterContext';
import { printPaymentReceipt } from '../lib/printer';

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
}

const TABS = [
  { key: 'users', label: 'Users', icon: Users },
  { key: 'offline', label: 'Offline', icon: WifiOff },
  { key: 'active', label: 'Active Connections', icon: Activity },
  { key: 'profiles', label: 'Profiles', icon: Layers },
  { key: 'servers', label: 'Servers', icon: Server },
  { key: 'plans', label: 'Billing Plans', icon: ReceiptText },
];

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
  const { current } = useRouterDevice();

  const loadUsers = () => {
    const q = new URLSearchParams({ service });
    if (current?.id) {
      q.set('routerId', String(current.id));
      q.set('live', '1');
    }
    return api.get(`/pppoe/users?${q}`).then((r) => setUsers(r.data));
  };

  const loadActive = () => {
    const q = current?.id ? `?service=${service}&routerId=${current.id}` : `?service=${service}`;
    return api.get(`/pppoe/active${q}`).then((r) => setActive(r.data));
  };

  const loadServers = () => {
    const q = current?.id ? `?routerId=${current.id}` : '';
    return api.get(`/pppoe/servers${q}`).then((r) => setServers(r.data));
  };

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
      showToast(`Fetched from ${r.data.router}: ${r.data.profilesImported} profiles, ${r.data.fetched} secrets, ${r.data.serversImported ?? 0} servers (${r.data.created} new, ${r.data.updated} updated).`);
      loadUsers();
      loadActive();
      loadServers();
      api.get('/pppoe/profiles').then((res) => setProfiles(res.data));
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Fetch from MikroTik failed.');
    } finally {
      setFetching(false);
    }
  };

  const toggleEnabled = async (u: PUser) => {
    const enabling = u.status === 'disabled';
    if (!confirm(`${enabling ? 'Enable' : 'Disable'} PPP secret for ${u.username} on MikroTik?`)) return;
    try {
      const r = await api.post(`/pppoe/users/${u.id}/toggle-enabled`);
      const syncNote = r.data.mikrotik?.synced === false
        ? ` (panel updated; MikroTik: ${r.data.mikrotik.error || 'unreachable'})`
        : '';
      showToast(`${u.username} ${r.data.status === 'disabled' ? 'disabled' : 'enabled'} in MikroTik.${syncNote}`);
      loadUsers();
      loadActive();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Toggle failed.');
    }
  };

  useEffect(() => {
    setTab('users');
    setSearch('');
    setSelected(new Set());
    loadUsers();
    api.get('/pppoe/profiles').then((r) => setProfiles(r.data));
    loadActive();
    loadServers();
    api.get('/billing-plans').then((r) => setPlans(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, current?.id]);

  const filtered = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      (u.customer || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.account || '').includes(search)
  );
  const offline = filtered.filter((u) => u.status === 'disabled' || !u.online);
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

  const remove = async (u: PUser) => {
    if (!confirm(`Delete PPP secret for ${u.username} from MikroTik and remove from panel?`)) return;
    await api.delete(`/pppoe/users/${u.id}`);
    showToast(`Deleted ${u.username}.`);
    loadUsers();
    loadActive();
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
                  { key: 'status', label: 'PPP Status' },
                  { key: 'conn', label: 'Session' },
                  { key: 'due', label: 'Subscription Due' },
                  { key: 'actions', label: 'Actions', align: 'right' },
                ]}
                rows={listUsers.map((u) => ({
                  key: u.id,
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
                    <span className="text-slate-600">{u.profile}</span>,
                    <StatusBadge status={u.status === 'disabled' ? 'disabled' : 'Active'} />,
                    u.status === 'disabled' ? (
                      <span className="text-xs text-rose-600 font-medium">Secret disabled</span>
                    ) : u.online ? (
                      <span className="text-xs text-emerald-600 font-medium">Online</span>
                    ) : (
                      <span className="text-xs text-amber-600 font-medium">Offline</span>
                    ),
                    <span className="text-slate-500">{u.subscriptionDue}</span>,
                    <div key="a" className="flex items-center justify-end gap-1">
                      <IconAction icon={ReceiptText} title="Process Payment" tone="emerald" onClick={() => setPayFor(u)} />
                      <IconAction icon={Pencil} title="Edit user" tone="sky" onClick={() => setEditFor(u)} />
                      <IconAction
                        icon={KeyRound}
                        title={u.status === 'disabled' ? 'Enable PPP secret on MikroTik' : 'Disable PPP secret on MikroTik'}
                        tone={u.status === 'disabled' ? 'emerald' : 'rose'}
                        onClick={() => toggleEnabled(u)}
                      />
                      <IconAction icon={Trash2} title="Delete PPP secret from MikroTik" tone="rose" onClick={() => remove(u)} />
                    </div>,
                  ],
                }))}
                emptyMessage="No users found."
              />
            </div>
          </>
        )}

        {tab === 'active' && (
          <div className="p-4">
            <SimpleTable
              columns={['Username', 'Customer', 'Profile', 'Address', 'Uptime', 'Caller ID']}
              rows={active.map((a) => [a.username, a.customer, a.profile, a.address, a.uptime, a.caller])}
            />
          </div>
        )}

        {tab === 'profiles' && (
          <div className="p-4">
            <SimpleTable
              columns={['Name', 'Rate Limit', 'Price', 'Type']}
              rows={profiles.map((p) => [p.name, p.rateLimit, peso(p.price), p.type])}
            />
          </div>
        )}

        {tab === 'servers' && (
          <div className="p-4">
            <SimpleTable
              columns={['Name', 'Interface', 'Max Sessions', 'Service', 'Auth', 'Status']}
              rows={servers.map((s) => [s.name, s.interface, s.maxSessions, s.service, s.authentication, <StatusBadge key={s.name} status={s.status} />])}
            />
          </div>
        )}

        {tab === 'plans' && (
          <div className="p-4">
            <SimpleTable
              columns={['Plan', 'Rate Limit', 'Monthly Price']}
              rows={plans.map((p) => [p.name, p.rateLimit, peso(p.price)])}
            />
          </div>
        )}
      </Card>

      {showAdd && (
        <UserFormModal
          service={service}
          profiles={profiles}
          routerId={current?.id}
          editUser={null}
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
          routerId={current?.id}
          editUser={editFor}
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
          routerId={current?.id}
          onClose={() => setPayFor(null)}
          onPaid={(msg) => {
            setPayFor(null);
            showToast(msg);
            loadUsers();
            loadActive();
          }}
        />
      )}

      <Toast message={toast} />
    </Layout>
  );
}

async function printReceipt(receipt: any) {
  try {
    await printPaymentReceipt(receipt);
  } catch (e: any) {
    console.error(e);
    alert(e?.message || 'Could not print receipt. Check Printers settings or allow pop-ups.');
  }
}

function ProcessPaymentModal({
  user,
  profiles,
  routerId,
  onClose,
  onPaid,
}: {
  user: PUser;
  profiles: any[];
  routerId?: number;
  onClose: () => void;
  onPaid: (msg: string) => void;
}) {
  const [plan, setPlan] = useState(user.profile || profiles[0]?.name || '');
  const [months, setMonths] = useState(1);
  const [currentDue, setCurrentDue] = useState((user.subscriptionDue || '').slice(0, 10));
  const [newDue, setNewDue] = useState('');
  const [manualDue, setManualDue] = useState(false);
  const [nonPaymentProfile, setNonPaymentProfile] = useState('default');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [discountDays, setDiscountDays] = useState(0);
  const [sendReceipt, setSendReceipt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState(user.email || '');

  useEffect(() => {
    const q = routerId ? `?routerId=${routerId}` : '';
    api.get(`/pppoe/users/${user.id}/mikrotik${q}`)
      .then((r) => {
        const u = r.data.user || user;
        const due = (u.subscription_due || u.subscriptionDue || '').slice(0, 10);
        setCurrentDue(due);
        setPlan(u.profile || plan);
        setNonPaymentProfile(u.expiration_profile || 'default');
        setEmail(u.email || '');
        if (!manualDue) setNewDue(addMonthsPreserveDay(due, months));
      })
      .catch(() => {
        const due = (user.subscriptionDue || '').slice(0, 10);
        setCurrentDue(due);
        if (!manualDue) setNewDue(addMonthsPreserveDay(due, months));
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, routerId]);

  const pickMonths = (m: number) => {
    setMonths(m);
    setManualDue(false);
    if (currentDue) setNewDue(addMonthsPreserveDay(currentDue, m));
  };

  const planPrice = profiles.find((p) => p.name === (plan === '__no_change__' ? user.profile : plan))?.price ?? user.price ?? 0;
  const subtotal = planPrice * months;
  const discount = Math.round((planPrice / 30) * Math.max(0, discountDays) * 100) / 100;
  const total = Math.max(0, subtotal - discount);
  const hasEmail = !!email;

  const pay = async () => {
    setSaving(true);
    setError('');
    try {
      const r = await api.post(`/pppoe/users/${user.id}/payment`, {
        months,
        plan: plan === '__no_change__' ? '__no_change__' : plan,
        expiration_profile: nonPaymentProfile,
        payment_date: paymentDate,
        discount_days: discountDays,
        send_receipt: sendReceipt,
        new_due: newDue,
        router_id: routerId,
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
      wide
      footer={
        <ModalFooter
          onCancel={onClose}
          onConfirm={pay}
          confirmLabel="Process Payment & Print"
          busy={saving || loading}
        />
      }
    >
      {loading && <div className="text-sm text-slate-500 mb-3">Loading billing data from MikroTik…</div>}
      {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 mb-4">{error}</div>}

      <div className="space-y-4">
        <FormField label="Billing Plan">
          <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="__no_change__">-- No Change --</option>
            {profiles.map((p) => <option key={p.id} value={p.name}>{p.name} ({peso(p.price)})</option>)}
          </select>
        </FormField>

        <div>
          <span className="text-sm font-medium text-slate-700 mb-2 block">Months of Extension</span>
          <div className="flex flex-wrap items-center gap-2">
            {[1, 2, 3, 4, 5, 6, 12].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => pickMonths(m)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${months === m && !manualDue ? 'bg-brand-500 text-white border-brand-500 shadow-glow-sm' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {m} mo
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">Extends from the current MikroTik expiration date, not the payment date.</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Current Expiration (from MikroTik)">
            <input className="input bg-slate-50 text-slate-600" value={currentDue || '—'} readOnly />
          </FormField>
          <FormField label="New Expiration Date">
            <input
              className="input"
              type="date"
              value={newDue}
              onChange={(e) => { setManualDue(true); setNewDue(e.target.value); }}
            />
          </FormField>
        </div>

        <FormField label="Profile on Expiry" hint="Applied on MikroTik when the reminder window starts (Notifications → days before due).">
          <select className="input" value={nonPaymentProfile} onChange={(e) => setNonPaymentProfile(e.target.value)}>
            <option value="default">default (keep billing plan)</option>
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
            <span className="text-sm font-medium text-slate-700 block">Send payment confirmation email</span>
            <span className="text-xs text-slate-400">{hasEmail ? email : 'No email on file — add one in Edit User.'}</span>
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

function SimpleTable({ columns, rows }: { columns: string[]; rows: React.ReactNode[][] }) {
  return (
    <DataTable
      columns={columns.map((c, i) => ({ key: String(i), label: c }))}
      rows={rows.map((r, i) => ({ key: i, cells: r }))}
      emptyMessage="No records."
    />
  );
}

function UserFormModal({
  service,
  profiles,
  routerId,
  editUser,
  onClose,
  onSaved,
}: {
  service: string;
  profiles: any[];
  routerId?: number;
  editUser?: PUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editUser;
  const defaultPlan = profiles.find((p) => p.name === 'UNLI500')?.name || profiles[0]?.name || '15mbps';
  const [form, setForm] = useState({
    username: '',
    password: '',
    profile: defaultPlan,
    subscription_due: '',
    expiration_profile: 'default',
    account_number: '',
    customer_name: '',
    address: '',
    contact: '',
    email: '',
    nap_id: '',
    plc_port: '',
    lat: DEFAULT_PIN[0] as number | null,
    lng: DEFAULT_PIN[1] as number | null,
  });
  const [mikrotikComment, setMikrotikComment] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [naps, setNaps] = useState<any[]>([]);
  const [showLoc, setShowLoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/naps').then((r) => setNaps(r.data));
    if (editUser) {
      const q = routerId ? `?routerId=${routerId}` : '';
      api.get(`/pppoe/users/${editUser.id}${q}`).then((r) => {
        const u = r.data;
        setForm({
          username: u.username || '',
          password: '',
          profile: u.profile || defaultPlan,
          subscription_due: (u.subscription_due || '').slice(0, 10),
          expiration_profile: u.expiration_profile || 'default',
          account_number: u.account_number || '',
          customer_name: u.customer_name || '',
          address: u.address || '',
          contact: u.contact || '',
          email: u.email || '',
          nap_id: u.nap_id ? String(u.nap_id) : '',
          plc_port: u.plc_port || '',
          lat: u.lat ?? null,
          lng: u.lng ?? null,
        });
        setMikrotikComment(u.mikrotikComment || '');
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const raw = form.account_number;
    const accountNumber = /^\d+$/.test(raw) ? Number(raw) : raw || 0;
    if (!isEdit || form.account_number) {
      setMikrotikComment(JSON.stringify({
        plan: form.profile,
        dueDate: form.subscription_due || '',
        accountNumber: isEdit ? accountNumber : 0,
        expireProfile: form.expiration_profile || 'default',
        customer: {
          fullName: form.customer_name || undefined,
          address: form.address || undefined,
          contactNumber: form.contact || undefined,
          email: form.email || undefined,
          latitude: form.lat,
          longitude: form.lng,
          plcPort: form.plc_port || null,
        },
      }));
    }
  }, [isEdit, form.profile, form.subscription_due, form.expiration_profile, form.account_number, form.customer_name, form.address, form.contact, form.email, form.lat, form.lng, form.plc_port]);

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
      setError('Password is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        ...form,
        nap_id: form.nap_id ? Number(form.nap_id) : null,
        router_id: routerId || undefined,
        service,
      };
      if (isEdit && !String(form.password || '').trim()) {
        delete payload.password;
      }
      if (isEdit) {
        const r = await api.put(`/pppoe/users/${editUser!.id}`, payload);
        if (r.data?.mikrotikComment) setMikrotikComment(r.data.mikrotikComment);
        if (r.data?.mikrotik && !r.data.mikrotik.synced) {
          setError(r.data.mikrotik.error ? `Saved locally, but MikroTik sync failed: ${r.data.mikrotik.error}` : 'Saved locally, but MikroTik sync failed.');
          return;
        }
      } else {
        if (!routerId) {
          setError('Select a router in the top bar before creating a user.');
          setSaving(false);
          return;
        }
        const r = await api.post('/pppoe/users', payload);
        if (r.data?.mikrotikComment) setMikrotikComment(r.data.mikrotikComment);
        if (r.data?.mikrotik && !r.data.mikrotik.synced) {
          setError(r.data.mikrotik.error ? `User created, but MikroTik sync failed: ${r.data.mikrotik.error}` : 'User created, but MikroTik sync failed.');
          return;
        }
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
              className="input"
              value={form.username}
              onChange={(e) => set({ username: e.target.value })}
              autoFocus={!isEdit}
            />
          </FormField>

          <FormField
            label="Password"
            hint={isEdit ? 'Leave blank to keep the current password.' : undefined}
            required={!isEdit}
          >
            <div className="relative">
              <input
                className="input pr-10"
                type={showPass ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
                placeholder={isEdit ? '•••••••• (unchanged)' : ''}
                autoComplete="new-password"
              />
              <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </FormField>

          <FormField label="Billing Plan">
            <select className="input" value={form.profile} onChange={(e) => set({ profile: e.target.value })}>
              {isEdit && <option value={form.profile}>-- No Change --</option>}
              {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Expiration Date">
              <input className="input" type="date" value={form.subscription_due} onChange={(e) => set({ subscription_due: e.target.value })} />
            </FormField>
            <FormField
              label="Profile on Expiry"
              hint="MikroTik PPP profile applied when the account enters the reminder window (days before due) set under Notifications. Use a limited plan such as non-payments."
            >
              <select className="input" value={form.expiration_profile} onChange={(e) => set({ expiration_profile: e.target.value })}>
                <option value="default">default (keep billing plan)</option>
                {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </FormField>
          </div>

          {isEdit && (
            <FormField label="Account Number (Read-only)">
              <input className="input bg-slate-50 text-slate-600" value={form.account_number} readOnly />
            </FormField>
          )}

          <FormField label="MikroTik PPP Secret Comment">
            <div className="input bg-slate-50 text-slate-600 font-mono text-xs break-all min-h-[2.5rem] py-2">
              {mikrotikComment || '—'}
            </div>
            <p className="text-xs text-slate-400 mt-1">Synced to RouterOS <code className="text-[11px]">/ppp/secret</code> comment on save.</p>
          </FormField>

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
              <input
                className="input"
                type="number"
                step="any"
                value={form.lat ?? ''}
                onChange={(e) => set({ lat: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </FormField>
            <FormField label="Longitude">
              <input
                className="input"
                type="number"
                step="any"
                value={form.lng ?? ''}
                onChange={(e) => set({ lng: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </FormField>
          </div>
          <button
            type="button"
            onClick={() => setShowLoc(true)}
            className="w-full h-24 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:bg-brand-50/50 hover:text-brand-600 hover:border-brand-300 flex items-center justify-center gap-2 text-sm transition-colors"
          >
            <MapPin size={18} /> {form.lat != null ? 'Open large map to adjust the pin' : 'Open large map to set a location'}
          </button>
          <p className="text-xs text-slate-400">Coordinates are saved with the user and appear on Clients Map automatically.</p>
        </div>
      </Modal>

      {showLoc && (
        <LocationEditor
          large
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
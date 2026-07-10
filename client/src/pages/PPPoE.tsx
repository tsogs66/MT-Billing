import { useEffect, useState } from 'react';
import { Users, WifiOff, Activity, Layers, Server, ReceiptText, Plus, Search, Pencil, Trash2, KeyRound, X, CheckCircle2, Eye, EyeOff, MapPin, Printer, DownloadCloud } from 'lucide-react';
import Layout from '../components/Layout';
import { StatusBadge } from '../components/ui';
import { api, peso } from '../api';
import LocationEditor, { DEFAULT_PIN } from '../components/LocationEditor';
import { useRouterDevice } from '../context/RouterContext';

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
  const { current } = useRouterDevice();

  const loadUsers = () => api.get(`/pppoe/users?service=${service}`).then((r) => setUsers(r.data));

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
      showToast(`Fetched from ${r.data.router}: ${r.data.profilesImported} profiles, ${r.data.fetched} secrets (${r.data.created} new, ${r.data.updated} updated).`);
      loadUsers();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Fetch from MikroTik failed.');
    } finally {
      setFetching(false);
    }
  };

  const toggleEnabled = async (u: PUser) => {
    const r = await api.post(`/pppoe/users/${u.id}/toggle-enabled`);
    showToast(`${u.username} ${r.data.status === 'disabled' ? 'disabled' : 'enabled'} in MikroTik.`);
    loadUsers();
  };

  useEffect(() => {
    setTab('users');
    setSearch('');
    loadUsers();
    api.get('/pppoe/profiles').then((r) => setProfiles(r.data));
    api.get(`/pppoe/active?service=${service}`).then((r) => setActive(r.data));
    api.get('/pppoe/servers').then((r) => setServers(r.data));
    api.get('/billing-plans').then((r) => setPlans(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);

  const filtered = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      (u.customer || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.account || '').includes(search)
  );
  const offline = filtered.filter((u) => u.status !== 'Active');

  const remove = async (id: number) => {
    await api.delete(`/pppoe/users/${id}`);
    loadUsers();
  };

  return (
    <Layout title={title}>
      <div className="card overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-100 px-3 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm border-b-2 whitespace-nowrap ${
                  tab === t.key ? 'border-brand-500 text-brand-600 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
        </div>

        {(tab === 'users' || tab === 'offline') && (
          <>
            <div className="flex items-center justify-between px-5 py-3 gap-3 flex-wrap">
              <div className="text-sm text-slate-500">
                Total Users <span className="font-semibold text-slate-700">{tab === 'offline' ? offline.length : users.length}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search size={15} className="absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${service.toUpperCase()} user...`}
                    className="text-sm border border-slate-200 rounded-lg pl-8 pr-3 py-2 w-64 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <button
                  className="inline-flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 text-slate-600 disabled:opacity-60"
                  onClick={fetchFromMikrotik}
                  disabled={fetching}
                  title="Read /ppp/secret from the selected router and import billing data from the comments"
                >
                  <DownloadCloud size={16} /> {fetching ? 'Fetching…' : 'Fetch from MikroTik'}
                </button>
                <button className="btn-primary" onClick={() => setShowAdd(true)}>
                  <Plus size={16} /> Add New User
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-left border-y border-slate-100 bg-slate-50">
                    <th className="px-5 py-2.5 font-medium">Username/Customer</th>
                    <th className="px-5 py-2.5 font-medium">Account #</th>
                    <th className="px-5 py-2.5 font-medium">Profile</th>
                    <th className="px-5 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5 font-medium">Subscription Due</th>
                    <th className="px-5 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(tab === 'offline' ? offline : filtered).map((u) => (
                    <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-slate-800">{u.username}</div>
                        <div className="text-xs text-slate-400">{u.customer}</div>
                      </td>
                      <td className="px-5 py-2.5 text-slate-500">{u.account}</td>
                      <td className="px-5 py-2.5 text-slate-600">{u.profile}</td>
                      <td className="px-5 py-2.5"><StatusBadge status={u.status} /></td>
                      <td className="px-5 py-2.5 text-slate-500">{u.subscriptionDue}</td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center justify-end gap-3 text-slate-400">
                          <button title="Process Payment" className="hover:text-emerald-600" onClick={() => setPayFor(u)}><ReceiptText size={16} /></button>
                          <button title="Edit user details" className="hover:text-sky-600" onClick={() => setEditFor(u)}><Pencil size={16} /></button>
                          <button
                            title={u.status === 'disabled' ? 'Enable account in MikroTik' : 'Disable account in MikroTik'}
                            className={u.status === 'disabled' ? 'text-rose-500 hover:text-rose-600' : 'hover:text-emerald-600'}
                            onClick={() => toggleEnabled(u)}
                          >
                            <KeyRound size={16} />
                          </button>
                          <button title="Delete" className="hover:text-rose-600" onClick={() => remove(u.id)}><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(tab === 'offline' ? offline : filtered).length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">No users found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'active' && (
          <SimpleTable
            columns={['Username', 'Customer', 'Profile', 'Address', 'Uptime', 'Caller ID']}
            rows={active.map((a) => [a.username, a.customer, a.profile, a.address, a.uptime, a.caller])}
          />
        )}

        {tab === 'profiles' && (
          <SimpleTable
            columns={['Name', 'Rate Limit', 'Price', 'Type']}
            rows={profiles.map((p) => [p.name, p.rateLimit, peso(p.price), p.type])}
          />
        )}

        {tab === 'servers' && (
          <SimpleTable
            columns={['Name', 'Interface', 'Max Sessions', 'Service', 'Auth', 'Status']}
            rows={servers.map((s) => [s.name, s.interface, s.maxSessions, s.service, s.authentication, <StatusBadge key={s.name} status={s.status} />])}
          />
        )}

        {tab === 'plans' && (
          <SimpleTable
            columns={['Plan', 'Rate Limit', 'Monthly Price']}
            rows={plans.map((p) => [p.name, p.rateLimit, peso(p.price)])}
          />
        )}
      </div>

      {showAdd && (
        <UserFormModal
          service={service}
          profiles={profiles}
          naps={undefined}
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
          naps={undefined}
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
          onClose={() => setPayFor(null)}
          onPaid={(msg) => {
            setPayFor(null);
            showToast(msg);
            loadUsers();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[1100] flex items-center gap-2 bg-emerald-600 text-white text-sm px-4 py-3 rounded-lg shadow-lg">
          <CheckCircle2 size={18} /> {toast}
        </div>
      )}
    </Layout>
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-2">
          <h3 className="text-brand-600 font-bold text-xl">Process Payment</h3>
          <div className="text-sm text-slate-400">For user: {user.username}</div>
        </div>

        <div className="p-5 pt-2 space-y-4 overflow-y-auto">
          {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}

          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Billing Plan</span>
            <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {profiles.map((p) => <option key={p.id} value={p.name}>{p.name} ({peso(p.price)})</option>)}
            </select>
          </label>

          <div>
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Months of Extension</span>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 6, 12].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMonths(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${months === m ? 'bg-brand-500 text-white border-brand-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-400 mt-1 block">Extends the expiration by whole month(s) from the current due date (billing day preserved).</span>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Non-Payment Profile</span>
            <select className="input" value={nonPaymentProfile} onChange={(e) => setNonPaymentProfile(e.target.value)}>
              <option value="default">default</option>
              {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
            <span className="text-xs text-slate-400 mt-1 block">Profile to apply on due date.</span>
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Payment Date</span>
            <input className="input" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Discount for Downtime (Days)</span>
            <input className="input" type="number" min={0} value={discountDays} onChange={(e) => setDiscountDays(Math.max(0, Number(e.target.value)))} />
          </label>

          <label className="flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
            <span>
              <span className="text-sm font-semibold text-slate-700 block">Send receipt to email</span>
              <span className="text-xs text-slate-400">{hasEmail ? user.email : 'No email set in account details.'}</span>
            </span>
            <input type="checkbox" className="mt-1 w-4 h-4" disabled={!hasEmail} checked={sendReceipt && hasEmail} onChange={(e) => setSendReceipt(e.target.checked)} />
          </label>

          <div className="border-t border-slate-100 pt-3 text-sm space-y-1">
            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{peso(subtotal)}</span></div>
            <div className="flex justify-between text-slate-500"><span>Discount</span><span>- {peso(discount)}</span></div>
            <div className="flex justify-between items-center pt-1">
              <span className="font-bold text-slate-800">TOTAL</span>
              <span className="font-bold text-slate-900 text-lg">{peso(total)}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl">
          <button className="px-4 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={pay}>
            <Printer size={16} /> {saving ? 'Processing...' : 'Process Payment & Print'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SimpleTable({ columns, rows }: { columns: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-400 text-left border-y border-slate-100 bg-slate-50">
            {columns.map((c) => <th key={c} className="px-5 py-2.5 font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60">
              {r.map((cell, j) => <td key={j} className="px-5 py-2.5 text-slate-600">{cell}</td>)}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={columns.length} className="px-5 py-10 text-center text-slate-400">No records.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function UserFormModal({
  service,
  profiles,
  editUser,
  onClose,
  onSaved,
}: {
  service: string;
  profiles: any[];
  naps?: any;
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
          expiration_profile: u.expiration_profile || 'default',
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
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, nap_id: form.nap_id ? Number(form.nap_id) : null, service };
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
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-800 text-lg">{isEdit ? 'Edit User' : 'Add New User'}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto">
            {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}

            <Field label="Username">
              <input
                className={`input ${isEdit ? 'bg-slate-50 text-slate-500' : ''}`}
                value={form.username}
                onChange={(e) => set({ username: e.target.value })}
                readOnly={isEdit}
                autoFocus={!isEdit}
              />
            </Field>

            <Field label="Password">
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
            </Field>

            <Field label="Billing Plan">
              <select className="input" value={form.profile} onChange={(e) => set({ profile: e.target.value })}>
                {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Expiration Date">
                <input className="input" type="date" value={form.subscription_due} onChange={(e) => set({ subscription_due: e.target.value })} />
              </Field>
              <Field label="Expiration Profile">
                <select className="input" value={form.expiration_profile} onChange={(e) => set({ expiration_profile: e.target.value })}>
                  <option value="default">default</option>
                  {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </Field>
            </div>

            <div className="pt-1 border-t border-slate-100" />
            <h4 className="font-semibold text-slate-800">Customer Information (Optional)</h4>

            <Field label="Full Name">
              <input className="input" value={form.customer_name} onChange={(e) => set({ customer_name: e.target.value })} />
            </Field>
            <Field label="Full Address">
              <input className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact Number">
                <input className="input" value={form.contact} onChange={(e) => set({ contact: e.target.value })} />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
              </Field>
            </div>

            <Field label="NAP (Optional)">
              <select className="input" value={form.nap_id} onChange={(e) => set({ nap_id: e.target.value })}>
                <option value="">-- None --</option>
                {naps.map((n) => <option key={n.id} value={n.id}>{n.name}{n.oltName ? ` (${n.oltName})` : ''}</option>)}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="PLC Port (Optional)">
                <input className="input" placeholder="e.g. 1, 2, 3..." value={form.plc_port} onChange={(e) => set({ plc_port: e.target.value })} />
              </Field>
              <Field label="Linked (Read-only)">
                <div className="input bg-slate-50 text-slate-500 truncate" title={topology}>Topology: {topology}</div>
              </Field>
            </div>

            <div className="pt-1 border-t border-slate-100" />
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-800">Map Location (Optional)</h4>
              <button
                type="button"
                onClick={() => setShowLoc(true)}
                className="inline-flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 text-slate-600"
              >
                <MapPin size={15} /> Edit Location
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude">
                <div className="input bg-slate-50 text-slate-600 truncate">{form.lat != null ? Number(form.lat).toFixed(6) : '—'}</div>
              </Field>
              <Field label="Longitude">
                <div className="input bg-slate-50 text-slate-600 truncate">{form.lng != null ? Number(form.lng).toFixed(6) : '—'}</div>
              </Field>
            </div>
            <button
              type="button"
              onClick={() => setShowLoc(true)}
              className="w-full h-20 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-brand-600 hover:border-brand-300 flex items-center justify-center gap-2 text-sm"
            >
              <MapPin size={18} /> {form.lat != null ? 'Open map to adjust the pin' : 'Open map to set a location'}
            </button>
          </div>

          <div className="flex justify-end items-center gap-5 px-5 py-3 border-t border-slate-100">
            <button className="text-sm text-slate-600 hover:text-slate-800" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="text-sm font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-slate-600 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

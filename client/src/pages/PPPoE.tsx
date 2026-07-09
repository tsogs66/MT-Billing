import { useEffect, useState } from 'react';
import { Users, WifiOff, Activity, Layers, Server, ReceiptText, Plus, Search, Pencil, Trash2, Power, X } from 'lucide-react';
import Layout from '../components/Layout';
import { StatusBadge } from '../components/ui';
import { api, peso } from '../api';

interface PUser {
  id: number;
  username: string;
  customer: string;
  account: string;
  profile: string;
  status: string;
  subscriptionDue: string;
  price: number;
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

  const loadUsers = () => api.get(`/pppoe/users?service=${service}`).then((r) => setUsers(r.data));

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
                          <button title="Payment" className="hover:text-emerald-600"><ReceiptText size={16} /></button>
                          <button title="Edit" className="hover:text-sky-600"><Pencil size={16} /></button>
                          <button title="Enable/Disable" className="hover:text-amber-600"><Power size={16} /></button>
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
        <AddUserModal
          service={service}
          profiles={profiles}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            loadUsers();
          }}
        />
      )}
    </Layout>
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

function AddUserModal({ service, profiles, onClose, onSaved }: { service: string; profiles: any[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ username: '', customer_name: '', account_number: '', profile: profiles[0]?.name || '15mbps', status: 'Active' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!form.username.trim()) {
      setError('Username is required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/pppoe/users', { ...form, service });
      onSaved();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">Add New {service.toUpperCase()} User</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}
          <Field label="Username">
            <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Customer Name">
            <input className="input" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
          </Field>
          <Field label="Account #">
            <input className="input" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Profile">
              <select className="input" value={form.profile} onChange={(e) => setForm({ ...form, profile: e.target.value })}>
                {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="Active">Active</option>
                <option value="inactive">inactive</option>
                <option value="expired">expired</option>
              </select>
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving...' : 'Create User'}</button>
        </div>
      </div>
    </div>
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

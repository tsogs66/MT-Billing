import { useEffect, useState } from 'react';
import { ShieldCheck, Plus, Pencil, Trash2, X } from 'lucide-react';
import Layout from '../components/Layout';
import { Card } from '../components/ui';
import { api } from '../api';

const PERMISSIONS = [
  'dashboard', 'pppoe', 'ipoe', 'map', 'sales', 'inventory', 'hotspot', 'network',
  'routers', 'notifications', 'settings', 'roles', 'license',
];

export default function PanelRoles() {
  const [roles, setRoles] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);

  const load = () => api.get('/roles').then((r) => setRoles(r.data));
  useEffect(() => {
    load();
  }, []);

  const del = async (id: number) => {
    await api.delete(`/roles/${id}`);
    load();
  };

  return (
    <Layout title="Panel Roles">
      <div className="flex justify-end mb-4">
        <button className="btn-primary" onClick={() => setEdit({ name: '', description: '', permissions: [] })}><Plus size={16} /> Add Role</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {roles.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center"><ShieldCheck size={20} /></div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800">{r.name}</h3>
                  <div className="flex items-center gap-2 text-slate-400">
                    <button className="hover:text-sky-600" onClick={() => setEdit({ ...r })}><Pencil size={15} /></button>
                    <button className="hover:text-rose-600" onClick={() => del(r.id)}><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="text-xs text-slate-400 mt-1">{r.description}</div>
                <div className="flex flex-wrap gap-1 mt-3">
                  {(r.permissions || []).map((p: string) => (
                    <span key={p} className="badge bg-slate-100 text-slate-600">{p === '*' ? 'all access' : p}</span>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {edit && (
        <RoleModal
          role={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            load();
          }}
        />
      )}
    </Layout>
  );
}

function RoleModal({ role, onClose, onSaved }: any) {
  const [form, setForm] = useState({ name: role.name || '', description: role.description || '', permissions: role.permissions || [] });
  const [busy, setBusy] = useState(false);
  const isEdit = !!role.id;
  const all = form.permissions.includes('*');
  const toggle = (p: string) =>
    setForm((f: any) => ({ ...f, permissions: f.permissions.includes(p) ? f.permissions.filter((x: string) => x !== p) : [...f.permissions, p] }));
  const save = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      if (isEdit) await api.put(`/roles/${role.id}`, form);
      else await api.post('/roles', form);
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">{isEdit ? 'Edit Role' : 'Add Role'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block"><span className="text-sm text-slate-600 mb-1 block">Role Name</span>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="block"><span className="text-sm text-slate-600 mb-1 block">Description</span>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div>
            <div className="text-sm text-slate-600 mb-1">Permissions</div>
            <label className="flex items-center gap-2 text-sm mb-2">
              <input type="checkbox" checked={all} onChange={() => setForm((f: any) => ({ ...f, permissions: all ? [] : ['*'] }))} /> Full access (all modules)
            </label>
            {!all && (
              <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">
                {PERMISSIONS.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.permissions.includes(p)} onChange={() => toggle(p)} /> {p}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

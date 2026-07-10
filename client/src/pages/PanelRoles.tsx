import { useEffect, useState } from 'react';
import { ShieldCheck, Plus, Pencil, Trash2 } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, Modal, ModalFooter, FormField } from '../components/ui';
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
        <button type="button" className="btn-primary" onClick={() => setEdit({ name: '', description: '', permissions: [] })}><Plus size={16} /> Add Role</button>
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
                    <button type="button" className="hover:text-sky-600" onClick={() => setEdit({ ...r })}><Pencil size={15} /></button>
                    <button type="button" className="hover:text-rose-600" onClick={() => del(r.id)}><Trash2 size={15} /></button>
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
    <Modal
      title={isEdit ? 'Edit Role' : 'Add Role'}
      onClose={onClose}
      footer={<ModalFooter onCancel={onClose} onConfirm={save} busy={busy} confirmLabel="Save" />}
    >
      <div className="space-y-3">
        <FormField label="Role Name" required>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </FormField>
        <FormField label="Description">
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </FormField>
        <FormField label="Permissions">
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
        </FormField>
      </div>
    </Modal>
  );
}

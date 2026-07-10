import { useEffect, useState } from 'react';
import { Router as RouterIcon, Plus, Pencil, Trash2, X } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge } from '../components/ui';
import { api } from '../api';
import { useRouterDevice } from '../context/RouterContext';

export default function Routers() {
  const [routers, setRouters] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const { refresh } = useRouterDevice();

  const load = () => api.get('/routers').then((r) => setRouters(r.data));
  useEffect(() => {
    load();
  }, []);

  const del = async (id: number) => {
    await api.delete(`/routers/${id}`);
    load();
    refresh();
  };

  return (
    <Layout title="Routers">
      <div className="flex justify-end mb-4">
        <button className="btn-primary" onClick={() => setEdit({ name: '', host: '', port: 8728, api_user: '', api_pass: '', board: '', type: 'pppoe', status: 'online' })}>
          <Plus size={16} /> Add Router
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {routers.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                <RouterIcon size={20} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800">{r.name}</h3>
                  <StatusBadge status={r.status} />
                </div>
                <div className="text-xs text-slate-400 mt-1">{r.board}</div>
                <dl className="mt-3 text-sm space-y-1">
                  <div className="flex justify-between"><dt className="text-slate-500">Host</dt><dd className="text-slate-700">{r.host}:{r.port}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Type</dt><dd className="text-slate-700 uppercase">{r.type}</dd></div>
                </dl>
                <div className="flex items-center gap-3 mt-3 text-slate-400">
                  <button className="inline-flex items-center gap-1 text-sm hover:text-sky-600" onClick={() => setEdit(r)}><Pencil size={14} /> Edit</button>
                  <button className="inline-flex items-center gap-1 text-sm hover:text-rose-600" onClick={() => del(r.id)}><Trash2 size={14} /> Delete</button>
                </div>
              </div>
            </div>
          </Card>
        ))}
        {routers.length === 0 && <div className="text-slate-400">No routers configured. Click “Add Router”.</div>}
      </div>

      {edit && (
        <RouterModal
          router={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            load();
            refresh();
          }}
        />
      )}
    </Layout>
  );
}

function RouterModal({ router, onClose, onSaved }: any) {
  const [form, setForm] = useState({ ...router, api_pass: '' });
  const [busy, setBusy] = useState(false);
  const isEdit = !!router.id;
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));
  const save = async () => {
    if (!form.name?.trim()) return;
    setBusy(true);
    try {
      if (isEdit) await api.put(`/routers/${router.id}`, form);
      else await api.post('/routers', form);
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">{isEdit ? 'Edit Router' : 'Add Router'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block"><span className="text-sm text-slate-600 mb-1 block">Name</span>
            <input className="input" value={form.name || ''} onChange={(e) => set({ name: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-sm text-slate-600 mb-1 block">Host / IP</span>
              <input className="input" value={form.host || ''} onChange={(e) => set({ host: e.target.value })} /></label>
            <label className="block"><span className="text-sm text-slate-600 mb-1 block">API Port</span>
              <input className="input" type="number" value={form.port || 8728} onChange={(e) => set({ port: Number(e.target.value) })} /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-sm text-slate-600 mb-1 block">API User</span>
              <input className="input" value={form.api_user || ''} onChange={(e) => set({ api_user: e.target.value })} /></label>
            <label className="block"><span className="text-sm text-slate-600 mb-1 block">API Password</span>
              <input className="input" type="password" placeholder={isEdit ? '(leave blank to keep)' : ''} value={form.api_pass || ''} onChange={(e) => set({ api_pass: e.target.value })} /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-sm text-slate-600 mb-1 block">Type</span>
              <select className="input" value={form.type || 'pppoe'} onChange={(e) => set({ type: e.target.value })}>
                <option value="pppoe">PPPoE</option>
                <option value="ipoe">IPoE</option>
              </select></label>
            <label className="block"><span className="text-sm text-slate-600 mb-1 block">Board</span>
              <input className="input" value={form.board || ''} onChange={(e) => set({ board: e.target.value })} /></label>
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

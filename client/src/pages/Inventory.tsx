import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge, Stat } from '../components/ui';
import { api, peso } from '../api';

export default function Inventory() {
  const [items, setItems] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);

  const load = () => api.get('/inventory').then((r) => setItems(r.data));
  useEffect(() => {
    load();
  }, []);

  const totalValue = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const lowStock = items.filter((i) => i.status !== 'In Stock').length;

  const del = async (id: number) => {
    await api.delete(`/inventory/${id}`);
    load();
  };

  return (
    <Layout title="Stock & Inventory">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5 mb-5">
        <Card><Stat label="SKUs" value={items.length} /></Card>
        <Card><Stat label="Inventory Value" value={peso(totalValue)} /></Card>
        <Card><Stat label="Needs Restock" value={lowStock} /></Card>
      </div>

      <Card title="Items" right={<button className="btn-primary" onClick={() => setEdit({ name: '', category: '', sku: '', quantity: 0, unit_price: 0 })}><Plus size={16} /> Add Item</button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-left border-b border-slate-100">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 font-medium">Category</th>
                <th className="py-2 font-medium">SKU</th>
                <th className="py-2 font-medium text-right">Qty</th>
                <th className="py-2 font-medium text-right">Unit Price</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b border-slate-50">
                  <td className="py-2 text-slate-800 font-medium">{i.name}</td>
                  <td className="py-2 text-slate-500">{i.category}</td>
                  <td className="py-2 text-slate-500">{i.sku}</td>
                  <td className="py-2 text-right text-slate-700">{i.quantity}</td>
                  <td className="py-2 text-right text-slate-700">{peso(i.unitPrice)}</td>
                  <td className="py-2"><StatusBadge status={i.status} /></td>
                  <td className="py-2">
                    <div className="flex items-center justify-end gap-3 text-slate-400">
                      <button className="hover:text-sky-600" onClick={() => setEdit({ ...i, unit_price: i.unitPrice })}><Pencil size={16} /></button>
                      <button className="hover:text-rose-600" onClick={() => del(i.id)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-slate-400">No items yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {edit && (
        <ItemModal
          item={edit}
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

function ItemModal({ item, onClose, onSaved }: any) {
  const [form, setForm] = useState({ ...item });
  const [busy, setBusy] = useState(false);
  const isEdit = !!item.id;
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));
  const save = async () => {
    if (!form.name?.trim()) return;
    setBusy(true);
    try {
      if (isEdit) await api.put(`/inventory/${item.id}`, form);
      else await api.post('/inventory', form);
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700">{isEdit ? 'Edit Item' : 'Add Item'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block"><span className="text-sm text-slate-600 mb-1 block">Name</span>
            <input className="input" value={form.name || ''} onChange={(e) => set({ name: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-sm text-slate-600 mb-1 block">Category</span>
              <input className="input" value={form.category || ''} onChange={(e) => set({ category: e.target.value })} /></label>
            <label className="block"><span className="text-sm text-slate-600 mb-1 block">SKU</span>
              <input className="input" value={form.sku || ''} onChange={(e) => set({ sku: e.target.value })} /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-sm text-slate-600 mb-1 block">Quantity</span>
              <input className="input" type="number" value={form.quantity ?? 0} onChange={(e) => set({ quantity: Number(e.target.value) })} /></label>
            <label className="block"><span className="text-sm text-slate-600 mb-1 block">Unit Price</span>
              <input className="input" type="number" value={form.unit_price ?? 0} onChange={(e) => set({ unit_price: Number(e.target.value) })} /></label>
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

import { useEffect, useState } from 'react';
import { Ticket, Trash2, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge } from '../components/ui';
import { api, peso } from '../api';

const PLAN_NAMES = ['1 Hour', '1 Day', '1 Week', '30 Days'];

export default function Hotspot() {
  const [data, setData] = useState<{ plans: any[]; active: any[] }>({ plans: [], active: [] });
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [plan, setPlan] = useState('1 Day');
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);

  const loadVouchers = () => api.get('/hotspot/vouchers').then((r) => setVouchers(r.data));
  useEffect(() => {
    api.get('/hotspot').then((r) => setData(r.data));
    loadVouchers();
  }, []);

  const generate = async () => {
    setBusy(true);
    try {
      await api.post('/hotspot/vouchers/generate', { plan, count });
      loadVouchers();
    } finally {
      setBusy(false);
    }
  };
  const del = async (id: number) => {
    await api.delete(`/hotspot/vouchers/${id}`);
    loadVouchers();
  };

  const unused = vouchers.filter((v) => v.status === 'unused').length;

  return (
    <Layout title="Hotspot">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Card title="Voucher Plans">
          <div className="grid grid-cols-2 gap-3">
            {data.plans.map((p) => (
              <div key={p.name} className="rounded-lg border border-slate-100 p-4">
                <div className="font-semibold text-slate-800">{p.name}</div>
                <div className="text-2xl font-bold text-brand-600 my-1">{peso(p.price)}</div>
                <div className="text-xs text-slate-400">{p.speed} · valid {p.validity}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Active Hotspot Users">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-left border-b border-slate-100">
                <th className="py-2 font-medium">Voucher</th>
                <th className="py-2 font-medium">Plan</th>
                <th className="py-2 font-medium">Address</th>
                <th className="py-2 font-medium">Uptime</th>
              </tr>
            </thead>
            <tbody>
              {data.active.map((a) => (
                <tr key={a.voucher} className="border-b border-slate-50">
                  <td className="py-2 text-slate-800 font-medium">{a.voucher}</td>
                  <td className="py-2 text-slate-500">{a.plan}</td>
                  <td className="py-2 text-slate-500">{a.address}</td>
                  <td className="py-2 text-slate-500">{a.uptime}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="mt-5">
        <Card
          title="Voucher Management"
          right={
            <div className="flex items-center gap-2">
              <select className="text-sm border border-slate-200 rounded-lg px-2 py-1.5" value={plan} onChange={(e) => setPlan(e.target.value)}>
                {PLAN_NAMES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 w-20" type="number" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              <button className="btn-primary" onClick={generate} disabled={busy}><Plus size={16} /> {busy ? 'Generating…' : 'Generate'}</button>
            </div>
          }
        >
          <div className="text-sm text-slate-500 mb-3 flex items-center gap-2"><Ticket size={16} className="text-brand-500" /> {vouchers.length} vouchers · <span className="text-emerald-600 font-medium">{unused} unused</span></div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-slate-400 text-left border-b border-slate-100">
                  <th className="py-2 font-medium">Code</th>
                  <th className="py-2 font-medium">Plan</th>
                  <th className="py-2 font-medium text-right">Price</th>
                  <th className="py-2 font-medium">Speed</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) => (
                  <tr key={v.id} className="border-b border-slate-50">
                    <td className="py-2 font-mono font-medium text-slate-800">{v.code}</td>
                    <td className="py-2 text-slate-500">{v.plan}</td>
                    <td className="py-2 text-right text-slate-700">{peso(v.price)}</td>
                    <td className="py-2 text-slate-500">{v.speed}</td>
                    <td className="py-2"><StatusBadge status={v.status === 'unused' ? 'Active' : 'inactive'} /></td>
                    <td className="py-2 text-right">
                      <button className="text-slate-400 hover:text-rose-600" onClick={() => del(v.id)}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
                {vouchers.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-400">No vouchers yet. Generate a batch above.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Layout>
  );
}

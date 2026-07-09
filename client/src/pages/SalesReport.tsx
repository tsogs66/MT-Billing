import { useEffect, useState } from 'react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import Layout from '../components/Layout';
import { Card, Stat } from '../components/ui';
import { api, peso } from '../api';

const RANGES = [
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
  { key: '6m', label: '6 Months' },
  { key: '1y', label: '1 Year' },
];

export default function SalesReport() {
  const [range, setRange] = useState('30d');
  const [sales, setSales] = useState<any>(null);
  const [tx, setTx] = useState<any[]>([]);

  useEffect(() => {
    api.get(`/sales?range=${range}`).then((r) => setSales(r.data));
  }, [range]);
  useEffect(() => {
    api.get('/sales/transactions').then((r) => setTx(r.data));
  }, []);

  return (
    <Layout title="Sales Report">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-5">
        <Card><Stat label="Net Revenue" value={peso(sales?.total ?? 0)} /></Card>
        <Card><Stat label="Transactions" value={sales?.transactions ?? 0} /></Card>
        <Card><Stat label="Average / day" value={peso(sales?.avgPerDay ?? 0)} /></Card>
        <Card><Stat label="Best day" value={peso(sales?.best ?? 0)} /></Card>
      </div>

      <Card title="Revenue" right={
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)} className={`text-xs px-2.5 py-1 rounded-md ${range === r.key ? 'bg-brand-500 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {r.label}
            </button>
          ))}
        </div>
      }>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sales?.series ?? []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => String(v).slice(5)} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} width={40} />
              <Tooltip formatter={(v: number) => peso(v)} />
              <Bar dataKey="value" fill="#f97316" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="mt-5">
        <Card title="Recent Transactions">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-left border-b border-slate-100">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Customer</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {tx.slice(0, 50).map((t) => (
                  <tr key={t.id} className="border-b border-slate-50">
                    <td className="py-2 text-slate-500">{new Date(t.date).toLocaleString()}</td>
                    <td className="py-2 text-slate-700">{t.customer}</td>
                    <td className="py-2 text-slate-500 capitalize">{t.type}</td>
                    <td className="py-2 text-right font-medium text-emerald-600">{peso(t.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Layout>
  );
}

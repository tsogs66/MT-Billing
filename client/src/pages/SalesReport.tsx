import { useEffect, useState } from 'react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Wallet, Receipt, TrendingUp, CalendarDays } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatTile, TabPills, DataTable } from '../components/ui';
import { api, peso } from '../api';

const GROUPS = [
  { key: 'week', label: 'Weekly' },
  { key: 'month', label: 'Monthly' },
  { key: 'year', label: 'Yearly' },
];

export default function SalesReport() {
  const [range, setRange] = useState('month');
  const [sales, setSales] = useState<any>(null);
  const [tx, setTx] = useState<any[]>([]);

  useEffect(() => {
    api.get(`/sales?group=${range}`).then((r) => setSales(r.data));
  }, [range]);
  useEffect(() => {
    api.get('/sales/transactions').then((r) => setTx(r.data));
  }, []);

  return (
    <Layout title="Sales Report">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-5">
        <StatTile label="Net Revenue" value={peso(sales?.total ?? 0)} icon={Wallet} tone="text-brand-600" accent="from-brand-500/15 to-transparent" delay={0} />
        <StatTile label="Transactions" value={sales?.transactions ?? 0} icon={Receipt} delay={50} />
        <StatTile label="Average / day" value={peso(sales?.avgPerDay ?? 0)} icon={TrendingUp} accent="from-sky-500/15 to-transparent" delay={100} />
        <StatTile label="Best day" value={peso(sales?.best ?? 0)} icon={CalendarDays} accent="from-emerald-500/15 to-transparent" tone="text-emerald-600" delay={150} />
      </div>

      <Card title="Revenue" interactive right={<TabPills tabs={GROUPS} active={range} onChange={setRange} />}>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sales?.series ?? []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salesBar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fb923c" stopOpacity={1} />
                  <stop offset="100%" stopColor="#f97316" stopOpacity={0.75} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => (String(v).includes('-') ? String(v).slice(5) : String(v))} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} width={40} />
              <Tooltip formatter={(v: number) => peso(v)} labelStyle={{ color: '#334155' }} contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }} />
              <Bar dataKey="value" fill="url(#salesBar)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="mt-5">
        <Card title="Recent Transactions">
          <DataTable
            columns={[
              { key: 'date', label: 'Date' },
              { key: 'customer', label: 'Customer' },
              { key: 'type', label: 'Type' },
              { key: 'amount', label: 'Amount', align: 'right' },
            ]}
            rows={tx.slice(0, 50).map((t) => ({
              key: t.id,
              cells: [
                <span className="text-slate-500">{new Date(t.date).toLocaleString()}</span>,
                <span className="text-slate-700">{t.customer}</span>,
                <span className="text-slate-500 capitalize">{t.type}</span>,
                <span className="font-medium text-emerald-600">{peso(t.amount)}</span>,
              ],
            }))}
            emptyMessage="No transactions yet."
          />
        </Card>
      </div>
    </Layout>
  );
}

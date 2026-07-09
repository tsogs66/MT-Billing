import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card } from '../components/ui';
import { api, peso } from '../api';

export default function Hotspot() {
  const [data, setData] = useState<{ plans: any[]; active: any[] }>({ plans: [], active: [] });
  useEffect(() => {
    api.get('/hotspot').then((r) => setData(r.data));
  }, []);

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
    </Layout>
  );
}

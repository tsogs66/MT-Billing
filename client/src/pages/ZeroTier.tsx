import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge } from '../components/ui';
import { api } from '../api';

export default function ZeroTier() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api.get('/zerotier').then((r) => setData(r.data));
  }, []);
  if (!data) return <Layout title="ZeroTier"><div className="text-slate-400">Loading…</div></Layout>;

  return (
    <Layout title="ZeroTier">
      <Card className="max-w-4xl mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center"><Globe size={20} /></div>
          <div>
            <div className="font-semibold text-slate-800">Node {data.address}</div>
            <div className="text-xs text-slate-400">Local ZeroTier controller status</div>
          </div>
          <div className="ml-auto"><StatusBadge status={data.online ? 'online' : 'offline'} /></div>
        </div>
      </Card>

      {data.networks.map((n: any) => (
        <Card key={n.id} title={n.name} className="max-w-4xl mb-5" right={<span className="text-xs text-slate-400 font-mono">{n.id}</span>}>
          <div className="text-sm text-slate-500 mb-3">Assigned IP: <span className="font-medium text-slate-700">{n.assignedIp}</span> · Status: <StatusBadge status={n.status === 'OK' ? 'Active' : 'offline'} /></div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-left border-b border-slate-100">
                <th className="py-2 font-medium">Member</th>
                <th className="py-2 font-medium">Managed IP</th>
                <th className="py-2 font-medium">Authorized</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {n.members.map((m: any) => (
                <tr key={m.name} className="border-b border-slate-50">
                  <td className="py-2 font-medium text-slate-800">{m.name}</td>
                  <td className="py-2 font-mono text-slate-600">{m.ip}</td>
                  <td className="py-2"><StatusBadge status={m.authorized ? 'Active' : 'inactive'} /></td>
                  <td className="py-2"><StatusBadge status={m.online ? 'online' : 'offline'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </Layout>
  );
}

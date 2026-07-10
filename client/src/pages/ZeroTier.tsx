import { useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge, DataTable, LoadingPage, PageHeader } from '../components/ui';
import { api } from '../api';

export default function ZeroTier() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api.get('/zerotier').then((r) => setData(r.data));
  }, []);
  if (!data) return <Layout title="ZeroTier"><LoadingPage /></Layout>;

  return (
    <Layout title="ZeroTier">
      <PageHeader title="ZeroTier Networks" description="Local ZeroTier controller status and member management." icon={Globe} />

      <Card className="max-w-4xl mb-5" interactive>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center"><Globe size={20} /></div>
          <div>
            <div className="font-bold text-slate-800">Node {data.address}</div>
            <div className="text-xs text-slate-400">Local ZeroTier controller status</div>
          </div>
          <div className="ml-auto"><StatusBadge status={data.online ? 'online' : 'offline'} /></div>
        </div>
      </Card>

      {data.networks.map((n: any) => (
        <Card key={n.id} title={n.name} className="max-w-4xl mb-5" interactive noPadding right={<span className="text-xs text-slate-400 font-mono">{n.id}</span>}>
          <div className="px-5 py-3 text-sm text-slate-500 border-b border-slate-100">
            Assigned IP: <span className="font-semibold text-slate-700">{n.assignedIp}</span> · Status: <StatusBadge status={n.status === 'OK' ? 'Active' : 'offline'} />
          </div>
          <div className="p-4">
            <DataTable
              columns={[
                { key: 'name', label: 'Member' },
                { key: 'ip', label: 'Managed IP' },
                { key: 'auth', label: 'Authorized' },
                { key: 'status', label: 'Status' },
              ]}
              rows={n.members.map((m: any) => ({
                key: m.name,
                cells: [
                  <span className="font-semibold text-slate-800">{m.name}</span>,
                  <span className="font-mono text-slate-600">{m.ip}</span>,
                  <StatusBadge status={m.authorized ? 'Active' : 'inactive'} />,
                  <StatusBadge status={m.online ? 'online' : 'offline'} />,
                ],
              }))}
              emptyMessage="No members in this network."
            />
          </div>
        </Card>
      ))}
    </Layout>
  );
}

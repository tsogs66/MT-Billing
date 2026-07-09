import { useEffect, useState } from 'react';
import { Router as RouterIcon } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, StatusBadge } from '../components/ui';
import { api } from '../api';

export default function Routers() {
  const [routers, setRouters] = useState<any[]>([]);
  useEffect(() => {
    api.get('/routers').then((r) => setRouters(r.data));
  }, []);

  return (
    <Layout title="Routers">
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
              </div>
            </div>
          </Card>
        ))}
      </div>
    </Layout>
  );
}

import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card } from '../components/ui';
import { api } from '../api';

const LEVEL: Record<string, string> = {
  info: 'bg-sky-100 text-sky-700',
  warning: 'bg-amber-100 text-amber-700',
  error: 'bg-rose-100 text-rose-700',
};

export default function Logs() {
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => {
    api.get('/logs').then((r) => setLogs(r.data));
  }, []);

  return (
    <Layout title="System Logs">
      <Card title="Recent Events">
        <div className="space-y-1 font-mono text-sm">
          {logs.map((l) => (
            <div key={l.id} className="flex items-center gap-3 py-1.5 border-b border-slate-50">
              <span className="text-slate-400 w-40 shrink-0">{new Date(l.date).toLocaleString()}</span>
              <span className={`badge ${LEVEL[l.level] || 'bg-slate-100 text-slate-600'}`}>{l.level}</span>
              <span className="text-slate-400 w-20 shrink-0">{l.source}</span>
              <span className="text-slate-700">{l.message}</span>
            </div>
          ))}
        </div>
      </Card>
    </Layout>
  );
}

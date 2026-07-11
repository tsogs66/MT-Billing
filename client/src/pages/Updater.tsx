import { useEffect, useState } from 'react';
import { DownloadCloud, RefreshCw } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, Flash, LoadingPage, PageHeader } from '../components/ui';
import { api } from '../api';

export default function Updater() {
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => api.get('/updater').then((r) => setInfo(r.data));
  useEffect(() => {
    load();
  }, []);

  const check = async () => {
    setBusy(true);
    setMsg('');
    try {
      await api.post('/updater/check');
      await load();
      setMsg('Checked for updates.');
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.post('/updater/apply');
      setMsg(r.data.message);
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <Layout title="Updater"><LoadingPage /></Layout>;

  return (
    <Layout title="Updater">
      <PageHeader title="Application Updater" description="Check for and apply panel updates." icon={DownloadCloud} />
      <Flash message={msg} type="success" onDismiss={() => setMsg('')} />

      <Card className="max-w-3xl" interactive>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center"><DownloadCloud size={22} /></div>
          <div>
            <div className="font-bold text-slate-800">Panel {info.current}</div>
            <div className="text-sm text-slate-500">Latest available: <span className="font-semibold text-slate-700">{info.latest}</span></div>
          </div>
          <div className="ml-auto">
            {info.updateAvailable ? (
              <span className="badge bg-amber-100 text-amber-700 ring-1 ring-amber-200/60">Update available</span>
            ) : (
              <span className="badge bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/60">Up to date</span>
            )}
          </div>
        </div>

        <div className="mt-6 rounded-xl bg-slate-50 border border-slate-100 p-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">What&apos;s new in {info.latest}</div>
          <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
            {info.changelog.map((c: string, i: number) => <li key={i}>{c}</li>)}
          </ul>
        </div>

        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <button type="button" className="btn-secondary" onClick={check} disabled={busy}>
            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Check for updates
          </button>
          <button type="button" className="btn-primary" onClick={apply} disabled={busy || !info.updateAvailable}>
            <DownloadCloud size={16} /> Update to {info.latest}
          </button>
        </div>
        <div className="text-xs text-slate-400 mt-3">Last checked: {new Date(info.lastChecked).toLocaleString()}</div>
      </Card>
    </Layout>
  );
}

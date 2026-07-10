import { useEffect, useState } from 'react';
import { DownloadCloud, RefreshCw, CheckCircle2 } from 'lucide-react';
import Layout from '../components/Layout';
import { Card } from '../components/ui';
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

  if (!info) return <Layout title="Updater"><div className="text-slate-400">Loading…</div></Layout>;

  return (
    <Layout title="Updater">
      <Card className="max-w-3xl">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center"><DownloadCloud size={22} /></div>
          <div>
            <div className="font-semibold text-slate-800">MT-Billing {info.current}</div>
            <div className="text-sm text-slate-400">Latest available: <span className="font-medium text-slate-600">{info.latest}</span></div>
          </div>
          <div className="ml-auto">
            {info.updateAvailable ? (
              <span className="badge bg-amber-100 text-amber-700">Update available</span>
            ) : (
              <span className="badge bg-emerald-100 text-emerald-700">Up to date</span>
            )}
          </div>
        </div>

        <div className="mt-5">
          <div className="text-sm font-semibold text-slate-700 mb-2">What's new in {info.latest}</div>
          <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
            {info.changelog.map((c: string, i: number) => <li key={i}>{c}</li>)}
          </ul>
        </div>

        {msg && <div className="mt-4 text-sm bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg px-3 py-2 flex items-center gap-2"><CheckCircle2 size={16} /> {msg}</div>}

        <div className="mt-5 flex items-center gap-2">
          <button className="inline-flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 text-slate-600" onClick={check} disabled={busy}>
            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Check for updates
          </button>
          <button className="btn-primary" onClick={apply} disabled={busy || !info.updateAvailable}>
            <DownloadCloud size={16} /> Update to {info.latest}
          </button>
        </div>
        <div className="text-xs text-slate-400 mt-3">Last checked: {new Date(info.lastChecked).toLocaleString()}</div>
      </Card>
    </Layout>
  );
}

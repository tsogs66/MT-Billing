import { useEffect, useState } from 'react';
import { DownloadCloud, RefreshCw, ExternalLink, GitBranch } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, Flash, LoadingPage, PageHeader } from '../components/ui';
import { api } from '../api';

export default function Updater() {
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () =>
    api
      .get('/updater')
      .then((r) => setInfo(r.data))
      .catch((e) => setErr(e?.response?.data?.error || 'Could not load updater status'));

  useEffect(() => {
    load();
  }, []);

  const check = async () => {
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      await api.post('/updater/check');
      await load();
      setMsg('Checked GitHub for updates.');
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Check failed');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!confirm('Pull the latest code from GitHub and restart the panel?')) return;
    setBusy(true);
    setMsg('');
    setErr('');
    try {
      const r = await api.post('/updater/apply');
      setMsg(r.data.message || 'Update started.');
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.response?.data?.error || 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  if (!info && !err) return <Layout title="Updater"><LoadingPage /></Layout>;

  return (
    <Layout title="Updater">
      <PageHeader title="Application Updater" description="Pull updates from the official GitHub repository." icon={DownloadCloud} />
      <Flash message={msg} type="success" onDismiss={() => setMsg('')} />
      {err && <Flash message={err} type="error" onDismiss={() => setErr('')} />}

      <Card className="max-w-3xl" interactive>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
            <DownloadCloud size={22} />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-800">Panel {info?.current || '—'}</div>
            <div className="text-sm text-slate-500">
              Latest on GitHub: <span className="font-semibold text-slate-700">{info?.latest || '—'}</span>
            </div>
          </div>
          <div className="ml-auto shrink-0">
            {info?.updateAvailable ? (
              <span className="badge bg-amber-100 text-amber-700 ring-1 ring-amber-200/60">Update available</span>
            ) : (
              <span className="badge bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/60">Up to date</span>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
          <a
            href={info?.repo || 'https://github.com/tsogs66/MT-Billing'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand-700 hover:underline font-medium"
          >
            <ExternalLink size={12} /> {info?.repo || 'https://github.com/tsogs66/MT-Billing'}
          </a>
          <span className="inline-flex items-center gap-1">
            <GitBranch size={12} /> branch <b className="text-slate-700">{info?.branch || 'main'}</b>
          </span>
        </div>

        {info?.error && (
          <div className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{info.error}</div>
        )}

        <div className="mt-6 rounded-xl bg-slate-50 border border-slate-100 p-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">
            {info?.updateAvailable ? `Commits waiting on ${info?.branch || 'main'}` : 'Status'}
          </div>
          <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
            {(info?.changelog || []).map((c: string, i: number) => (
              <li key={i}>{c}</li>
            ))}
            {!(info?.changelog || []).length && <li className="text-slate-400">No changelog entries.</li>}
          </ul>
        </div>

        <div className="mt-5 flex items-center gap-2 flex-wrap">
          <button type="button" className="btn-secondary" onClick={check} disabled={busy}>
            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Check for updates
          </button>
          <button type="button" className="btn-primary" onClick={apply} disabled={busy || !info?.updateAvailable}>
            <DownloadCloud size={16} /> Update from GitHub
          </button>
        </div>
        <div className="text-xs text-slate-400 mt-3">
          Last checked: {info?.lastChecked ? new Date(info.lastChecked).toLocaleString() : '—'}
          {info?.currentSha && info?.latestSha ? (
            <>
              {' · '}
              <span className="font-mono">{String(info.currentSha).slice(0, 7)}</span>
              {' → '}
              <span className="font-mono">{String(info.latestSha).slice(0, 7)}</span>
            </>
          ) : null}
        </div>
      </Card>
    </Layout>
  );
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DownloadCloud, RefreshCw, ExternalLink, GitBranch, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, Flash, LoadingPage, PageHeader, Modal } from '../components/ui';
import { api } from '../api';

type Phase = 'idle' | 'updating' | 'success' | 'failed';

const POLL_MS = 2500;
const TIMEOUT_MS = 15 * 60 * 1000;

export default function Updater() {
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [statusText, setStatusText] = useState('');
  const [result, setResult] = useState<{ title: string; detail: string; from?: string; to?: string } | null>(null);
  const pollRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const targetShaRef = useRef<string | null>(null);
  const fromShaRef = useRef<string | null>(null);

  const stopPoll = () => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const load = () =>
    api
      .get('/updater')
      .then((r) => setInfo(r.data))
      .catch((e) => setErr(e?.response?.data?.error || 'Could not load updater status'));

  useEffect(() => {
    load();
    return () => stopPoll();
  }, []);

  // Freeze navigation / body scroll while updating
  useEffect(() => {
    if (phase !== 'updating') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const block = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', block);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('beforeunload', block);
    };
  }, [phase]);

  const short = (sha?: string | null) => (sha ? String(sha).slice(0, 7) : '—');

  const finishSuccess = (detail: string, from?: string | null, to?: string | null) => {
    stopPoll();
    setPhase('success');
    setBusy(false);
    setResult({
      title: 'Update complete',
      detail,
      from: from || fromShaRef.current || undefined,
      to: to || targetShaRef.current || undefined,
    });
    load();
  };

  const finishFailed = (detail: string) => {
    stopPoll();
    setPhase('failed');
    setBusy(false);
    setResult({
      title: 'Update failed',
      detail,
      from: fromShaRef.current || undefined,
      to: targetShaRef.current || undefined,
    });
    load();
  };

  const startPolling = () => {
    stopPoll();
    startedAtRef.current = Date.now();
    setStatusText('Update started. Waiting for the panel to restart…');

    const tick = async () => {
      if (Date.now() - startedAtRef.current > TIMEOUT_MS) {
        finishFailed('Update timed out after 15 minutes. Check the LXC logs or run install/mt-billing-update.sh manually.');
        return;
      }

      try {
        // Lightweight reachability probe (no auth)
        await fetch('/api/health', { cache: 'no-store' }).then((r) => {
          if (!r.ok) throw new Error('health');
        });
      } catch {
        setStatusText('Panel offline while updating — rebuilding and restarting services…');
        return;
      }

      try {
        const r = await api.get('/updater');
        const data = r.data;
        setInfo(data);
        const job = data.job;
        const jobStarted = job?.startedAt || job?.at;
        const jobIsOurs =
          !jobStarted ||
          Date.parse(jobStarted) >= startedAtRef.current - 5000 ||
          (fromShaRef.current && job?.from && String(job.from).toLowerCase() === String(fromShaRef.current).toLowerCase());

        if (job?.status === 'running' && jobIsOurs) {
          setStatusText(job.message || 'Update in progress…');
          return;
        }

        if (job?.status === 'failed' && jobIsOurs) {
          finishFailed(job.message || 'Update failed. See server logs for details.');
          return;
        }

        const current = data.currentSha ? String(data.currentSha).toLowerCase() : '';
        const target = targetShaRef.current ? String(targetShaRef.current).toLowerCase() : '';
        const reachedTarget = target && current && current === target;
        const jobUpdated = job?.status === 'updated' && jobIsOurs;
        const upToDate = data.updateAvailable === false && current;

        if (jobUpdated || reachedTarget || (upToDate && Date.now() - startedAtRef.current > 8000)) {
          const to = job?.to || data.currentSha || targetShaRef.current;
          const from = job?.from || fromShaRef.current;
          finishSuccess(
            job?.message ||
              `Panel is now on ${short(to)}. You can continue using the panel.`,
            from,
            to
          );
          return;
        }

        setStatusText(job?.message || 'Panel is back — verifying version…');
      } catch {
        setStatusText('Waiting for API to come back online…');
      }
    };

    void tick();
    pollRef.current = window.setInterval(() => {
      void tick();
    }, POLL_MS);
  };

  const check = async () => {
    if (phase === 'updating') return;
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
    if (phase === 'updating') return;
    if (!confirm('Pull the latest code from GitHub and restart the panel?\n\nDo not close or navigate away until the update finishes.')) return;
    setBusy(true);
    setMsg('');
    setErr('');
    setResult(null);
    fromShaRef.current = info?.currentSha || null;
    targetShaRef.current = info?.latestSha || null;
    setPhase('updating');
    setStatusText('Starting update…');

    try {
      const r = await api.post('/updater/apply');
      if (r.data.fromSha) fromShaRef.current = r.data.fromSha;
      if (r.data.targetSha) targetShaRef.current = r.data.targetSha;
      setStatusText(r.data.message || 'Update started…');
      startPolling();
    } catch (e: any) {
      setPhase('idle');
      setBusy(false);
      setErr(e?.response?.data?.message || e?.response?.data?.error || 'Update failed');
    }
  };

  const dismissResult = () => {
    setPhase('idle');
    setResult(null);
    setStatusText('');
    setMsg(result?.title === 'Update complete' ? 'Panel updated successfully.' : '');
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
          <button type="button" className="btn-secondary" onClick={check} disabled={busy || phase === 'updating'}>
            <RefreshCw size={15} className={busy && phase !== 'updating' ? 'animate-spin' : ''} /> Check for updates
          </button>
          <button type="button" className="btn-primary" onClick={apply} disabled={busy || phase === 'updating' || !info?.updateAvailable}>
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

      {phase === 'updating' &&
        createPortal(
          <div
            className="fixed inset-0 z-[3000] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
            role="alertdialog"
            aria-modal="true"
            aria-busy="true"
            aria-label="Update in progress"
          >
            <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-6 text-center">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
                <Loader2 size={28} className="animate-spin" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Updating panel</h2>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">{statusText}</p>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-4">
                Do not close this tab or navigate away until the update finishes.
              </p>
              {(fromShaRef.current || targetShaRef.current) && (
                <p className="text-xs text-slate-400 mt-3 font-mono">
                  {short(fromShaRef.current)} → {short(targetShaRef.current)}
                </p>
              )}
            </div>
          </div>,
          document.body
        )}

      {(phase === 'success' || phase === 'failed') && result && (
        <Modal
          title={result.title}
          subtitle={phase === 'success' ? 'The panel restarted successfully.' : 'The update did not finish cleanly.'}
          onClose={dismissResult}
          footer={
            <button type="button" className="btn-primary" onClick={dismissResult}>
              OK
            </button>
          }
        >
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                phase === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
              }`}
            >
              {phase === 'success' ? <CheckCircle2 size={22} /> : <XCircle size={22} />}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-slate-600 leading-relaxed">{result.detail}</p>
              {(result.from || result.to) && (
                <p className="text-xs text-slate-400 mt-3 font-mono">
                  {short(result.from)} → {short(result.to)}
                </p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

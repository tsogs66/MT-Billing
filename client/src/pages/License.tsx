import { useEffect, useState } from 'react';
import { KeyRound, Copy, CheckCircle2, ShieldCheck, ShieldAlert } from 'lucide-react';
import Layout from '../components/Layout';
import { Card } from '../components/ui';
import { api } from '../api';

export default function License() {
  const [info, setInfo] = useState<any>(null);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/license').then((r) => setInfo(r.data));
  useEffect(() => {
    load();
  }, []);

  const copyHwid = () => {
    navigator.clipboard?.writeText(info.hardwareId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activate = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/license/activate', { key });
      setKey('');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Activation failed');
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    await api.post('/license/deactivate');
    load();
  };

  if (!info) return <Layout title="License"><div className="text-slate-400">Loading…</div></Layout>;

  return (
    <Layout title="License">
      <Card className="max-w-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${info.activated ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
            {info.activated ? <ShieldCheck size={22} /> : <ShieldAlert size={22} />}
          </div>
          <div>
            <div className="font-semibold text-slate-800">{info.product} — {info.edition}</div>
            <div className="text-sm text-slate-400">{info.activated ? 'This installation is licensed.' : 'Activate the panel with a license key.'}</div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Hardware ID</span>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 font-mono">{info.hardwareId}</code>
              <button className="inline-flex items-center gap-1.5 text-sm border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 text-slate-600" onClick={copyHwid}>
                {copied ? <CheckCircle2 size={15} className="text-emerald-600" /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">Send this Hardware ID to your vendor to receive a matching license key.</p>
          </div>

          {info.activated ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-4">
              <div className="text-sm text-emerald-700 flex items-center gap-2"><ShieldCheck size={16} /> Licensed</div>
              <div className="text-xs text-slate-500 mt-1 font-mono">{info.licenseKey}</div>
              <button className="mt-3 text-sm text-rose-600 hover:text-rose-700" onClick={deactivate}>Deactivate</button>
            </div>
          ) : (
            <div>
              <span className="text-sm font-semibold text-slate-700 mb-1 block">License Key</span>
              <div className="flex items-center gap-2">
                <input className="input font-mono" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" value={key} onChange={(e) => setKey(e.target.value)} />
                <button className="btn-primary" onClick={activate} disabled={busy}><KeyRound size={16} /> {busy ? 'Activating…' : 'Activate'}</button>
              </div>
              {error && <div className="text-sm text-rose-600 mt-2">{error}</div>}
            </div>
          )}

          <div className="text-xs text-slate-400 border-t border-slate-100 pt-3">
            Vendor tool: generate a key from a Hardware ID using the Windows activator
            (<code className="mx-1 bg-slate-100 px-1.5 py-0.5 rounded">activator/</code> — build
            <code className="mx-1 bg-slate-100 px-1.5 py-0.5 rounded">mt-billing-activator.exe</code>
            or double-click <code className="mx-1 bg-slate-100 px-1.5 py-0.5 rounded">activator.html</code>).
          </div>
        </div>
      </Card>
    </Layout>
  );
}

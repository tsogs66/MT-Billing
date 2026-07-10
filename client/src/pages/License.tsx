import { useEffect, useState } from 'react';
import { KeyRound, Copy, CheckCircle2, ShieldCheck, ShieldAlert } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, Flash, FormField, LoadingPage, PageHeader } from '../components/ui';
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

  if (!info) return <Layout title="License"><LoadingPage /></Layout>;

  return (
    <Layout title="License">
      <PageHeader title="Panel License" description="Activate MT-Billing with a license key from your vendor." icon={KeyRound} />
      <Flash message={error} type="error" onDismiss={() => setError('')} />

      <Card className="max-w-2xl" interactive>
        <div className="flex items-center gap-3 mb-6">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${info.activated ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
            {info.activated ? <ShieldCheck size={24} /> : <ShieldAlert size={24} />}
          </div>
          <div>
            <div className="font-bold text-slate-800">{info.product} — {info.edition}</div>
            <div className="text-sm text-slate-500">{info.activated ? 'This installation is licensed.' : 'Activate the panel with a license key.'}</div>
          </div>
        </div>

        <div className="space-y-5">
          <FormField label="Hardware ID" hint="Send this Hardware ID to your vendor to receive a matching license key.">
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-700 font-mono text-sm">{info.hardwareId}</code>
              <button type="button" className="btn-secondary shrink-0" onClick={copyHwid}>
                {copied ? <CheckCircle2 size={15} className="text-emerald-600" /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </FormField>

          {info.activated ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
              <div className="text-sm text-emerald-700 flex items-center gap-2 font-medium"><ShieldCheck size={16} /> Licensed</div>
              <div className="text-xs text-slate-500 mt-1 font-mono">{info.licenseKey}</div>
              <button type="button" className="mt-3 text-sm text-rose-600 hover:text-rose-700 font-medium" onClick={deactivate}>Deactivate</button>
            </div>
          ) : (
            <FormField label="License Key">
              <div className="flex items-center gap-2">
                <input className="input font-mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX" />
                <button type="button" className="btn-primary shrink-0" onClick={activate} disabled={busy || !key.trim()}>
                  {busy ? 'Activating…' : 'Activate'}
                </button>
              </div>
            </FormField>
          )}
        </div>
      </Card>
    </Layout>
  );
}

import { useEffect, useState } from 'react';
import { Copy, Link2, Plus, Trash2, RefreshCw } from 'lucide-react';
import Layout from '../components/Layout';
import { Card, Toolbar, StatusBadge, IconAction } from '../components/ui';
import { api, peso } from '../api';

export default function PayPortal() {
  const [links, setLinks] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [userId, setUserId] = useState('');
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const show = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 4000);
  };

  const load = () => {
    api.get('/payment-links').then((r) => setLinks(r.data.links || []));
    api.get('/clients').then((r) => setClients(r.data || [])).catch(() => setClients([]));
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const baseUrl = window.location.origin;
      const r = await api.post('/payment-links', { userId: Number(userId), months, baseUrl });
      const full = r.data.url?.startsWith('http') ? r.data.url : `${baseUrl}${r.data.path || r.data.url}`;
      try {
        await navigator.clipboard.writeText(full);
        show(`Pay link created and copied: ${full}`);
      } catch {
        show(`Pay link created: ${full}`);
      }
      load();
    } catch (e: any) {
      show(e?.response?.data?.error || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (link: any) => {
    const full = link.token
      ? `${window.location.origin}/pay/${link.token}`
      : '';
    try {
      await navigator.clipboard.writeText(full);
      show('Copied to clipboard');
    } catch {
      show(full);
    }
  };

  const remove = async (id: number) => {
    if (!confirm('Delete this payment link?')) return;
    await api.delete(`/payment-links/${id}`);
    load();
  };

  return (
    <Layout title="Payment Links">
      {toast && (
        <div className="mb-4 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{toast}</div>
      )}
      <Card>
        <div className="text-sm text-slate-500 mb-4">
          Create shareable pay links for subscribers (GCash / Maya / bank). Confirming payment restores the PPP secret and extends the due date.
          Reminders automatically include a fresh link.
        </div>
        <div className="flex flex-wrap gap-2 items-end mb-6">
          <label className="text-sm flex-1 min-w-[200px]">
            <span className="text-xs text-slate-500">Subscriber</span>
            <select className="input mt-1" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Select…</option>
              {clients.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.username} — {c.customer_name || c.customer || ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm w-28">
            <span className="text-xs text-slate-500">Months</span>
            <input type="number" min={1} className="input mt-1" value={months} onChange={(e) => setMonths(Number(e.target.value) || 1)} />
          </label>
          <button type="button" className="btn-primary" disabled={busy || !userId} onClick={create}>
            <Plus size={16} /> Create & copy link
          </button>
          <button type="button" className="btn-secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <Toolbar left={<span>Links <span className="font-semibold">{links.length}</span></span>} />
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                <th className="py-2">Subscriber</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Status</th>
                <th className="py-2">Expires</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id} className="border-b border-slate-50">
                  <td className="py-2.5">
                    <div className="font-semibold">{l.username}</div>
                    <div className="text-xs text-slate-400">{l.customer} · {l.account}</div>
                  </td>
                  <td className="py-2.5">{peso(l.amount)} · {l.months}mo</td>
                  <td className="py-2.5"><StatusBadge status={l.status} /></td>
                  <td className="py-2.5 text-xs text-slate-500">{(l.expiresAt || '').slice(0, 16).replace('T', ' ')}</td>
                  <td className="py-2.5">
                    <div className="flex justify-end gap-1">
                      <IconAction icon={Copy} title="Copy link" tone="sky" onClick={() => copy(l)} />
                      <IconAction icon={Link2} title="Open" tone="emerald" onClick={() => window.open(`/pay/${l.token}`, '_blank')} />
                      <IconAction icon={Trash2} title="Delete" tone="rose" onClick={() => remove(l.id)} />
                    </div>
                  </td>
                </tr>
              ))}
              {links.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">No payment links yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </Layout>
  );
}

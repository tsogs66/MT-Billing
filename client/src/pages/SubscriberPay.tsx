import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, QrCode } from 'lucide-react';
import { PRODUCT_TITLE } from '../branding';

/** Public subscriber payment page — no panel login required. */
export default function SubscriberPay() {
  const { token } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState('');
  const [done, setDone] = useState<any>(null);

  useEffect(() => {
    document.title = `Pay — ${PRODUCT_TITLE}`;
    fetch(`/api/public/pay/${token}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Not found');
        setData(j);
      })
      .catch((e) => setError(e.message || 'Could not load payment link'));
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/public/pay/${token}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: ref }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Payment failed');
      setDone(j);
      setData((d: any) => (d ? { ...d, status: 'paid' } : d));
    } catch (e: any) {
      setError(e.message || 'Payment failed');
    } finally {
      setBusy(false);
    }
  };

  const payUrl = typeof window !== 'undefined' ? window.location.href : '';
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payUrl)}`;

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md w-full text-center">
          <div className="text-rose-600 font-semibold mb-2">Payment link unavailable</div>
          <div className="text-sm text-slate-500">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <Loader2 className="animate-spin text-brand-500" size={28} />
      </div>
    );
  }

  const paid = data.status === 'paid' || done;
  const expired = data.status === 'expired';

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 max-w-lg w-full overflow-hidden">
        <div className="bg-slate-900 text-white px-6 py-5">
          <div className="text-xs uppercase tracking-wide text-slate-400">Official payment</div>
          <div className="text-xl font-bold mt-1">{data.company?.name || 'ISP Billing'}</div>
          {data.company?.address && <div className="text-sm text-slate-400 mt-1">{data.company.address}</div>}
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-slate-400 text-xs">Customer</div>
              <div className="font-semibold text-slate-800">{data.customer}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">Account #</div>
              <div className="font-mono font-semibold text-slate-800">{data.account}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">Plan</div>
              <div className="font-semibold text-slate-800">{data.plan}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">Current due</div>
              <div className="font-semibold text-slate-800">{(data.due || '').slice(0, 10) || '—'}</div>
            </div>
          </div>

          <div className="rounded-xl bg-brand-50 border border-brand-100 px-4 py-4 text-center">
            <div className="text-xs text-brand-700 uppercase font-semibold">Amount due</div>
            <div className="text-3xl font-bold text-brand-800 mt-1">
              ₱{Number(data.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-brand-600 mt-1">{data.months || 1} month{(data.months || 1) > 1 ? 's' : ''}</div>
          </div>

          {!paid && !expired && (
            <>
              <div className="flex flex-col items-center gap-2 py-2">
                <img src={qrSrc} alt="Payment QR" className="w-40 h-40 rounded-lg border border-slate-200" />
                <div className="text-xs text-slate-400 flex items-center gap-1">
                  <QrCode size={12} /> Scan or open this page to pay
                </div>
              </div>

              <div className="text-sm text-slate-600 bg-slate-50 rounded-xl px-3 py-3 border border-slate-100">
                Pay via <b>GCash</b>, <b>Maya</b>, or bank transfer to your ISP, then tap confirm below.
                Include your account number in the transfer note.
              </div>

              <label className="block text-sm">
                <span className="text-slate-500 text-xs font-medium">Payment reference (optional)</span>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="GCash / Maya reference no."
                />
              </label>

              {error && <div className="text-sm text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{error}</div>}

              <button
                type="button"
                disabled={busy}
                onClick={confirm}
                className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold py-3 disabled:opacity-60"
              >
                {busy ? 'Confirming…' : 'I have paid — restore my internet'}
              </button>
            </>
          )}

          {paid && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-4 text-center">
              <CheckCircle2 className="mx-auto text-emerald-600 mb-2" size={32} />
              <div className="font-bold text-emerald-800">Payment recorded</div>
              <div className="text-sm text-emerald-700 mt-1">
                Your service is being restored. New due:{' '}
                <b>{done?.payment?.subscriptionDue || 'updated'}</b>
              </div>
            </div>
          )}

          {expired && !paid && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 text-center">
              This payment link has expired. Contact your ISP for a new link.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

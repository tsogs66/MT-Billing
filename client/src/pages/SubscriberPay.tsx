import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircle2, Loader2, Upload, Camera, ShieldCheck, Info, Clock3, ImageIcon,
} from 'lucide-react';
import { PRODUCT_TITLE } from '../branding';

type Channel = 'gcash' | 'maya' | '';

/** Extract likely GCash/Maya reference numbers from OCR text. */
function extractReferenceCandidates(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ');
  const patterns = [
    /\b(?:Ref(?:erence)?(?:\s*(?:No\.?|Number|#))?|Txn(?:\s*ID)?|Transaction(?:\s*(?:No\.?|ID|#))?|Trace\s*(?:No\.?)?)\s*[:#]?\s*([A-Z0-9]{6,})/gi,
    /\b([0-9]{10,16})\b/g,
    /\b([A-Z0-9]{8,20})\b/g,
  ];
  const found = new Set<string>();
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned))) {
      const v = (m[1] || m[0] || '').replace(/[^A-Za-z0-9]/g, '');
      if (v.length >= 6 && v.length <= 24) found.add(v);
    }
  }
  return Array.from(found).slice(0, 6);
}

/** Public subscriber payment page — no panel login required. */
export default function SubscriberPay() {
  const { token } = useParams();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [channel, setChannel] = useState<Channel>('');
  const [ref, setRef] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [ocrHints, setOcrHints] = useState<string[]>([]);
  const [done, setDone] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `Pay — ${PRODUCT_TITLE}`;
    fetch(`/api/public/pay/${token}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Not found');
        setData(j);
        if (j.payChannel === 'gcash' || j.payChannel === 'maya') setChannel(j.payChannel);
        if (j.externalRef) setRef(j.externalRef);
      })
      .catch((e) => setError(e.message || 'Could not load payment link'));
  }, [token]);

  const runOcr = async (dataUrl: string) => {
    setOcrBusy(true);
    setOcrHints([]);
    try {
      const Tesseract = await import('tesseract.js');
      const result = await Tesseract.recognize(dataUrl, 'eng', { logger: () => undefined });
      const candidates = extractReferenceCandidates(result.data.text || '');
      setOcrHints(candidates);
      if (candidates[0] && !ref.trim()) setRef(candidates[0]);
    } catch {
      setOcrHints([]);
    } finally {
      setOcrBusy(false);
    }
  };

  const onShot = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      setError('Screenshot must be 6MB or smaller.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || '');
      setScreenshot(url);
      void runOcr(url);
    };
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!channel) {
      setError('Select GCash or Maya.');
      return;
    }
    if (!ref.trim() || ref.trim().length < 4) {
      setError('Enter your transaction / reference number (required).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/public/pay/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          reference: ref.trim(),
          screenshot,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Submit failed');
      setDone(j);
      setData((d: any) => (d ? { ...d, status: 'submitted', payChannel: channel, externalRef: ref.trim() } : d));
    } catch (e: any) {
      setError(e.message || 'Submit failed');
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b1220] p-6">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-rose-600 font-semibold mb-2">Payment link unavailable</div>
          <div className="text-sm text-slate-500">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b1220]">
        <Loader2 className="animate-spin text-sky-400" size={28} />
      </div>
    );
  }

  const paid = data.status === 'paid';
  const submitted = data.status === 'submitted' || done?.status === 'submitted';
  const expired = data.status === 'expired';
  const rejected = data.status === 'rejected';
  const company = data.company || {};
  const accountHint = channel === 'gcash' ? company.gcashNumber : channel === 'maya' ? company.mayaNumber : null;
  const merchantQr =
    channel === 'gcash'
      ? company.gcashQr || company.paymentQr
      : channel === 'maya'
        ? company.mayaQr || company.paymentQr
        : company.gcashQr || company.mayaQr || company.paymentQr || null;

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#1e3a5f_0%,_#0b1220_55%,_#070b14_100%)]" />
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.04\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />

      <div className="relative z-10 max-w-lg mx-auto px-4 py-8 sm:py-12">
        {/* Brand header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/95 shadow-lg overflow-hidden mb-3">
            {company.logo ? (
              <img src={company.logo} alt="" className="max-h-14 max-w-14 object-contain" />
            ) : (
              <ShieldCheck className="text-sky-600" size={28} />
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">{company.name || 'ISP Billing'}</h1>
          {company.address && <p className="text-sm text-slate-400 mt-1">{company.address}</p>}
          <p className="text-[11px] uppercase tracking-[0.2em] text-sky-300/80 mt-3">Secure payment portal</p>
        </div>

        <div className="rounded-3xl bg-white shadow-2xl shadow-black/40 overflow-hidden">
          {/* Amount strip */}
          <div className="bg-gradient-to-r from-sky-600 to-indigo-600 px-6 py-5 text-white">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-sky-100 text-xs font-medium uppercase tracking-wide">Amount due</div>
                <div className="text-3xl sm:text-4xl font-bold tracking-tight mt-0.5">
                  ₱{Number(data.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </div>
                <div className="text-sky-100 text-xs mt-1">{data.months || 1} month{(data.months || 1) > 1 ? 's' : ''} · {data.plan || 'Plan'}</div>
              </div>
              <div className="text-right text-sm">
                <div className="text-sky-100 text-xs">Account</div>
                <div className="font-mono font-semibold">{data.account || '—'}</div>
                <div className="text-sky-100/90 text-xs mt-1 truncate max-w-[140px]">{data.customer}</div>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            {/* How to pay */}
            <section className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
              <div className="flex items-start gap-2 text-slate-800 font-semibold text-sm mb-2">
                <Info size={16} className="text-sky-600 mt-0.5 shrink-0" />
                How to pay
              </div>
              <ol className="text-sm text-slate-600 space-y-1.5 list-decimal pl-5">
                <li>Choose <b>GCash</b> or <b>Maya</b> below.</li>
                <li>Scan the merchant QR (or send to the number shown) for the exact amount.</li>
                <li>Copy the <b>Reference / Transaction No.</b> from your receipt.</li>
                <li>Optional: upload a screenshot — we try to read the reference automatically.</li>
                <li>Submit for review. Service restores after your ISP verifies payment.</li>
              </ol>
              {company.paymentInstructions && (
                <p className="text-xs text-slate-500 mt-3 border-t border-slate-200 pt-3 whitespace-pre-wrap">{company.paymentInstructions}</p>
              )}
            </section>

            {!paid && !expired && !submitted && (
              <>
                {/* Channel select */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Pay with</div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setChannel('gcash')}
                      className={`rounded-2xl border-2 p-3 flex flex-col items-center gap-2 transition ${
                        channel === 'gcash' ? 'border-sky-500 bg-sky-50 shadow-sm' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <img src="/pay/gcash.svg" alt="GCash" className="h-9 w-auto" />
                      <span className="text-sm font-semibold text-slate-700">GCash</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setChannel('maya')}
                      className={`rounded-2xl border-2 p-3 flex flex-col items-center gap-2 transition ${
                        channel === 'maya' ? 'border-emerald-500 bg-emerald-50 shadow-sm' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <img src="/pay/maya.svg" alt="Maya" className="h-9 w-auto" />
                      <span className="text-sm font-semibold text-slate-700">Maya</span>
                    </button>
                  </div>
                  {accountHint && (
                    <p className="text-xs text-slate-500 mt-2">
                      Send to: <span className="font-mono font-semibold text-slate-700">{accountHint}</span>
                    </p>
                  )}
                </div>

                {/* Merchant QR — channel-specific */}
                {merchantQr && (
                  <div className="flex flex-col items-center gap-2 py-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {channel === 'gcash' ? 'GCash' : channel === 'maya' ? 'Maya' : 'Scan to pay'} QR
                    </div>
                    <img
                      src={merchantQr}
                      alt="Payment QR"
                      className="w-56 h-auto max-h-72 object-contain rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"
                    />
                    <div className="text-xs text-slate-400 text-center px-2">
                      {channel
                        ? `Open ${channel === 'maya' ? 'Maya' : 'GCash'} → Scan QR → pay the exact amount`
                        : 'Select GCash or Maya above, then scan the matching QR'}
                    </div>
                  </div>
                )}
                {!merchantQr && channel && (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                    No {channel === 'maya' ? 'Maya' : 'GCash'} QR uploaded yet. Your ISP should add it under Company settings.
                    {accountHint ? <> Meanwhile send to <span className="font-mono font-semibold">{accountHint}</span>.</> : null}
                  </div>
                )}

                {/* Reference */}
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Transaction / Reference No. <span className="text-rose-500">*</span>
                  </span>
                  <input
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-400"
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    placeholder="Required — from your GCash / Maya receipt"
                    required
                  />
                </label>

                {ocrHints.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[11px] text-slate-400 self-center mr-1">Detected:</span>
                    {ocrHints.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setRef(h)}
                        className="text-xs font-mono px-2 py-1 rounded-lg bg-sky-50 text-sky-700 border border-sky-100 hover:bg-sky-100"
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                )}

                {/* Screenshot upload */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
                    Receipt screenshot <span className="normal-case font-normal text-slate-400">(optional)</span>
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onShot} />
                  {screenshot ? (
                    <div className="relative rounded-2xl overflow-hidden border border-slate-200">
                      <img src={screenshot} alt="Receipt" className="w-full max-h-56 object-contain bg-slate-50" />
                      <div className="absolute top-2 right-2 flex gap-1">
                        {ocrBusy && (
                          <span className="bg-black/60 text-white text-[11px] px-2 py-1 rounded-lg flex items-center gap-1">
                            <Loader2 size={12} className="animate-spin" /> Reading…
                          </span>
                        )}
                        <button
                          type="button"
                          className="bg-white/95 text-xs px-2 py-1 rounded-lg border border-slate-200"
                          onClick={() => { setScreenshot(null); setOcrHints([]); fileRef.current && (fileRef.current.value = ''); }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="w-full rounded-2xl border-2 border-dashed border-slate-200 hover:border-sky-300 hover:bg-sky-50/50 px-4 py-6 flex flex-col items-center gap-2 text-slate-500 transition"
                    >
                      <div className="flex gap-3 text-sky-600">
                        <Upload size={22} />
                        <Camera size={22} />
                      </div>
                      <span className="text-sm font-medium text-slate-700">Upload or take a photo of your receipt</span>
                      <span className="text-xs text-slate-400">We’ll try to read the reference number automatically</span>
                    </button>
                  )}
                </div>

                {error && (
                  <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2.5">{error}</div>
                )}

                <button
                  type="button"
                  disabled={busy || ocrBusy}
                  onClick={submit}
                  className="w-full rounded-2xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-semibold py-3.5 shadow-lg shadow-sky-600/25 disabled:opacity-60 transition"
                >
                  {busy ? 'Submitting…' : 'Submit payment for review'}
                </button>
                <p className="text-[11px] text-center text-slate-400 flex items-center justify-center gap-1">
                  <Clock3 size={12} /> Internet restores after your ISP verifies this payment
                </p>
              </>
            )}

            {submitted && !paid && (
              <div className="rounded-2xl bg-sky-50 border border-sky-100 px-4 py-5 text-center">
                <Clock3 className="mx-auto text-sky-600 mb-2" size={28} />
                <div className="font-bold text-sky-900">Proof submitted — under review</div>
                <div className="text-sm text-sky-800 mt-1">
                  Channel: <b className="uppercase">{data.payChannel || channel}</b>
                  {data.externalRef || ref ? (
                    <> · Ref: <span className="font-mono">{data.externalRef || ref}</span></>
                  ) : null}
                </div>
                <p className="text-xs text-sky-700 mt-2">Hang tight — service will restore once verified.</p>
              </div>
            )}

            {paid && (
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-5 text-center">
                <CheckCircle2 className="mx-auto text-emerald-600 mb-2" size={32} />
                <div className="font-bold text-emerald-800">Payment confirmed</div>
                <div className="text-sm text-emerald-700 mt-1">Your service is being restored.</div>
              </div>
            )}

            {rejected && !paid && (
              <div className="rounded-2xl bg-rose-50 border border-rose-100 px-4 py-4 text-center text-sm text-rose-800">
                Payment proof was not accepted. Contact your ISP or submit again with a clearer reference/screenshot.
                <button
                  type="button"
                  className="mt-3 w-full rounded-xl border border-rose-200 bg-white py-2.5 text-rose-700 font-medium"
                  onClick={() => setData((d: any) => (d ? { ...d, status: 'pending' } : d))}
                >
                  Try again
                </button>
              </div>
            )}

            {expired && !paid && (
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-3 text-center">
                This payment link has expired. Contact your ISP for a new link.
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-500 mt-6 flex items-center justify-center gap-1">
          <ImageIcon size={12} /> Powered by {PRODUCT_TITLE}
        </p>
      </div>
    </div>
  );
}

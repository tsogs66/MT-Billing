import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircle2, Loader2, Camera, ShieldCheck, Info, Clock3, ImageIcon,
  ZoomIn, Download, X, SwitchCamera, Upload, Copy, Check,
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
  const [qrZoomOpen, setQrZoomOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [copied, setCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
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

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const startCamera = async (facing: 'environment' | 'user' = facingMode) => {
    setCameraError('');
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera is not supported on this device/browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch {
      setCameraError('Could not open camera. Allow camera permission and try again.');
    }
  };

  useEffect(() => {
    if (!cameraOpen) {
      stopCamera();
      return;
    }
    void startCamera(facingMode);
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOpen, facingMode]);

  useEffect(() => {
    if (!qrZoomOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setQrZoomOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [qrZoomOpen]);

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

  const applyCapturedPhoto = (dataUrl: string) => {
    // Rough size guard (~6MB raw base64 is far larger; keep payloads reasonable)
    if (dataUrl.length > 8 * 1024 * 1024) {
      setError('Photo is too large. Try again closer / with less detail.');
      return;
    }
    setError('');
    setScreenshot(dataUrl);
    setCameraOpen(false);
    void runOcr(dataUrl);
  };

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      setError('Screenshot must be 6MB or smaller.');
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => applyCapturedPhoto(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError('Camera is not ready yet.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    applyCapturedPhoto(canvas.toDataURL('image/jpeg', 0.85));
  };

  const copyAccount = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Could not copy number. Long-press to copy instead.');
    }
  };

  const downloadQr = async (src: string, label: string) => {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${label.replace(/\s+/g, '-').toLowerCase() || 'payment'}-qr.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in new tab if download fails (e.g. cross-origin)
      window.open(src, '_blank', 'noopener,noreferrer');
    }
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
  const qrLabel = channel === 'gcash' ? 'GCash' : channel === 'maya' ? 'Maya' : 'Payment';

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
                <li>Choose <b>GCash</b> or <b>Maya</b> below (or scan with any bank app).</li>
                <li>Tap the QR to enlarge, or download it, then scan and pay the exact amount.</li>
                <li>Copy the <b>Reference / Transaction No.</b> from your receipt.</li>
                <li>Optional: take a photo or upload a receipt screenshot — we try to read the reference automatically.</li>
                <li>Submit for review. Service restores after your ISP verifies payment.</li>
              </ol>
              <p className="text-xs text-slate-600 mt-3 rounded-xl bg-white border border-slate-200 px-3 py-2.5 leading-relaxed">
                <span className="font-semibold text-slate-800">QR Ph / InstaPay:</span> All payment QR codes on this page can be scanned and paid using{' '}
                <b>any participating Philippine bank</b> or e-wallet (GCash, Maya, BDO, BPI, UnionBank, and others) — not only the wallet shown on the QR.
              </p>
              {company.paymentInstructions && (
                <p className="text-xs text-slate-500 mt-3 border-t border-slate-200 pt-3 whitespace-pre-wrap">{company.paymentInstructions}</p>
              )}
            </section>

            {!paid && !expired && !submitted && (
              <>
                {/* Channel select — sliding GCash / Maya */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Pay with</div>
                  <div
                    className="relative grid grid-cols-2 rounded-2xl bg-slate-100 p-1"
                    role="tablist"
                    aria-label="Payment wallet"
                  >
                    <span
                      aria-hidden
                      className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-xl shadow-sm transition-all duration-300 ease-out ${
                        channel === 'maya'
                          ? 'left-[calc(50%+2px)] bg-[#00D632]'
                          : channel === 'gcash'
                            ? 'left-1 bg-[#007DFE]'
                            : 'left-1 bg-transparent shadow-none'
                      }`}
                    />
                    <button
                      type="button"
                      role="tab"
                      aria-selected={channel === 'gcash'}
                      onClick={() => {
                        setChannel('gcash');
                        setCopied(false);
                      }}
                      className="relative z-10 flex items-center justify-center rounded-xl px-2 py-2.5 focus:outline-none"
                    >
                      <img
                        src="/wallets/gcash.svg"
                        alt="GCash"
                        className={`h-9 w-auto max-w-[7.5rem] rounded-lg transition ${
                          channel === 'gcash' ? 'ring-2 ring-white/80 shadow-sm' : 'opacity-80'
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={channel === 'maya'}
                      onClick={() => {
                        setChannel('maya');
                        setCopied(false);
                      }}
                      className="relative z-10 flex items-center justify-center rounded-xl px-2 py-2.5 focus:outline-none"
                    >
                      <img
                        src="/wallets/maya.svg"
                        alt="Maya"
                        className={`h-9 w-auto max-w-[7.5rem] rounded-lg transition ${
                          channel === 'maya' ? 'ring-2 ring-white/80 shadow-sm' : 'opacity-80'
                        }`}
                      />
                    </button>
                  </div>
                  {accountHint && (
                    <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <span className="text-xs text-slate-500 shrink-0">Send to</span>
                      <span className="font-mono text-sm font-semibold text-slate-800 truncate flex-1">{accountHint}</span>
                      <button
                        type="button"
                        onClick={() => void copyAccount(accountHint)}
                        className="shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100 hover:text-sky-700 transition"
                        aria-label={copied ? 'Copied' : 'Copy account number'}
                        title={copied ? 'Copied' : 'Copy'}
                      >
                        {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                      </button>
                    </div>
                  )}
                </div>

                {/* Merchant QR — zoom + download + scan line */}
                {merchantQr && (
                  <div className="flex flex-col items-center gap-2 py-1">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {qrLabel} QR
                    </div>
                    <button
                      type="button"
                      onClick={() => setQrZoomOpen(true)}
                      className="pay-qr-frame group relative w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                      aria-label="Enlarge QR code"
                    >
                      <img
                        src={merchantQr}
                        alt="Payment QR"
                        className="w-full h-auto max-h-72 object-contain select-none"
                        draggable={false}
                      />
                      <span className="pay-qr-scanline" aria-hidden />
                      <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-lg bg-black/55 px-2 py-1 text-[10px] font-medium text-white opacity-90 group-hover:opacity-100">
                        <ZoomIn size={12} /> Tap to zoom
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadQr(merchantQr, qrLabel)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:border-slate-300 transition"
                    >
                      <Download size={16} className="text-sky-600" />
                      Download
                    </button>
                    <div className="text-xs text-slate-500 text-center px-2 max-w-xs leading-relaxed">
                      {channel
                        ? `Open ${channel === 'maya' ? 'Maya' : 'GCash'} — or any Philippine bank app — → Scan QR → pay the exact amount`
                        : 'Select GCash or Maya above, then scan the matching QR'}
                      <span className="block mt-1 text-slate-400">
                        Works with InstaPay / QR Ph — any participating PH bank or e-wallet.
                      </span>
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

                {/* Receipt — camera or file upload */}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
                    Receipt photo <span className="normal-case font-normal text-slate-400">(optional)</span>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onFilePick}
                  />
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
                          onClick={() => {
                            setCameraOpen(true);
                            setCameraError('');
                          }}
                        >
                          Retake
                        </button>
                        <button
                          type="button"
                          className="bg-white/95 text-xs px-2 py-1 rounded-lg border border-slate-200"
                          onClick={() => fileRef.current?.click()}
                        >
                          Upload
                        </button>
                        <button
                          type="button"
                          className="bg-white/95 text-xs px-2 py-1 rounded-lg border border-slate-200"
                          onClick={() => {
                            setScreenshot(null);
                            setOcrHints([]);
                            if (fileRef.current) fileRef.current.value = '';
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCameraOpen(true);
                          setCameraError('');
                        }}
                        className="rounded-2xl border-2 border-dashed border-slate-200 hover:border-sky-300 hover:bg-sky-50/50 px-3 py-5 flex flex-col items-center gap-1.5 text-slate-500 transition"
                      >
                        <Camera size={22} className="text-sky-600" />
                        <span className="text-sm font-medium text-slate-700">Take photo</span>
                        <span className="text-[11px] text-slate-400 text-center leading-snug">Use camera</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="rounded-2xl border-2 border-dashed border-slate-200 hover:border-sky-300 hover:bg-sky-50/50 px-3 py-5 flex flex-col items-center gap-1.5 text-slate-500 transition"
                      >
                        <Upload size={22} className="text-sky-600" />
                        <span className="text-sm font-medium text-slate-700">Upload</span>
                        <span className="text-[11px] text-slate-400 text-center leading-snug">From files / gallery</span>
                      </button>
                    </div>
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

      {/* QR zoom overlay */}
      {qrZoomOpen && merchantQr && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged payment QR"
          onClick={() => setQrZoomOpen(false)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"
            onClick={() => setQrZoomOpen(false)}
            aria-label="Close"
          >
            <X size={22} />
          </button>
          <div
            className="pay-qr-frame relative w-full max-w-sm rounded-3xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={merchantQr}
              alt={`${qrLabel} QR enlarged`}
              className="w-full h-auto object-contain select-none"
              draggable={false}
            />
            <span className="pay-qr-scanline pay-qr-scanline--lg" aria-hidden />
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void downloadQr(merchantQr, qrLabel);
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-lg hover:bg-slate-50"
          >
            <Download size={18} className="text-sky-600" />
            Download
          </button>
          <p className="mt-3 text-xs text-white/70">Tap outside to close</p>
        </div>
      )}

      {/* Camera capture modal — no file / gallery picker */}
      {cameraOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black"
          role="dialog"
          aria-modal="true"
          aria-label="Take receipt photo"
        >
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <button
              type="button"
              className="rounded-full bg-white/10 p-2 hover:bg-white/20"
              onClick={() => setCameraOpen(false)}
              aria-label="Close camera"
            >
              <X size={22} />
            </button>
            <span className="text-sm font-medium">Receipt photo</span>
            <button
              type="button"
              className="rounded-full bg-white/10 p-2 hover:bg-white/20"
              onClick={() => setFacingMode((f) => (f === 'environment' ? 'user' : 'environment'))}
              aria-label="Switch camera"
            >
              <SwitchCamera size={22} />
            </button>
          </div>

          <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
            {cameraError ? (
              <div className="px-6 text-center text-sm text-rose-200 max-w-sm">{cameraError}</div>
            ) : (
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            {!cameraError && (
              <div className="pointer-events-none absolute inset-8 rounded-2xl border border-white/35 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            )}
          </div>

          <div className="px-6 py-5 pb-8 flex flex-col items-center gap-3 bg-black">
            {cameraError ? (
              <button
                type="button"
                onClick={() => void startCamera(facingMode)}
                className="rounded-2xl bg-sky-600 px-5 py-3 text-sm font-semibold text-white"
              >
                Retry camera
              </button>
            ) : (
              <button
                type="button"
                onClick={capturePhoto}
                className="h-16 w-16 rounded-full border-4 border-white bg-white/90 shadow-lg active:scale-95 transition"
                aria-label="Capture photo"
              />
            )}
            <p className="text-[11px] text-white/55 text-center">Align the receipt, then tap the shutter</p>
          </div>
        </div>
      )}
    </div>
  );
}

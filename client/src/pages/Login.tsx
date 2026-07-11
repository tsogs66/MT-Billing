import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Loader2, Lock, User, ArrowRight, Shield, Copy, CheckCircle2, KeyRound, ArrowLeft } from 'lucide-react';
import { FormField } from '../components/ui';
import { BRAND_SHORT, BRAND_TAGLINE, DEFAULT_LOGO, PRODUCT_TITLE } from '../branding';
import { copyText } from '../lib/clipboard';

const publicApi = axios.create({ baseURL: '/api' });

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  useEffect(() => {
    document.title = PRODUCT_TITLE;
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      nav('/');
    } catch (err: any) {
      const apiMsg = err?.response?.data?.error;
      if (apiMsg) setError(apiMsg);
      else if (!err?.response) setError('Cannot reach the API. Is the server running?');
      else setError('Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-950 relative overflow-hidden theme-login">
      <div className="absolute inset-0 bg-mesh-dark" />
      <div className="absolute inset-0 bg-login-grid bg-grid opacity-40" />
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-brand-500/20 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-sky-500/15 rounded-full blur-3xl animate-float" style={{ animationDelay: '1.5s' }} />

      <div className="relative z-10 flex flex-1 flex-col lg:flex-row min-h-screen">
        <div className="hidden lg:flex flex-1 flex-col justify-between p-12 xl:p-16">
          <div className="flex flex-col items-start gap-4">
            <div className="w-28 h-28 rounded-2xl bg-white/95 flex items-center justify-center overflow-hidden shadow-glow ring-1 ring-white/20">
              <img src={DEFAULT_LOGO} alt={BRAND_SHORT} className="h-full w-full object-contain object-center p-2" />
            </div>
            <div>
              <div className="text-3xl font-bold text-white tracking-tight">{BRAND_SHORT}</div>
              <div className="text-slate-400 text-sm mt-1">{BRAND_TAGLINE}</div>
            </div>
          </div>
          <div className="max-w-lg animate-fade-in-up">
            <h1 className="text-4xl xl:text-5xl font-bold text-white tracking-tight leading-tight mb-4">
              ISP Business,<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-300 to-brand-500">reimagined.</span>
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed">
              Manage PPPoE &amp; IPoE subscribers, monitor routers, track sales, and automate your MikroTik network — all from one modern panel.
            </p>
            <div className="flex flex-wrap gap-4 mt-8">
              {['PPPoE / IPoE', 'Live Terminal', 'AI Scripting', 'Sales & Maps'].map((tag) => (
                <span key={tag} className="text-xs font-semibold text-slate-300 bg-slate-800/60 border border-slate-700/50 px-3 py-1.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Shield size={14} />
              <span>Secured with JWT authentication</span>
            </div>
            <p className="text-[11px] text-slate-600 max-w-md leading-snug">{PRODUCT_TITLE}</p>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
          <div className="w-full max-w-md animate-scale-in">
            <div className="lg:hidden mb-8 flex flex-col items-center text-center gap-3">
              <div className="w-24 h-24 rounded-2xl bg-white/95 flex items-center justify-center overflow-hidden shadow-glow">
                <img src={DEFAULT_LOGO} alt={BRAND_SHORT} className="h-full w-full object-contain object-center p-2" />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{BRAND_SHORT}</div>
                <div className="text-slate-400 text-sm">{BRAND_TAGLINE}</div>
              </div>
            </div>

            <div className="theme-modal bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 sm:p-10">
              {!forgotOpen ? (
                <>
                  <div className="mb-8">
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{BRAND_SHORT}</h2>
                    <p className="text-slate-500 text-sm mt-1">{BRAND_TAGLINE}</p>
                  </div>

                  <form onSubmit={submit} className="space-y-5">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Username</label>
                      <div className="relative">
                        <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          className="input pl-10"
                          autoFocus
                          placeholder="admin"
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm font-medium text-slate-700">Password</label>
                        <button
                          type="button"
                          onClick={() => setForgotOpen(true)}
                          className="text-xs font-medium text-brand-600 hover:text-brand-700"
                        >
                          Forgot password?
                        </button>
                      </div>
                      <div className="relative">
                        <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="input pl-10"
                          placeholder="••••••••"
                        />
                      </div>
                    </div>

                    {error && (
                      <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 animate-fade-in">
                        {error}
                      </div>
                    )}

                    <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base">
                      {loading ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <>
                          Sign in
                          <ArrowRight size={18} />
                        </>
                      )}
                    </button>
                  </form>

                  <p className="text-xs text-slate-400 mt-8 text-center">
                    Default credentials: <span className="font-medium text-slate-500">admin</span> / <span className="font-medium text-slate-500">admin123</span>
                  </p>
                </>
              ) : (
                <ForgotPasswordForm onBack={() => setForgotOpen(false)} onSuccess={(u) => { setUsername(u); setPassword('admin123'); setForgotOpen(false); }} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ForgotPasswordForm({ onBack, onSuccess }: { onBack: () => void; onSuccess: (username: string) => void }) {
  const [panelId, setPanelId] = useState('');
  const [defaultUser, setDefaultUser] = useState('admin');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    publicApi
      .get('/auth/panel-id')
      .then((r) => {
        setPanelId(r.data.panelId);
        setDefaultUser(r.data.defaultUser || 'admin');
        setError('');
      })
      .catch((err: any) => {
        const apiMsg = err?.response?.data?.error;
        if (apiMsg) setError(apiMsg);
        else if (!err?.response) setError('Cannot reach the API — Panel ID unavailable until the server is running.');
        else setError('Could not load Panel ID.');
      });
  }, []);

  const copyId = async () => {
    if (!panelId) return;
    const ok = await copyText(panelId);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const r = await publicApi.post('/auth/forgot-password-reset', { code: code.trim() });
      setSuccess(r.data.message || 'Password reset successful.');
      onSuccess(r.data.username || defaultUser);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Reset failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-4">
        <ArrowLeft size={16} /> Back to sign in
      </button>

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <KeyRound size={22} className="text-brand-500" />
          Reset panel login
        </h2>
        <p className="text-slate-500 text-sm mt-1 leading-relaxed">
          Send your <strong>Panel ID</strong> to your vendor. They run the activator (same tool used for license keys) to give you a reset code. Enter it below to restore the default username and password.
        </p>
      </div>

      <FormField label="Panel ID" hint="Copy this ID and send it to your vendor.">
        <div className="flex items-center gap-2">
          <code className="input font-mono text-sm bg-slate-50 flex-1">{panelId || 'Loading…'}</code>
          <button type="button" className="btn-secondary shrink-0" onClick={copyId} disabled={!panelId}>
            {copied ? <CheckCircle2 size={15} className="text-emerald-600" /> : <Copy size={15} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </FormField>

      <form onSubmit={reset} className="space-y-4 mt-5">
        <FormField label="Authentication reset code" hint="Format: RST-XXXX-XXXX-XXXX-XXXX (from vendor activator)">
          <input
            className="input font-mono uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="RST-XXXX-XXXX-XXXX-XXXX"
            autoFocus
          />
        </FormField>

        {error && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">{error}</div>
        )}
        {success && (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">{success}</div>
        )}

        <button type="submit" disabled={loading || !code.trim()} className="btn-primary w-full py-3">
          {loading ? <Loader2 size={18} className="animate-spin" /> : 'Reset to default credentials'}
        </button>
      </form>

      <p className="text-xs text-slate-400 mt-6 text-center">
        After reset, sign in with <span className="font-medium text-slate-500">{defaultUser}</span> and your default password (typically <span className="font-medium text-slate-500">admin123</span>).
      </p>
    </div>
  );
}

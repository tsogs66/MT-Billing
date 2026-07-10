import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2, Lock, User, ArrowRight, Shield } from 'lucide-react';
import Logo from '../components/Logo';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      nav('/');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-950 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 bg-mesh-dark" />
      <div className="absolute inset-0 bg-login-grid bg-grid opacity-40" />
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-brand-500/20 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-sky-500/15 rounded-full blur-3xl animate-float" style={{ animationDelay: '1.5s' }} />

      <div className="relative z-10 flex flex-1 flex-col lg:flex-row min-h-screen">
        {/* Brand panel */}
        <div className="hidden lg:flex flex-1 flex-col justify-between p-12 xl:p-16">
          <Logo size="lg" variant="dark" />
          <div className="max-w-lg animate-fade-in-up">
            <h1 className="text-4xl xl:text-5xl font-bold text-white tracking-tight leading-tight mb-4">
              MikroTik billing,<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-300 to-brand-500">reimagined.</span>
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed">
              Manage PPPoE &amp; IPoE subscribers, monitor routers, track sales, and automate your network — all from one modern panel.
            </p>
            <div className="flex flex-wrap gap-4 mt-8">
              {['PPPoE / IPoE', 'Live Terminal', 'AI Scripting', 'Sales & Maps'].map((tag) => (
                <span key={tag} className="text-xs font-semibold text-slate-300 bg-slate-800/60 border border-slate-700/50 px-3 py-1.5 rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Shield size={14} />
            <span>Secured with JWT authentication</span>
          </div>
        </div>

        {/* Login form */}
        <div className="flex flex-1 items-center justify-center p-6 sm:p-8">
          <div className="w-full max-w-md animate-scale-in">
            <div className="lg:hidden mb-8 flex justify-center">
              <Logo size="md" variant="dark" />
            </div>

            <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 p-8 sm:p-10">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Welcome back</h2>
                <p className="text-slate-500 text-sm mt-1">Sign in to your MT-Billing panel</p>
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
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

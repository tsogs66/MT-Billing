import { useEffect, useRef, useState } from 'react';
import { Building2, UploadCloud } from 'lucide-react';
import Layout from '../components/Layout';
import { api } from '../api';

export default function Company() {
  const [company, setCompany] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('No file chosen');

  useEffect(() => {
    api.get('/company').then((r) => setCompany(r.data));
  }, []);

  const onLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be 2MB or smaller.');
      return;
    }
    setError('');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCompany((c: any) => ({ ...c, logo: reader.result }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    const r = await api.put('/company', company);
    setCompany(r.data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (!company) return <Layout title="Company"><div className="text-slate-400">Loading…</div></Layout>;

  return (
    <Layout title="Company">
      <div className="card max-w-4xl">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <Building2 size={20} className="text-brand-500" />
          <h3 className="text-brand-600 font-bold text-lg">Company Branding &amp; Information</h3>
        </div>

        <div className="p-6 space-y-6">
          {error && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{error}</div>}

          {/* Logo */}
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 items-start">
            <div>
              <div className="text-sm font-semibold text-slate-700 mb-2">Company Logo</div>
              <div className="border border-slate-200 rounded-xl h-32 flex items-center justify-center bg-white overflow-hidden">
                {company.logo ? (
                  <img src={company.logo} alt="Company logo" className="max-h-28 max-w-[90%] object-contain" />
                ) : (
                  <span className="text-slate-300 text-sm">No logo</span>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-slate-700 mb-2">Upload Logo</div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => fileRef.current?.click()} className="btn-primary">
                  <UploadCloud size={16} /> Choose file
                </button>
                <span className="text-sm text-brand-600">{fileName}</span>
                <input ref={fileRef} type="file" accept="image/png,image/svg+xml,image/jpeg" className="hidden" onChange={onLogo} />
              </div>
              <p className="text-xs text-slate-400 mt-2">Recommended: PNG or SVG with transparent background. Max 2MB.</p>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700 mb-1 block">Company Name</span>
              <input className="input" value={company.name || ''} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700 mb-1 block">Contact Number</span>
              <input className="input" value={company.phone || ''} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Email Address</span>
            <input className="input" type="email" value={company.email || ''} onChange={(e) => setCompany({ ...company, email: e.target.value })} />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-slate-700 mb-1 block">Address</span>
            <textarea className="input min-h-[96px]" value={company.address || ''} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
          </label>

          <div className="flex items-center gap-3 pt-1">
            <button className="btn-primary" onClick={save}>Save Changes</button>
            {saved && <span className="text-sm text-emerald-600">Saved!</span>}
          </div>
        </div>
      </div>
    </Layout>
  );
}

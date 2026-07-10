import { useEffect, useRef, useState } from 'react';
import { Building2, UploadCloud } from 'lucide-react';
import Layout from '../components/Layout';
import { SettingsSection, FormField, Flash, LoadingPage } from '../components/ui';
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

  if (!company) return <Layout title="Company"><LoadingPage label="Loading company profile…" /></Layout>;

  return (
    <Layout title="Company">
      <Flash message={error} type="error" onDismiss={() => setError('')} />
      {saved && <Flash message="Company profile saved successfully." type="success" onDismiss={() => setSaved(false)} />}

      <SettingsSection icon={Building2} title="Company Branding & Information">
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 items-start">
            <div>
              <div className="text-sm font-medium text-slate-700 mb-2">Company Logo</div>
              <div className="border border-slate-200 rounded-2xl h-32 flex items-center justify-center bg-gradient-to-br from-slate-50 to-white overflow-hidden shadow-inner">
                {company.logo ? (
                  <img src={company.logo} alt="Company logo" className="max-h-28 max-w-[90%] object-contain" />
                ) : (
                  <span className="text-slate-300 text-sm">No logo</span>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-slate-700 mb-2">Upload Logo</div>
              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={() => fileRef.current?.click()} className="btn-primary">
                  <UploadCloud size={16} /> Choose file
                </button>
                <span className="text-sm text-brand-600 font-medium">{fileName}</span>
                <input ref={fileRef} type="file" accept="image/png,image/svg+xml,image/jpeg" className="hidden" onChange={onLogo} />
              </div>
              <p className="text-xs text-slate-400 mt-2">Recommended: PNG or SVG with transparent background. Max 2MB.</p>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <FormField label="Company Name">
              <input className="input" value={company.name || ''} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
            </FormField>
            <FormField label="Contact Number">
              <input className="input" value={company.phone || ''} onChange={(e) => setCompany({ ...company, phone: e.target.value })} />
            </FormField>
          </div>

          <FormField label="Email Address">
            <input className="input" type="email" value={company.email || ''} onChange={(e) => setCompany({ ...company, email: e.target.value })} />
          </FormField>

          <FormField label="Address">
            <textarea className="input min-h-[96px]" value={company.address || ''} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
          </FormField>

          <div className="flex items-center gap-3 pt-1">
            <button type="button" className="btn-primary" onClick={save}>Save Changes</button>
          </div>
        </div>
      </SettingsSection>
    </Layout>
  );
}

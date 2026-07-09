import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { Card } from '../components/ui';
import { api } from '../api';

export default function Company() {
  const [company, setCompany] = useState<any>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/company').then((r) => setCompany(r.data));
  }, []);

  const save = async () => {
    const r = await api.put('/company', company);
    setCompany(r.data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!company) return <Layout title="Company"><div className="text-slate-400">Loading...</div></Layout>;

  const fields: [string, string][] = [
    ['name', 'Company Name'],
    ['address', 'Address'],
    ['phone', 'Phone'],
    ['email', 'Email'],
    ['currency', 'Currency'],
  ];

  return (
    <Layout title="Company">
      <Card title="Company Profile" className="max-w-2xl">
        <div className="space-y-3">
          {fields.map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-sm text-slate-600 mb-1 block">{label}</span>
              <input className="input" value={company[key] || ''} onChange={(e) => setCompany({ ...company, [key]: e.target.value })} />
            </label>
          ))}
          <div className="flex items-center gap-3 pt-2">
            <button className="btn-primary" onClick={save}>Save Changes</button>
            {saved && <span className="text-sm text-emerald-600">Saved!</span>}
          </div>
        </div>
      </Card>
    </Layout>
  );
}

import { useEffect, useState } from 'react';
import { Code2, RefreshCw } from 'lucide-react';
import Layout from '../components/Layout';
import { api } from '../api';
import { useRouterDevice } from '../context/RouterContext';

const TABS = [
  ['router', 'Router Logs'],
  ['panel', 'Panel Logs'],
  ['nginx', 'Nginx Logs'],
  ['email', 'Email Logs'],
] as const;

function SubTabs({ tabs, active, onChange }: { tabs: [string, string][]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="flex items-center gap-4 mb-4">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`text-sm border-b-2 pb-1 ${active === key ? 'border-brand-500 text-brand-600 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Panel({ title, onRefresh, children }: { title: string; onRefresh: () => void; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-slate-700">{title}</h3>
        <button className="inline-flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 text-slate-600" onClick={onRefresh}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

const mono = 'font-mono text-[12px] leading-relaxed';
const box = 'bg-slate-50 border border-slate-100 rounded-lg p-3 h-[60vh] overflow-auto';

export default function Logs() {
  const [tab, setTab] = useState('router');
  return (
    <Layout title="Log Viewer">
      <div className="max-w-5xl mx-auto">
        <h2 className="flex items-center gap-2 text-xl font-bold text-slate-800 mb-3"><Code2 size={20} /> Log Viewer</h2>

        <div className="flex items-center gap-5 border-b border-slate-200 mb-4">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`text-sm border-b-2 pb-2 ${tab === key ? 'border-brand-500 text-brand-600 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'router' && <RouterLogs />}
        {tab === 'panel' && <PanelLogs />}
        {tab === 'nginx' && <NginxLogs />}
        {tab === 'email' && <EmailLogs />}
      </div>
    </Layout>
  );
}

function RouterLogs() {
  const { current } = useRouterDevice();
  const [data, setData] = useState<{ router: string; entries: any[] }>({ router: '', entries: [] });
  const load = () => {
    if (current) api.get(`/logs/router?routerId=${current.id}`).then((r) => setData(r.data));
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  return (
    <Panel title={`Router Logs (${data.router || current?.name || ''})`} onRefresh={load}>
      <div className={box}>
        <table className="w-full text-[12px]">
          <tbody>
            {data.entries.map((e, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1.5 pr-3 text-slate-400 whitespace-nowrap align-top w-28">{new Date(e.time).toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' })}<br />{new Date(e.time).toLocaleTimeString('en-GB')}</td>
                <td className="py-1.5 pr-4 text-sky-600 whitespace-nowrap align-top">{e.topic}</td>
                <td className="py-1.5 text-slate-700 align-top">{e.message}</td>
              </tr>
            ))}
            {data.entries.length === 0 && <tr><td className="py-6 text-center text-slate-400">No router log entries found.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function PanelLogs() {
  const [sub, setSub] = useState('ui');
  const [text, setText] = useState('');
  const load = () => api.get(`/logs/panel?process=${sub}`).then((r) => setText(r.data.text));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  return (
    <div>
      <SubTabs tabs={[['ui', 'Panel UI (mikrotik-manager)'], ['api', 'Panel API (mikrotik-api-backend)']]} active={sub} onChange={setSub} />
      <Panel title={sub === 'ui' ? 'Panel UI (mikrotik-manager)' : 'Panel API (mikrotik-api-backend)'} onRefresh={load}>
        <pre className={`${box} ${mono} whitespace-pre-wrap text-slate-700`}>{text}</pre>
      </Panel>
    </div>
  );
}

function NginxLogs() {
  const [text, setText] = useState('');
  const load = () => api.get('/logs/nginx').then((r) => setText(r.data.text));
  useEffect(() => {
    load();
  }, []);
  return (
    <Panel title="Nginx Access Logs" onRefresh={load}>
      <pre className={`${box} ${mono} whitespace-pre-wrap text-slate-700`}>{text}</pre>
    </Panel>
  );
}

function EmailLogs() {
  const [sub, setSub] = useState('payment');
  const [rows, setRows] = useState<any[]>([]);
  const load = () => api.get(`/logs/email?category=${sub}`).then((r) => setRows(r.data));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  const title = sub === 'payment' ? 'Payment Emails' : sub === 'reminder' ? 'Reminder Emails' : 'Announcements';

  return (
    <div>
      <SubTabs
        tabs={[['payment', 'Payment Emails'], ['reminder', 'Reminder Emails'], ['announcement', 'Announcements']]}
        active={sub}
        onChange={setSub}
      />
      <Panel title={title} onRefresh={load}>
        <div className={box}>
          {rows.length === 0 ? (
            <div className={`${mono} text-slate-400`}>No email log entries found.</div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.id} className={`${mono} border-b border-slate-100 pb-2`}>
                  <div className="text-slate-400">{new Date(r.date).toLocaleString()} · <span className={r.status === 'sent' ? 'text-emerald-600' : 'text-rose-600'}>{r.status}</span></div>
                  <div className="text-slate-700">To: {r.recipient || '—'} ({r.customer})</div>
                  <div className="text-slate-800 font-semibold">{r.subject}</div>
                  <div className="text-slate-600 whitespace-pre-wrap">{r.message}</div>
                  {r.detail && <div className="text-slate-400">{r.detail}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

import { useState } from 'react';
import { ChevronDown, HelpCircle, RefreshCw, LogOut, Router as RouterIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouterDevice } from '../context/RouterContext';

export default function Topbar({ title }: { title: string }) {
  const { logout, user } = useAuth();
  const { routers, current, setCurrent } = useRouterDevice();
  const [open, setOpen] = useState(false);

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-[500]">
      <h1 className="text-lg font-semibold text-slate-800">{title}</h1>

      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50"
          >
            <span className="text-slate-400">Router:</span>
            <span className="font-medium text-slate-700">{current?.name || 'None'}</span>
            <ChevronDown size={15} className="text-slate-400" />
          </button>
          {open && (
            <div className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-[600]">
              {routers.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setCurrent(r);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
                >
                  <RouterIcon size={15} className="text-slate-400" />
                  <span className={r.id === current?.id ? 'font-medium text-brand-600' : 'text-slate-700'}>
                    {r.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="text-slate-400 hover:text-slate-600" title="Help">
          <HelpCircle size={18} />
        </button>
        <button className="text-slate-400 hover:text-slate-600" title="Refresh" onClick={() => location.reload()}>
          <RefreshCw size={18} />
        </button>
        <div className="w-px h-6 bg-slate-200" />
        <span className="text-sm text-slate-500 hidden sm:block">{user?.username}</span>
        <button className="text-slate-400 hover:text-rose-500" title="Logout" onClick={logout}>
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

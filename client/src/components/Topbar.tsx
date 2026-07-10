import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown, HelpCircle, RefreshCw, LogOut, Router as RouterIcon,
  Menu, Search,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouterDevice } from '../context/RouterContext';
import { useLayout } from './Layout';

export default function Topbar({ title }: { title: string }) {
  const { logout, user } = useAuth();
  const { routers, current, setCurrent } = useRouterDevice();
  const { toggleSidebar } = useLayout();
  const [routerOpen, setRouterOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const routerRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (routerRef.current && !routerRef.current.contains(e.target as Node)) setRouterOpen(false);
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <header className="sticky top-0 z-30 h-16 glass border-b border-slate-200/60 flex items-center justify-between px-4 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={toggleSidebar}
          className="lg:hidden p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100/80 transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight truncate">{title}</h1>
          <p className="text-[11px] text-slate-400 hidden sm:block">MT-Billing control panel</p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Router selector */}
        <div className="relative" ref={routerRef}>
          <button
            type="button"
            onClick={() => routers.length > 0 && setRouterOpen((v) => !v)}
            disabled={routers.length === 0}
            className={`flex items-center gap-2 text-sm border rounded-xl px-3 py-2 transition-all duration-200 ${
              routers.length === 0
                ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
                : 'border-slate-200/80 bg-white/80 hover:border-brand-300 hover:shadow-sm'
            }`}
          >
            <span className="hidden sm:flex items-center justify-center w-7 h-7 rounded-lg bg-brand-50 text-brand-500">
              <RouterIcon size={15} />
            </span>
            <div className="text-left hidden sm:block">
              <div className="text-[10px] text-slate-400 leading-none">Active router</div>
              <div className="font-semibold text-slate-700 leading-tight">{current?.name ?? 'None'}</div>
            </div>
            <span className="sm:hidden font-medium text-slate-700 max-w-[80px] truncate">{current?.name ?? 'None'}</span>
            <ChevronDown size={14} className={`text-slate-400 transition-transform ${routerOpen ? 'rotate-180' : ''}`} />
          </button>

          {routerOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200/80 rounded-2xl shadow-card-hover py-2 z-[600] animate-scale-in origin-top-right">
              <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Select router</div>
              {routers.length === 0 ? (
                <div className="px-3 py-4 text-sm text-slate-400 text-center">No routers configured</div>
              ) : (
                routers.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setCurrent(r);
                      setRouterOpen(false);
                    }}
                    className={[
                      'w-full text-left px-3 py-2.5 text-sm flex items-center gap-3 transition-colors',
                      r.id === current?.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50 text-slate-700',
                    ].join(' ')}
                  >
                    <span className={`flex items-center justify-center w-8 h-8 rounded-lg ${r.id === current?.id ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-500'}`}>
                      <RouterIcon size={15} />
                    </span>
                    <span className={r.id === current?.id ? 'font-semibold' : ''}>{r.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="hidden md:flex items-center gap-1">
          <button type="button" className="btn-ghost p-2" title="Search">
            <Search size={18} />
          </button>
          <button type="button" className="btn-ghost p-2" title="Help">
            <HelpCircle size={18} />
          </button>
          <button
            type="button"
            className="btn-ghost p-2"
            title="Refresh"
            onClick={() => location.reload()}
          >
            <RefreshCw size={18} />
          </button>
        </div>

        <div className="w-px h-8 bg-slate-200 hidden sm:block" />

        {/* User menu */}
        <div className="relative" ref={userRef}>
          <button
            type="button"
            onClick={() => setUserOpen((v) => !v)}
            className="flex items-center gap-2 rounded-xl pl-1 pr-2 py-1 hover:bg-slate-100/80 transition-colors"
          >
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white text-xs font-bold">
              {(user?.username?.[0] || 'A').toUpperCase()}
            </span>
            <span className="text-sm font-medium text-slate-700 hidden sm:block max-w-[100px] truncate">{user?.username}</span>
            <ChevronDown size={14} className={`text-slate-400 hidden sm:block transition-transform ${userOpen ? 'rotate-180' : ''}`} />
          </button>

          {userOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-white border border-slate-200/80 rounded-2xl shadow-card-hover py-2 z-[600] animate-scale-in origin-top-right">
              <div className="px-4 py-3 border-b border-slate-100">
                <div className="text-sm font-semibold text-slate-800">{user?.username}</div>
                <div className="text-xs text-slate-400">Administrator</div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="w-full text-left px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition-colors"
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

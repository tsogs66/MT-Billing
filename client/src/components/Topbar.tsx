import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown, RefreshCw, LogOut, Router as RouterIcon, Menu,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useRouterDevice } from '../context/RouterContext';
import { useLayout } from './Layout';
import { PRODUCT_TITLE } from '../branding';

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
    <header className="theme-topbar sticky top-0 z-30 h-16 flex items-center justify-between px-4 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={toggleSidebar}
          className="theme-topbar-icon-btn lg:hidden p-2"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="theme-topbar-title text-lg sm:text-xl font-bold tracking-tight truncate">{title}</h1>
          <p className="theme-topbar-subtitle text-[11px] hidden lg:block truncate max-w-[420px]" title={PRODUCT_TITLE}>
            {PRODUCT_TITLE}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div className="relative" ref={routerRef}>
          <button
            type="button"
            onClick={() => routers.length > 0 && setRouterOpen((v) => !v)}
            disabled={routers.length === 0}
            className="theme-topbar-pill text-sm"
          >
            <span className="theme-topbar-pill-icon hidden sm:flex">
              <RouterIcon size={15} />
            </span>
            <div className="text-left hidden sm:block">
              <div className="theme-topbar-pill-label">Active router</div>
              <div className="theme-topbar-pill-name">{current?.name ?? 'None'}</div>
            </div>
            <span className="theme-topbar-pill-name sm:hidden max-w-[80px] truncate">{current?.name ?? 'None'}</span>
            <ChevronDown
              size={14}
              className={`theme-topbar-subtitle transition-transform ${routerOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {routerOpen && (
            <div className="theme-topbar-menu absolute right-0 mt-2 w-64 py-2 z-[600] animate-scale-in origin-top-right">
              <div className="theme-topbar-menu-muted px-3 py-2 text-[10px] font-bold uppercase tracking-wider">
                Select router
              </div>
              {routers.length === 0 ? (
                <div className="theme-topbar-menu-muted px-3 py-4 text-sm text-center">No routers configured</div>
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
                      'theme-topbar-menu-item w-full text-left px-3 py-2.5 text-sm flex items-center gap-3 transition-colors',
                      r.id === current?.id ? 'is-active' : '',
                    ].join(' ')}
                  >
                    <span className="theme-topbar-menu-icon">
                      <RouterIcon size={15} />
                    </span>
                    <span className={r.id === current?.id ? 'font-semibold' : ''}>{r.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="theme-topbar-icon-btn p-2"
          title="Refresh"
          onClick={() => location.reload()}
        >
          <RefreshCw size={18} />
        </button>

        <div className="theme-topbar-divider hidden sm:block" />

        <div className="relative" ref={userRef}>
          <button
            type="button"
            onClick={() => setUserOpen((v) => !v)}
            className="theme-topbar-user-btn"
          >
            <span className="theme-topbar-avatar">
              {(user?.username?.[0] || 'A').toUpperCase()}
            </span>
            <span className="text-sm font-medium hidden sm:block max-w-[100px] truncate">{user?.username}</span>
            <ChevronDown
              size={14}
              className={`theme-topbar-subtitle hidden sm:block transition-transform ${userOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {userOpen && (
            <div className="theme-topbar-menu absolute right-0 mt-2 w-52 py-2 z-[600] animate-scale-in origin-top-right">
              <div className="px-4 py-3 border-b border-[var(--topbar-menu-border)]">
                <div className="text-sm font-semibold">{user?.username}</div>
                <div className="theme-topbar-menu-muted text-xs">Administrator</div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="w-full text-left px-4 py-2.5 text-sm text-rose-500 hover:bg-rose-500/10 flex items-center gap-2 transition-colors"
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

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useAuth } from '../context/AuthContext';

type LayoutContextValue = {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within Layout');
  return ctx;
}

export default function Layout({
  title,
  children,
  allowWrite = false,
  fullBleed = false,
}: {
  title: string;
  children: ReactNode;
  /** When true, skip read-only UI locks (License activation page). */
  allowWrite?: boolean;
  /** Fill remaining viewport with minimal padding (e.g. Topology map). */
  fullBleed?: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { canWrite, user } = useAuth();
  const readOnly = !!user && !canWrite && !allowWrite;
  const roleViewer = !!user?.readOnly && !!user?.licenseActivated;

  return (
    <LayoutContext.Provider
      value={{
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar: () => setSidebarOpen((v) => !v),
      }}
    >
      <div className="flex h-[100dvh] max-h-[100dvh] bg-slate-100 bg-mesh-light theme-main overflow-hidden mobile-app-shell">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden animate-fade-in"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Sidebar />

        <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full overflow-hidden lg:pl-0">
          <Topbar title={title} />
          {readOnly && (
            <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2">
              {roleViewer ? (
                <p className="text-sm text-amber-900">
                  <b>Viewer mode</b> — you can browse the entire system, but saving and edits are disabled.
                </p>
              ) : (
                <>
                  <p className="text-sm text-amber-900">
                    <b>Read-only mode</b> — license not activated. You can browse every menu, but saving and edits are disabled.
                  </p>
                  <Link to="/license" className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 hover:text-amber-950 underline underline-offset-2 min-h-10">
                    <KeyRound size={14} /> Activate license
                  </Link>
                </>
              )}
            </div>
          )}
          <main
            className={
              fullBleed
                ? `flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden p-0 page-enter ${readOnly ? 'panel-readonly' : ''}`
                : `flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-y-contain p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] scroll-pb-[calc(var(--keyboard-offset,0px)+1rem)] sm:p-6 lg:p-8 page-enter ${readOnly ? 'panel-readonly' : ''}`
            }
            aria-readonly={readOnly || undefined}
          >
            {fullBleed ? (
              <div className="flex-1 flex flex-col min-h-0 w-full min-w-0">{children}</div>
            ) : (
              <div className="max-w-[1600px] mx-auto w-full min-w-0">{children}</div>
            )}
          </main>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}

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
}: {
  title: string;
  children: ReactNode;
  /** When true, skip read-only UI locks (License activation page). */
  allowWrite?: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { canWrite, user } = useAuth();
  const readOnly = !!user && !canWrite && !allowWrite;

  return (
    <LayoutContext.Provider
      value={{
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar: () => setSidebarOpen((v) => !v),
      }}
    >
      <div className="flex min-h-screen bg-slate-100 bg-mesh-light">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden animate-fade-in"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <Sidebar />

        <div className="flex-1 flex flex-col min-w-0 lg:pl-0">
          <Topbar title={title} />
          {readOnly && (
            <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-amber-900">
                <b>Read-only mode</b> — license not activated. You can browse every menu, but saving and edits are disabled.
              </p>
              <Link to="/license" className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 hover:text-amber-950 underline underline-offset-2">
                <KeyRound size={14} /> Activate license
              </Link>
            </div>
          )}
          <main
            className={`flex-1 p-4 sm:p-6 lg:p-8 page-enter ${readOnly ? 'panel-readonly' : ''}`}
            aria-readonly={readOnly || undefined}
          >
            <div className="max-w-[1600px] mx-auto">{children}</div>
          </main>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Bot, TerminalSquare, Router, Network, Users, Share2, Map,
  BarChart3, Boxes, Wifi, FileCode2, Globe, Building2, Settings, ShieldCheck,
  DownloadCloud, ServerCog, ScrollText, KeyRound, Activity, Bell, ChevronDown,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Logo from './Logo';
import { useLayout } from './Layout';

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };
type NavSection = { title: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/terminal', label: 'Terminal', icon: TerminalSquare },
      { to: '/ai-scripting', label: 'AI Scripting', icon: Bot },
    ],
  },
  {
    title: 'Network',
    items: [
      { to: '/routers', label: 'Routers', icon: Router },
      { to: '/network', label: 'Network', icon: Network },
      { to: '/pppoe', label: 'PPPoE Management', icon: Users },
      { to: '/ipoe', label: 'IPoE Management', icon: Share2 },
      { to: '/map', label: 'Clients Map', icon: Map },
      { to: '/zerotier', label: 'ZeroTier', icon: Globe },
      { to: '/super-router', label: 'Super Router', icon: ServerCog },
      { to: '/files', label: 'Mikrotik Files', icon: FileCode2 },
    ],
  },
  {
    title: 'Business',
    items: [
      { to: '/sales', label: 'Sales Report', icon: BarChart3 },
      { to: '/inventory', label: 'Stock & Inventory', icon: Boxes },
      { to: '/hotspot', label: 'Hotspot', icon: Wifi },
      { to: '/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/uptime', label: 'Uptime Monitor', icon: Activity },
      { to: '/logs', label: 'System Logs', icon: ScrollText },
      { to: '/company', label: 'Company', icon: Building2 },
      { to: '/settings', label: 'System Settings', icon: Settings },
      { to: '/roles', label: 'Panel Roles', icon: ShieldCheck },
      { to: '/updater', label: 'Updater', icon: DownloadCloud },
      { to: '/license', label: 'License', icon: KeyRound },
    ],
  },
];

export default function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useLayout();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleSection = (title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <aside
      className={[
        'fixed lg:sticky top-0 z-50 h-screen w-[var(--sidebar-width)] shrink-0',
        'bg-slate-950 text-slate-300 flex flex-col shadow-sidebar',
        'border-r border-slate-800/80 transition-transform duration-300 ease-out',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      ].join(' ')}
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/80 bg-slate-950/95">
        <Logo size="sm" variant="dark" />
        <button
          type="button"
          className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto sidebar-scroll py-3 px-2">
        {NAV_SECTIONS.map((section) => {
          const isCollapsed = collapsed[section.title];
          return (
            <div key={section.title} className="mb-1">
              <button
                type="button"
                onClick={() => toggleSection(section.title)}
                className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-400 transition-colors"
              >
                <span>{section.title}</span>
                <ChevronDown
                  size={12}
                  className={`transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                />
              </button>

              {!isCollapsed && (
                <div className="space-y-0.5 animate-fade-in">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={() => setSidebarOpen(false)}
                        className={({ isActive }) =>
                          [
                            'group relative flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl mx-1 transition-all duration-200',
                            isActive
                              ? 'bg-brand-500/15 text-brand-300 font-medium shadow-glow-sm'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60',
                          ].join(' ')
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && <span className="nav-active-indicator" />}
                            <span
                              className={[
                                'flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200',
                                isActive
                                  ? 'bg-brand-500/20 text-brand-400'
                                  : 'bg-slate-800/50 text-slate-500 group-hover:bg-slate-800 group-hover:text-slate-300',
                              ].join(' ')}
                            >
                              <Icon size={17} strokeWidth={isActive ? 2.25 : 2} />
                            </span>
                            <span className="truncate">{item.label}</span>
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-slate-800/80 bg-slate-950/95">
        <div className="flex items-center gap-2 px-2 py-2 rounded-xl bg-slate-900/80 border border-slate-800/60">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-slate-300">Panel Online</div>
            <div className="text-[10px] text-slate-500">v1.0 Beta 2</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

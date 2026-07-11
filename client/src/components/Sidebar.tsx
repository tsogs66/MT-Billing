import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Bot, TerminalSquare, Network, Users, Share2, Map,
  BarChart3, Boxes, Wifi, FileCode2, Globe, Building2, Settings, ShieldCheck,
  DownloadCloud, ServerCog, ScrollText, KeyRound, Activity, Bell, ChevronDown,
  X, Link2, PieChart, ShieldAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Logo from './Logo';
import { useLayout } from './Layout';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; permission: string };
type NavSection = { title: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, permission: 'dashboard' },
      { to: '/terminal', label: 'Terminal', icon: TerminalSquare, permission: 'terminal' },
      { to: '/ai-scripting', label: 'AI Scripting', icon: Bot, permission: 'ai' },
    ],
  },
  {
    title: 'Network',
    items: [
      { to: '/network', label: 'Network', icon: Network, permission: 'network' },
      { to: '/pppoe', label: 'PPPoE Management', icon: Users, permission: 'pppoe' },
      { to: '/ipoe', label: 'IPoE Management', icon: Share2, permission: 'ipoe' },
      { to: '/map', label: 'Topology', icon: Map, permission: 'map' },
      { to: '/zerotier', label: 'ZeroTier', icon: Globe, permission: 'zerotier' },
      { to: '/super-router', label: 'Super Router', icon: ServerCog, permission: 'super-router' },
      { to: '/files', label: 'Mikrotik Files', icon: FileCode2, permission: 'files' },
    ],
  },
  {
    title: 'Business',
    items: [
      { to: '/sales', label: 'Sales Report', icon: BarChart3, permission: 'sales' },
      { to: '/pay-portal', label: 'Payment Links', icon: Link2, permission: 'sales' },
      { to: '/usage', label: 'Usage Stats', icon: PieChart, permission: 'pppoe' },
      { to: '/fair-use', label: 'Fair Use Alerts', icon: ShieldAlert, permission: 'pppoe' },
      { to: '/inventory', label: 'Stock & Inventory', icon: Boxes, permission: 'inventory' },
      { to: '/hotspot', label: 'Hotspot', icon: Wifi, permission: 'hotspot' },
      { to: '/notifications', label: 'Notifications', icon: Bell, permission: 'notifications' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/uptime', label: 'Uptime Monitor', icon: Activity, permission: 'uptime' },
      { to: '/logs', label: 'System Logs', icon: ScrollText, permission: 'logs' },
      { to: '/company', label: 'Company', icon: Building2, permission: 'company' },
      { to: '/settings', label: 'System Settings', icon: Settings, permission: 'settings' },
      { to: '/roles', label: 'Panel Roles', icon: ShieldCheck, permission: 'roles' },
      { to: '/updater', label: 'Updater', icon: DownloadCloud, permission: 'updater' },
      { to: '/license', label: 'License', icon: KeyRound, permission: 'license' },
    ],
  },
];

export default function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useLayout();
  const { canAccess, user } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const scrollPos = useRef(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const logoVariant = theme === 'light' ? 'light' : 'dark';

  // Preserve sidebar scroll — do not jump when a menu is selected
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    el.scrollTop = scrollPos.current;
  }, [location.pathname]);

  const onNavScroll = () => {
    if (navRef.current) scrollPos.current = navRef.current.scrollTop;
  };

  const toggleSection = (title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => canAccess(item.permission))
      .map((item) =>
        item.to === '/'
          ? { ...item, label: user?.licenseActivated ? 'Dashboard' : 'System Overview' }
          : item
      ),
  })).filter((s) => s.items.length > 0);

  return (
    <aside
      className={[
        'theme-sidebar fixed lg:sticky top-0 z-50 h-screen w-[var(--sidebar-width)] shrink-0',
        'flex flex-col shadow-sidebar transition-transform duration-300 ease-out',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      ].join(' ')}
    >
      <div className="theme-sidebar-header h-16 flex items-center justify-between px-4 shrink-0">
        <Logo size="sm" variant={logoVariant} />
        <button
          type="button"
          className="theme-sidebar-icon-btn lg:hidden p-1.5 rounded-lg transition-colors"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close sidebar"
        >
          <X size={18} />
        </button>
      </div>

      <nav
        ref={navRef}
        onScroll={onNavScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden sidebar-scroll py-3 px-2 overscroll-contain"
        style={{ overflowAnchor: 'none' }}
      >
        {!user?.licenseActivated && (
          <div className="theme-sidebar-banner mx-2 mb-3 rounded-lg px-3 py-2 text-[11px] leading-snug">
            License inactive — all menus are visible in <b>read-only</b> mode. Activate to enable edits.
          </div>
        )}
        {sections.map((section) => {
          const isCollapsed = collapsed[section.title];
          return (
            <div key={section.title} className="mb-1">
              <button
                type="button"
                onClick={() => toggleSection(section.title)}
                className="theme-sidebar-section w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors"
              >
                <span>{section.title}</span>
                <ChevronDown
                  size={12}
                  className={`transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                />
              </button>

              {!isCollapsed && (
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={() => {
                          if (navRef.current) scrollPos.current = navRef.current.scrollTop;
                          setSidebarOpen(false);
                        }}
                        className={({ isActive }) =>
                          [
                            'theme-sidebar-link group relative flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl mx-1 transition-all duration-200',
                            isActive ? 'is-active font-medium' : '',
                          ].join(' ')
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && <span className="nav-active-indicator" />}
                            <span
                              className={[
                                'theme-sidebar-link-icon flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200',
                                isActive ? 'is-active' : '',
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

      <div className="theme-sidebar-footer px-4 py-4 shrink-0">
        <div className="theme-sidebar-user flex items-center gap-2 px-2 py-2 rounded-xl">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="theme-sidebar-user-name text-xs font-medium truncate">{user?.username || 'Panel'}</div>
            <div className="theme-sidebar-user-meta text-[10px] truncate">{user?.role || '—'} · ts0gs v1.0.0</div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Map pathname → permission key for route guards */
export function permissionForPath(pathname: string): string {
  if (pathname === '/' || pathname === '') return 'dashboard';
  const map: Record<string, string> = {
    '/terminal': 'terminal',
    '/ai-scripting': 'ai',
    '/routers': 'network',
    '/network': 'network',
    '/pppoe': 'pppoe',
    '/ipoe': 'ipoe',
    '/map': 'map',
    '/zerotier': 'zerotier',
    '/super-router': 'super-router',
    '/files': 'files',
    '/sales': 'sales',
    '/pay-portal': 'sales',
    '/usage': 'pppoe',
    '/fair-use': 'pppoe',
    '/inventory': 'inventory',
    '/hotspot': 'hotspot',
    '/notifications': 'notifications',
    '/uptime': 'uptime',
    '/logs': 'logs',
    '/company': 'company',
    '/settings': 'settings',
    '/roles': 'roles',
    '/updater': 'updater',
    '/license': 'license',
  };
  return map[pathname] || 'dashboard';
}

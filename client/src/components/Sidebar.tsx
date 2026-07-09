import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Bot, TerminalSquare, Router, Network, Users, Share2, Map,
  BarChart3, Boxes, Wifi, FileCode2, Globe, Building2, Settings, ShieldCheck,
  DownloadCloud, ServerCog, ScrollText, KeyRound,
} from 'lucide-react';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/ai-scripting', label: 'AI Scripting', icon: Bot },
  { to: '/terminal', label: 'Terminal', icon: TerminalSquare },
  { to: '/routers', label: 'Routers', icon: Router },
  { to: '/network', label: 'Network', icon: Network },
  { to: '/pppoe', label: 'PPPoE Management', icon: Users },
  { to: '/ipoe', label: 'IPoE Management', icon: Share2 },
  { to: '/map', label: 'Clients Map', icon: Map },
  { to: '/sales', label: 'Sales Report', icon: BarChart3 },
  { to: '/inventory', label: 'Stock & Inventory', icon: Boxes },
  { to: '/hotspot', label: 'Hotspot', icon: Wifi },
  { to: '/files', label: 'Mikrotik Files', icon: FileCode2 },
  { to: '/zerotier', label: 'ZeroTier', icon: Globe },
  { to: '/company', label: 'Company', icon: Building2 },
  { to: '/settings', label: 'System Settings', icon: Settings },
  { to: '/roles', label: 'Panel Roles', icon: ShieldCheck },
  { to: '/updater', label: 'Updater', icon: DownloadCloud },
  { to: '/super-router', label: 'Super Router', icon: ServerCog },
  { to: '/logs', label: 'System Logs', icon: ScrollText },
  { to: '/license', label: 'License', icon: KeyRound },
];

export default function Sidebar() {
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
      <div className="h-14 flex items-center gap-2 px-4 border-b border-slate-200">
        <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white font-bold">
          <span className="text-sm">M</span>
        </div>
        <span className="font-semibold text-slate-800">Pa-North</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 px-4 py-2 text-sm mx-2 rounded-lg transition-colors',
                  isActive
                    ? 'bg-brand-500 text-white font-medium shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100',
                ].join(' ')
              }
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="px-4 py-3 text-xs text-slate-400 border-t border-slate-200">v1.0 Beta 2</div>
    </aside>
  );
}

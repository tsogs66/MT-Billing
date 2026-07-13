import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Network, BarChart3, Menu,
} from 'lucide-react';
import { useLayout } from './Layout';
import { useAuth } from '../context/AuthContext';

/**
 * Mobile-only bottom navigation bar.
 * Shows 4 key destinations + a "More" button that opens the full sidebar.
 * Hidden on lg+ screens where the sidebar is always visible.
 */
export default function BottomNav() {
  const { toggleSidebar } = useLayout();
  const { canAccess } = useAuth();

  const items = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, perm: 'dashboard' },
    { to: '/pppoe', label: 'PPPoE', icon: Users, end: false, perm: 'pppoe' },
    { to: '/network', label: 'Network', icon: Network, end: false, perm: 'network' },
    { to: '/sales', label: 'Sales', icon: BarChart3, end: false, perm: 'sales' },
  ].filter((item) => canAccess(item.perm));

  return (
    <nav
      className="bottom-nav lg:hidden"
      aria-label="Bottom navigation"
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [
                'bottom-nav-item',
                isActive ? 'is-active' : '',
              ].join(' ')
            }
          >
            {({ isActive }) => (
              <>
                <span className={`bottom-nav-icon ${isActive ? 'is-active' : ''}`}>
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 1.75} />
                </span>
                <span className="bottom-nav-label">{item.label}</span>
              </>
            )}
          </NavLink>
        );
      })}

      {/* More button — opens sidebar for less-used items */}
      <button
        type="button"
        className="bottom-nav-item"
        onClick={toggleSidebar}
        aria-label="More menu"
      >
        <span className="bottom-nav-icon">
          <Menu size={20} strokeWidth={1.75} />
        </span>
        <span className="bottom-nav-label">More</span>
      </button>
    </nav>
  );
}

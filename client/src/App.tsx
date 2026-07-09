import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { PageStub } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PPPoE from './pages/PPPoE';
import ClientsMap from './pages/ClientsMap';
import SalesReport from './pages/SalesReport';
import Routers from './pages/Routers';
import Inventory from './pages/Inventory';
import Hotspot from './pages/Hotspot';
import Logs from './pages/Logs';
import Company from './pages/Company';
import { Loader2 } from 'lucide-react';

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <>{children}</>;
}

const stub = (title: string, description: string) => (
  <Layout title={title}>
    <PageStub title={title} description={description} />
  </Layout>
);

export default function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/*"
        element={
          <Protected>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/pppoe" element={<PPPoE service="pppoe" title="PPPoE Management" />} />
              <Route path="/ipoe" element={<PPPoE service="ipoe" title="IPoE Management" />} />
              <Route path="/map" element={<ClientsMap />} />
              <Route path="/sales" element={<SalesReport />} />
              <Route path="/routers" element={<Routers />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/hotspot" element={<Hotspot />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/company" element={<Company />} />
              <Route path="/ai-scripting" element={stub('AI Scripting', 'Generate and deploy RouterOS scripts with AI assistance.')} />
              <Route path="/terminal" element={stub('Terminal', 'Web SSH/API terminal to the selected MikroTik router.')} />
              <Route path="/network" element={stub('Network', 'Interfaces, IP addresses, DHCP, firewall and routing overview.')} />
              <Route path="/files" element={stub('Mikrotik Files', 'Browse, upload and manage files stored on the router.')} />
              <Route path="/zerotier" element={stub('ZeroTier', 'Manage ZeroTier networks and member authorization.')} />
              <Route path="/settings" element={stub('System Settings', 'Panel configuration, backups, notifications and integrations.')} />
              <Route path="/roles" element={stub('Panel Roles', 'Create roles and assign granular permissions to operators.')} />
              <Route path="/updater" element={stub('Updater', 'Check for panel updates and apply them safely.')} />
              <Route path="/super-router" element={stub('Super Router', 'Central controller for managing multiple MikroTik routers.')} />
              <Route path="/license" element={stub('License', 'View and activate your MT-Billing license.')} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Protected>
        }
      />
    </Routes>
  );
}

import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import { PageStub } from './components/ui';
import { permissionForPath } from './components/Sidebar';
import Login from './pages/Login';
import { Loader2 } from 'lucide-react';
import Logo from './components/Logo';
import { Suspense, lazy, useEffect } from 'react';
import { PRODUCT_TITLE } from './branding';
import { useAndroidBackButton } from './lib/useAndroidBackButton';
import ChunkErrorBoundary from './components/ChunkErrorBoundary';

// Route-level code splitting keeps the initial mobile bundle small — each page
// (and its heavy deps: Leaflet, Recharts, xterm, tesseract) loads on demand.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const PPPoE = lazy(() => import('./pages/PPPoE'));
const IPoE = lazy(() => import('./pages/IPoE'));
const ClientsMap = lazy(() => import('./pages/ClientsMap'));
const SalesReport = lazy(() => import('./pages/SalesReport'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Hotspot = lazy(() => import('./pages/Hotspot'));
const Logs = lazy(() => import('./pages/Logs'));
const Company = lazy(() => import('./pages/Company'));
const Uptime = lazy(() => import('./pages/Uptime'));
const StatusHub = lazy(() => import('./pages/StatusHub'));
const Notifications = lazy(() => import('./pages/Notifications'));
const SystemSettings = lazy(() => import('./pages/SystemSettings'));
const CloudflareAccess = lazy(() => import('./pages/CloudflareAccess'));
const Network = lazy(() => import('./pages/Network'));
const ZeroTier = lazy(() => import('./pages/ZeroTier'));
const MikrotikFiles = lazy(() => import('./pages/MikrotikFiles'));
const Updater = lazy(() => import('./pages/Updater'));
const PanelRoles = lazy(() => import('./pages/PanelRoles'));
const License = lazy(() => import('./pages/License'));
const AiScripting = lazy(() => import('./pages/AiScripting'));
const TerminalPage = lazy(() => import('./pages/Terminal'));
const SubscriberPay = lazy(() => import('./pages/SubscriberPay'));
const PayPortal = lazy(() => import('./pages/PayPortal'));
const UsageStats = lazy(() => import('./pages/UsageStats'));
const FairUseAlerts = lazy(() => import('./pages/FairUseAlerts'));

function DocumentTitle() {
  useEffect(() => {
    document.title = PRODUCT_TITLE;
  }, []);
  return null;
}

function RouteFallback() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="flex items-center gap-3 text-slate-400">
        <Loader2 className="animate-spin text-brand-400" size={20} />
        <span className="text-sm font-medium">Loading…</span>
      </div>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 bg-mesh-dark gap-6">
        <Logo size="lg" variant="dark" className="animate-pulse-soft" />
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="animate-spin text-brand-400" size={20} />
          <span className="text-sm font-medium">Loading panel…</span>
        </div>
      </div>
    );
  if (!user) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <>{children}</>;
}

function RequireAccess({ children }: { children: React.ReactNode }) {
  const { canAccess } = useAuth();
  const loc = useLocation();
  const perm = permissionForPath(loc.pathname);
  if (!canAccess(perm)) {
    if (canAccess('dashboard') && loc.pathname !== '/') return <Navigate to="/" replace />;
    if (canAccess('license') && loc.pathname !== '/license') return <Navigate to="/license" replace />;
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

const stub = (title: string, description: string) => (
  <Layout title={title}>
    <PageStub title={title} description={description} />
  </Layout>
);

export default function App() {
  const { user } = useAuth();
  useAndroidBackButton();
  return (
    <>
      <DocumentTitle />
      <ChunkErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/pay/:token" element={<SubscriberPay />} />
      <Route
        path="/*"
        element={
          <Protected>
            <RequireAccess>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/pppoe" element={<PPPoE service="pppoe" title="PPPoE Management" />} />
                <Route path="/ipoe" element={<IPoE />} />
                <Route path="/map" element={<ClientsMap />} />
                <Route path="/sales" element={<SalesReport />} />
                <Route path="/pay-portal" element={<PayPortal />} />
                <Route path="/usage" element={<UsageStats />} />
                <Route path="/fair-use" element={<FairUseAlerts />} />
                <Route path="/routers" element={<Navigate to="/network?tab=routers" replace />} />
                <Route path="/inventory" element={<Inventory />} />
                <Route path="/hotspot" element={<Hotspot />} />
                <Route path="/uptime" element={<Uptime />} />
                <Route path="/status-hub" element={<StatusHub />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/company" element={<Company />} />
                <Route path="/ai-scripting" element={<AiScripting />} />
                <Route path="/terminal" element={<TerminalPage />} />
                <Route path="/network" element={<Network />} />
                <Route path="/files" element={<MikrotikFiles />} />
                <Route path="/zerotier" element={<ZeroTier />} />
                <Route path="/settings" element={<SystemSettings />} />
                <Route path="/cloudflare" element={<CloudflareAccess />} />
                <Route path="/roles" element={<PanelRoles />} />
                <Route path="/updater" element={<Updater />} />
                <Route path="/super-router" element={stub('Super Router', 'Central controller for managing multiple MikroTik routers.')} />
                <Route path="/license" element={<License />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </RequireAccess>
          </Protected>
        }
      />
    </Routes>
    </Suspense>
    </ChunkErrorBoundary>
    </>
  );
}

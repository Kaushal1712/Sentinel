/**
 * App — route tree for Sentinel.
 *
 * Route protection:
 *   ProtectedRoute   → redirects unauthenticated users to /login
 *   PublicOnlyRoute  → redirects authenticated users to /dashboard
 *
 * Both guards show <PageLoader> during auth hydration to prevent flash.
 *
 * Routes implemented in Phase 3C:
 *   /login, /register — full implementation
 *   /dashboard        — full implementation
 *
 * Routes implemented in Phase 3D:
 *   /scan             — full scan workflow (form + polling + progress)
 *
 * Routes pointing to PlaceholderPage (implemented in later phases):
 *   /results, /graph, /geomap, /timeline, /heatmap       (3E)
 *   /datasets, /chat, /visualize, /insights              (3E)
 *   /schedules, /catalog, /settings                      (3F)
 *   /admin, /admin/users, /admin/audit                   (3G)
 */

import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { RouteErrorBoundary } from '@/components/shared/RouteErrorBoundary';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ScanPage } from '@/pages/ScanPage';
import { ResultsPage } from '@/pages/ResultsPage';
import { ResultsListPage } from '@/pages/ResultsListPage';
import { DatasetsPage } from '@/pages/DatasetsPage';
import { DatasetDetailPage } from '@/pages/DatasetDetailPage';
import { DatasetChatPage } from '@/pages/DatasetChatPage';
import { DatasetInsightsPage } from '@/pages/DatasetInsightsPage';
import { SchedulesPage } from '@/pages/SchedulesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { CatalogPage } from '@/pages/CatalogPage';
import { AdminPage } from '@/pages/AdminPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';

// Visualization pages are lazy-loaded (Phase 7E): they are the only importers of
// cytoscape, leaflet and d3, which made up most of the initial bundle.  Pages use
// named exports, so map them to the default export that React.lazy expects.
const GraphPage = lazy(() => import('@/pages/GraphPage').then((m) => ({ default: m.GraphPage })));
const GeoPage = lazy(() => import('@/pages/GeoPage').then((m) => ({ default: m.GeoPage })));
const TimelinePage = lazy(() => import('@/pages/TimelinePage').then((m) => ({ default: m.TimelinePage })));
const HeatmapPage = lazy(() => import('@/pages/HeatmapPage').then((m) => ({ default: m.HeatmapPage })));

// ── Route guards ──────────────────────────────────────────────────────────────

function ProtectedRoute() {
  const { isLoading, isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Lazy chunks are requested only after the auth check passes, so logged-out
  // users never download visualization code.
  return (
    <RouteErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </RouteErrorBoundary>
  );
}

function PublicOnlyRoute() {
  const { isLoading, isAuthenticated } = useAuth();
  if (isLoading) return <PageLoader />;
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

// ── Route tree ────────────────────────────────────────────────────────────────

export function AppRoutes() {
  return (
    <Routes>
      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Public-only (auth pages) */}
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* Protected (all app pages) */}
      <Route element={<ProtectedRoute />}>
        {/* ── Implemented in Phase 3C ── */}
        <Route path="/dashboard" element={<DashboardPage />} />

        {/* ── Phase 3D: Scan Workflow — IMPLEMENTED ── */}
        <Route path="/scan" element={<ScanPage />} />
        {/* Phase 3 complete: /results list shows scan history */}
        <Route path="/results" element={<ResultsListPage />} />
        {/* Phase 3E: individual scan results */}
        <Route path="/results/:scanId" element={<ResultsPage />} />
        {/* ── Phase 3F: Visualizations — IMPLEMENTED ── */}
        <Route path="/graph/:scanId" element={<GraphPage />} />
        <Route path="/geomap/:scanId" element={<GeoPage />} />
        <Route path="/timeline/:scanId" element={<TimelinePage />} />
        <Route path="/heatmap/:scanId" element={<HeatmapPage />} />
        {/* Bare visualization routes: redirect to /results so user picks a scan */}
        <Route path="/graph" element={<Navigate to="/results" replace />} />
        <Route path="/geomap" element={<Navigate to="/results" replace />} />
        <Route path="/timeline" element={<Navigate to="/results" replace />} />
        <Route path="/heatmap" element={<Navigate to="/results" replace />} />

        {/* ── Phase 3G: Dataset Studio | Phase 3H: Chat + AI Insights ── */}
        <Route path="/datasets" element={<DatasetsPage />} />
        <Route path="/datasets/:id" element={<DatasetDetailPage />} />
        <Route path="/datasets/:id/chat" element={<DatasetChatPage />} />
        <Route path="/datasets/:id/insights" element={<DatasetInsightsPage />} />
        {/* /datasets/:id/visualize — no standalone backend endpoint exists; placeholder retained */}
        <Route path="/datasets/:id/visualize" element={<PlaceholderPage title="Visualize" description="AI chart suggestions are embedded in chat responses. A dedicated chart builder is not yet implemented." />} />

        {/* ── Phase 3I: Automation & Configuration ── */}
        <Route path="/schedules" element={<SchedulesPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* Admin — frontend redirects non-admin; backend enforces 403 */}
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/users" element={<AdminPage />} />
        <Route path="/admin/audit" element={<AdminPage />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

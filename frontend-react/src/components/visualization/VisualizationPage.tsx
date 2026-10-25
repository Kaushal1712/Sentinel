/**
 * VisualizationPage — shared page shell for Graph, Geo, Timeline, Heatmap.
 *
 * Handles:
 *   - Reading :scanId from route params
 *   - Loading + error state at the page level
 *   - ScanHeader (target, mode, status) re-used from results
 *   - Navigation links between the four visualization views and Results
 *   - Children receive the validated scanId as a prop
 */

import { type ReactNode } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Button } from '@/components/shared/Button';
import { ScanStatusBadge, ScanModeBadge } from '@/components/shared/Badge';
import { resultsApi } from '@/api/results';
import { isApiError } from '@/api/client';

const VIZ_TABS = [
  { id: 'graph',    label: 'Graph',    path: 'graph' },
  { id: 'geomap',  label: 'Geo Map',  path: 'geomap' },
  { id: 'timeline',label: 'Timeline', path: 'timeline' },
  { id: 'heatmap', label: 'Heatmap',  path: 'heatmap' },
] as const;

interface VisualizationPageProps {
  title: string;
  children: (scanId: number) => ReactNode;
}

export function VisualizationPage({ title, children }: VisualizationPageProps) {
  const { scanId: scanIdParam } = useParams<{ scanId: string }>();
  const scanId = Number(scanIdParam);
  const location = useLocation();

  // Determine active tab from current path
  const activeTab = VIZ_TABS.find((t) => location.pathname.includes(`/${t.path}/`))?.id ?? VIZ_TABS[0].id;

  // Fetch scan header (same endpoint used by ResultsPage — already cached)
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['scan', scanId, 'results'] as const,
    queryFn: () => resultsApi.getScanResults(scanId),
    enabled: !isNaN(scanId) && scanId > 0,
    staleTime: Infinity,
    retry: (count, err) => {
      const apiErr = err as { status?: number } | null;
      if (apiErr?.status === 404 || apiErr?.status === 403) return false;
      return count < 2;
    },
  });

  if (isNaN(scanId) || scanId <= 0) {
    return (
      <AppLayout>
        <div className="flex min-h-full items-center justify-center p-6">
          <Card className="max-w-sm text-center">
            <p className="text-sm text-text-tertiary">Invalid scan ID.</p>
            <Link to="/dashboard" className="mt-4 inline-block">
              <Button variant="secondary" size="sm">← Dashboard</Button>
            </Link>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex min-h-full items-center justify-center p-6">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  if (isError) {
    const is404 = isApiError(error) && error.status === 404;
    return (
      <AppLayout>
        <div className="flex min-h-full items-center justify-center p-6">
          <Card className="max-w-md text-center">
            <p className="text-base font-semibold text-text-primary">
              {is404 ? 'Scan not found' : 'Failed to load scan'}
            </p>
            <p className="mt-1 text-sm text-text-tertiary">
              {is404 ? 'This scan does not exist or you don\'t have access.' : 'Check your connection and try again.'}
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <Link to="/dashboard"><Button size="sm">Dashboard</Button></Link>
            </div>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const scan = data?.scan;

  return (
    <AppLayout>
      <div className="page-enter min-h-full space-y-5 p-6">
        {/* ── Scan mini-header ─────────────────────────────────────── */}
        {scan && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-bg-card px-4 py-3">
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-text-primary">{scan.target_name}</p>
                  <ScanStatusBadge status={scan.status} />
                  <ScanModeBadge mode={scan.mode} />
                </div>
                <p className="text-xs text-text-tertiary">Scan #{scan.id}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link to={`/results/${scanId}`}>
                <Button variant="secondary" size="sm" id="btn-back-to-results">← Results</Button>
              </Link>
              <Link to="/scan">
                <Button variant="secondary" size="sm" id="btn-new-scan-from-viz">+ New Scan</Button>
              </Link>
            </div>
          </div>
        )}

        {/* ── Visualization tab bar ─────────────────────────────────── */}
        <div role="tablist" className="flex gap-1 rounded-lg border border-white/[0.07] bg-white/[0.03] p-1">
          {VIZ_TABS.map((tab) => (
            <Link
              key={tab.id}
              to={`/${tab.path}/${scanId}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              id={`viz-tab-${tab.id}`}
              className={[
                'flex-1 rounded-md px-3 py-2 text-center text-xs font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'text-text-tertiary hover:text-text-secondary',
              ].join(' ')}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {/* ── Visualization title ───────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        </div>

        {/* ── Visualization content ─────────────────────────────────── */}
        {children(scanId)}
      </div>
    </AppLayout>
  );
}

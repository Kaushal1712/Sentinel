/**
 * ResultsPage — full scan results and evidence viewer.
 *
 * Route: /results/:scanId (protected)
 *
 * Data sources (two parallel TanStack Query calls):
 *   1. GET /api/scan/:id/results  → scan header + profiles list
 *   2. GET /api/results/:id/report → AI risk report (only when completed)
 *
 * Evidence is loaded lazily inside EvidencePanel only when the tab is opened.
 *
 * Tab layout:
 *   [Findings] [Risk Report] [Evidence]
 *
 * Special states:
 *   - 404 / 403 → "Scan not found" card with back-to-dashboard link
 *   - Scan still running → redirect hint to /scan progress page
 *   - Completed with 0 results → empty state
 *   - Failed scan → failure message
 *   - Report load failure → shown independently, findings still visible
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { Button } from '@/components/shared/Button';
import { ResultsHeader } from '@/components/results/ResultsHeader';
import { FindingCard } from '@/components/results/FindingCard';
import { RiskSummary } from '@/components/results/RiskSummary';
import { EvidencePanel } from '@/components/results/EvidencePanel';
import { resultsApi } from '@/api/results';
import { isApiError } from '@/api/client';
import type { ScanResultsResponse } from '@/types';

type TabId = 'findings' | 'report' | 'evidence';

const TABS: { id: TabId; label: string }[] = [
  { id: 'findings', label: 'Findings' },
  { id: 'report',   label: 'Risk Report' },
  { id: 'evidence', label: 'Evidence' },
];

export function ResultsPage() {
  const { scanId: scanIdParam } = useParams<{ scanId: string }>();
  const scanId = Number(scanIdParam);

  const [activeTab, setActiveTab] = useState<TabId>('findings');

  // ── Scan results (profile list + scan header) ──────────────────────────────
  const {
    data: resultsData,
    isLoading: resultsLoading,
    isError: resultsError,
    error: resultsErrorObj,
    refetch,
  } = useQuery<ScanResultsResponse, unknown>({
    queryKey: ['scan', scanId, 'results'] as const,
    queryFn: () => resultsApi.getScanResults(scanId),
    enabled: !isNaN(scanId) && scanId > 0,
    staleTime: Infinity,  // Results don't change after scan completes
    retry: (count, err) => {
      const apiErr = err as { status?: number } | null;
      if (apiErr?.status === 404 || apiErr?.status === 403) return false;
      return count < 2;
    },
  });

  // ── Risk report (separate query so findings still show if report fails) ─────
  const {
    data: reportData,
    isLoading: reportLoading,
    isError: reportError,
  } = useQuery({
    queryKey: ['scan', scanId, 'report'] as const,
    queryFn: () => resultsApi.getScanReport(scanId),
    enabled: !isNaN(scanId) && scanId > 0 && resultsData?.scan.status === 'completed',
    staleTime: Infinity,
    retry: 1,
  });

  // ── Invalid scanId ─────────────────────────────────────────────────────────
  if (isNaN(scanId) || scanId <= 0) {
    return (
      <AppLayout>
        <div className="flex min-h-full items-center justify-center p-6">
          <Card className="w-full max-w-md text-center">
            <p className="text-sm text-text-tertiary mb-4">Invalid scan ID.</p>
            <Link to="/dashboard"><Button variant="secondary">← Dashboard</Button></Link>
          </Card>
        </div>
      </AppLayout>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (resultsLoading) {
    return (
      <AppLayout>
        <div className="flex min-h-full items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3">
            <LoadingSpinner size="lg" />
            <p className="text-sm text-text-tertiary">Loading scan results…</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  // ── Error (404 / 403 / network) ────────────────────────────────────────────
  if (resultsError) {
    const is404 = isApiError(resultsErrorObj) && resultsErrorObj.status === 404;
    return (
      <AppLayout>
        <div className="flex min-h-full items-center justify-center p-6">
          <Card className="w-full max-w-md">
            {is404 ? (
              <div className="py-6 text-center">
                <p className="text-base font-semibold text-text-primary">Scan not found</p>
                <p className="mt-1 text-sm text-text-tertiary">
                  This scan doesn't exist or you don't have access to it.
                </p>
                <div className="mt-5 flex justify-center gap-3">
                  <Link to="/results"><Button variant="secondary" size="sm">All Results</Button></Link>
                  <Link to="/dashboard"><Button size="sm">Dashboard</Button></Link>
                </div>
              </div>
            ) : (
              <ErrorState
                title="Failed to load results"
                error={resultsErrorObj}
                onRetry={() => void refetch()}
              />
            )}
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (!resultsData) return null;

  const { scan, results } = resultsData;

  // ── Scan still running ─────────────────────────────────────────────────────
  if (scan.status === 'pending' || scan.status === 'running') {
    return (
      <AppLayout>
        <div className="flex min-h-full items-center justify-center p-6">
          <Card className="w-full max-w-md text-center">
            <div className="py-6">
              <LoadingSpinner size="lg" />
              <p className="mt-4 text-base font-semibold text-text-primary">
                Scan still in progress
              </p>
              <p className="mt-1 text-sm text-text-tertiary">
                Results will appear once the scan completes.
              </p>
              <div className="mt-5 flex justify-center gap-3">
                <Link to="/scan"><Button variant="secondary" size="sm">← Back to Scan</Button></Link>
              </div>
            </div>
          </Card>
        </div>
      </AppLayout>
    );
  }

  // ── Scan failed ────────────────────────────────────────────────────────────
  if (scan.status === 'failed') {
    return (
      <AppLayout>
        <div className="p-6 space-y-5">
          <ResultsHeader scan={scan} />
          <Card>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="rounded-full bg-accent-red/10 p-4 text-accent-red">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <p className="text-base font-semibold text-text-primary">This scan failed</p>
              <p className="text-sm text-text-tertiary">
                The pipeline was unable to complete. Partial results may be shown below.
              </p>
              <Link to="/scan"><Button size="sm">Start New Scan</Button></Link>
            </div>
          </Card>
        </div>
      </AppLayout>
    );
  }

  // ── Completed scan ─────────────────────────────────────────────────────────

  const categoryOrder: Record<string, number> = {
    social: 0, professional: 1, dev: 2, developer: 2, forum: 3, other: 4,
  };
  const sortedResults = [...results].sort((a, b) => {
    // Sort by risk level first (critical → low), then by category
    const riskOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const riskDiff = (riskOrder[a.risk_level] ?? 4) - (riskOrder[b.risk_level] ?? 4);
    if (riskDiff !== 0) return riskDiff;
    return (categoryOrder[a.category] ?? 5) - (categoryOrder[b.category] ?? 5);
  });

  return (
    <AppLayout>
      <div className="page-enter min-h-full p-6 space-y-5">

        {/* ── Scan header ─────────────────────────────────────────── */}
        <ResultsHeader scan={scan} />

        {/* ── Tab bar ─────────────────────────────────────────────── */}
        <div
          role="tablist"
          aria-label="Results sections"
          className="flex gap-1 rounded-lg border border-white/[0.07] bg-white/[0.03] p-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`tabpanel-${tab.id}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={[
                'flex-1 rounded-md px-3 py-2 text-xs font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-accent-blue/15 text-accent-blue shadow-glow-blue'
                  : 'text-text-tertiary hover:text-text-secondary',
              ].join(' ')}
            >
              {tab.label}
              {tab.id === 'findings' && (
                <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px]">
                  {results.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab panels ──────────────────────────────────────────── */}

        {/* Findings */}
        <div
          role="tabpanel"
          id="tabpanel-findings"
          aria-labelledby="tab-findings"
          hidden={activeTab !== 'findings'}
        >
          {results.length === 0 ? (
            <Card>
              <EmptyState
                title="No profiles discovered"
                description="The scan completed but no matching profiles were found across the checked platforms."
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sortedResults.map((result, i) => (
                <FindingCard key={result.id} result={result} index={i} />
              ))}
            </div>
          )}
        </div>

        {/* Risk Report */}
        <div
          role="tabpanel"
          id="tabpanel-report"
          aria-labelledby="tab-report"
          hidden={activeTab !== 'report'}
        >
          {reportLoading && (
            <Card>
              <div className="flex items-center gap-3 py-8 justify-center">
                <LoadingSpinner />
                <p className="text-sm text-text-tertiary">Generating risk report…</p>
              </div>
            </Card>
          )}
          {reportError && !reportLoading && (
            <Card>
              <ErrorState
                title="Risk report unavailable"
                description="The report could not be generated. Findings are still available in the Findings tab."
              />
            </Card>
          )}
          {reportData?.report && !reportLoading && (
            <Card>
              <RiskSummary report={reportData.report} />
            </Card>
          )}
        </div>

        {/* Evidence */}
        <div
          role="tabpanel"
          id="tabpanel-evidence"
          aria-labelledby="tab-evidence"
          hidden={activeTab !== 'evidence'}
        >
          <Card>
            <EvidencePanel scanId={scan.id} />
          </Card>
        </div>

      </div>
    </AppLayout>
  );
}

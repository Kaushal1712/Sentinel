/**
 * ResultsListPage — /results (no scanId)
 *
 * Displays the authenticated user's scan history.
 * Clicking a scan navigates to /results/:scanId for the full detail view.
 *
 * Data source:
 *   GET /api/results/history
 *   Auth: required
 *   Ownership: backend filters by user_id — no cross-user exposure
 *   Response: { scans: Scan[], total: number }
 *   Limit: backend returns last 50 scans max
 *
 * Visualization links (graph/geo/timeline/heatmap) are shown per completed scan.
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { resultsApi } from '@/api/results';
import type { Scan, ScanStatus } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<ScanStatus, 'low' | 'high' | 'default' | 'medium' | 'critical'> = {
  completed: 'low',
  failed:    'high',
  running:   'medium',
  pending:   'default',
};

function riskColor(score: number | null): string {
  if (score === null) return 'text-text-tertiary';
  if (score >= 8) return 'text-risk-critical';
  if (score >= 6) return 'text-risk-high';
  if (score >= 4) return 'text-risk-medium';
  return 'text-risk-low';
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Scan Row ──────────────────────────────────────────────────────────────────

function ScanRow({ scan }: { scan: Scan }) {
  const isCompleted = scan.status === 'completed';
  const primary = scan.target_name || scan.target_username || scan.target_email || '—';
  const secondary = [
    scan.target_username ? `@${scan.target_username}` : null,
    scan.target_email,
  ].filter(Boolean).join(' · ');

  return (
    <div className="group rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 hover:border-white/[0.12] hover:bg-white/[0.04] transition-all">
      <div className="flex flex-wrap items-start gap-3">
        {/* Scan info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Link
              to={`/results/${scan.id}`}
              className="text-sm font-semibold text-text-primary hover:text-accent-blue transition-colors"
            >
              {primary}
            </Link>
            <Badge variant={STATUS_BADGE[scan.status] ?? 'default'}>
              {scan.status}
            </Badge>
            <Badge variant="default">{scan.mode}</Badge>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-tertiary">
            {secondary && <span>{secondary}</span>}
            <span>Started: {formatDate(scan.created_at)}</span>
            {scan.completed_at && <span>Completed: {formatDate(scan.completed_at)}</span>}
            {isCompleted && (
              <>
                <span>{scan.platforms_found} platform{scan.platforms_found !== 1 ? 's' : ''}</span>
                <span className="flex flex-col gap-0.5">
                  <span>{scan.entities_found} entities</span>
                  {scan.mode === 'quick' && scan.entities_found === 0 && (
                    <span className="text-[9px] leading-tight text-text-tertiary/70">
                      Quick Scan checks snippets only.{' '}
                      Run a Full Scan for deeper extraction.
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Risk score */}
        <div className="flex flex-col items-end gap-2">
          {scan.risk_score !== null && (
            <span className={`text-lg font-bold tabular-nums ${riskColor(scan.risk_score)}`}>
              {scan.risk_score.toFixed(1)}
              <span className="ml-0.5 text-[10px] font-normal text-text-tertiary">/10</span>
            </span>
          )}
          {isCompleted && (
            <span className="text-[10px] font-mono text-text-tertiary">#{scan.id}</span>
          )}
        </div>
      </div>

      {/* Action row for completed scans */}
      {isCompleted && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.05] pt-3">
          <Link to={`/results/${scan.id}`}>
            <Button variant="ghost" size="sm" id={`btn-scan-${scan.id}-results`}>
              Results
            </Button>
          </Link>
          <Link to={`/graph/${scan.id}`}>
            <Button variant="ghost" size="sm" id={`btn-scan-${scan.id}-graph`}>
              Graph
            </Button>
          </Link>
          <Link to={`/geomap/${scan.id}`}>
            <Button variant="ghost" size="sm" id={`btn-scan-${scan.id}-geo`}>
              Geo
            </Button>
          </Link>
          <Link to={`/timeline/${scan.id}`}>
            <Button variant="ghost" size="sm" id={`btn-scan-${scan.id}-timeline`}>
              Timeline
            </Button>
          </Link>
          <Link to={`/heatmap/${scan.id}`}>
            <Button variant="ghost" size="sm" id={`btn-scan-${scan.id}-heatmap`}>
              Heatmap
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Filter / sort state ───────────────────────────────────────────────────────

type FilterStatus = 'all' | 'completed' | 'running' | 'failed';

const FILTER_OPTIONS: { id: FilterStatus; label: string }[] = [
  { id: 'all',       label: 'All' },
  { id: 'completed', label: 'Completed' },
  { id: 'running',   label: 'Running' },
  { id: 'failed',    label: 'Failed' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export function ResultsListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['scan-history'] as const,
    queryFn: () => resultsApi.getScanHistory(),
    staleTime: 30_000,
    retry: 2,
  });

  const allScans = data?.scans ?? [];

  const filtered = allScans.filter((s) => {
    if (filter !== 'all' && s.status !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        s.target_name?.toLowerCase().includes(q) ||
        s.target_username?.toLowerCase().includes(q) ||
        s.target_email?.toLowerCase().includes(q) ||
        false
      );
    }
    return true;
  });

  return (
    <AppLayout>
      <div className="page-enter min-h-full space-y-5 p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-text-primary">Scan Results</h1>
            <p className="mt-1 text-sm text-text-tertiary">
              {data ? `${data.total} recent scan${data.total !== 1 ? 's' : ''}` : 'Your scan history'}
            </p>
          </div>
          <Button
            id="btn-new-scan"
            onClick={() => navigate('/scan')}
          >
            + New Scan
          </Button>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Status filter pills */}
          <div className="flex gap-1 rounded-lg border border-white/[0.07] bg-white/[0.03] p-1">
            {FILTER_OPTIONS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                id={`btn-filter-${id}`}
                onClick={() => setFilter(id)}
                className={[
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                  filter === id
                    ? 'bg-accent-blue/15 text-accent-blue'
                    : 'text-text-tertiary hover:text-text-secondary',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            id="results-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, username, email…"
            className="flex-1 min-w-[200px] rounded-lg border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent-blue/40 focus:ring-1 focus:ring-accent-blue/20"
          />
        </div>

        {/* Content */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="lg" />
          </div>
        )}

        {isError && (
          <Card>
            <ErrorState title="Failed to load scan history" error={error} onRetry={() => void refetch()} />
          </Card>
        )}

        {!isLoading && !isError && allScans.length === 0 && (
          <EmptyState
            title="No scans yet"
            description="Run your first digital footprint scan to see results here."
            action={
              <Button id="btn-empty-new-scan" onClick={() => navigate('/scan')}>
                Start a Scan
              </Button>
            }
          />
        )}

        {!isLoading && !isError && allScans.length > 0 && filtered.length === 0 && (
          <Card>
            <p className="py-6 text-center text-sm text-text-tertiary">
              No scans match your filter.{' '}
              <button
                type="button"
                className="text-accent-blue hover:underline"
                onClick={() => { setFilter('all'); setSearch(''); }}
              >
                Clear filters
              </button>
            </p>
          </Card>
        )}

        {!isLoading && !isError && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((scan) => (
              <ScanRow key={scan.id} scan={scan} />
            ))}
            {data && data.total >= 50 && (
              <p className="text-center text-xs text-text-tertiary pt-2">
                Showing the 50 most recent scans.
              </p>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

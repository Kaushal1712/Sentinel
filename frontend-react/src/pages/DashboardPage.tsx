/**
 * DashboardPage — main Sentinel intelligence overview.
 *
 * Data: GET /api/dashboard/stats (single request, TanStack Query)
 * Response: { stats, recent_scans[], top_platforms[], timeline[] }
 *
 * Sections:
 *   1. Welcome header (user name from AuthContext — no extra request)
 *   2. Stat cards: 6 stats from DashboardResponse.stats
 *   3. Recent scans table (last 10 scans)
 *   4. Bottom row: Top Platforms + 14-day Activity Sparkline
 *   5. Quick actions: New Scan, View Results (navigation links only)
 *
 * No chart library is used in this phase. Simple CSS bars + SVG sparklines.
 * Recharts charts are added in the visualization phase.
 *
 * Auth: Protected by ProtectedRoute. currentUser is always non-null here.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { Button } from '@/components/shared/Button';
import { StatCard } from '@/components/dashboard/StatCard';
import { RecentScansTable } from '@/components/dashboard/RecentScansTable';
import { TopPlatformsCard } from '@/components/dashboard/TopPlatformsCard';
import { TimelineSparkline } from '@/components/dashboard/TimelineSparkline';
import { dashboardApi } from '@/api/dashboard';
import { useAuth } from '@/hooks/useAuth';

// TanStack Query key
const DASHBOARD_QUERY_KEY = ['dashboard', 'stats'] as const;

export function DashboardPage() {
  const { currentUser } = useAuth();

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: () => dashboardApi.getStats(),
    staleTime: 30_000,         // Refresh after 30s
    refetchOnWindowFocus: true,
  });

  const { stats, recent_scans, top_platforms, timeline } = data ?? {
    stats: null,
    recent_scans: [],
    top_platforms: [],
    timeline: [],
  };

  return (
    <AppLayout>
      <div className="page-enter min-h-full p-6 space-y-6">

        {/* ── Welcome header ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-text-primary">
              Welcome back,{' '}
              <span className="text-accent-blue">
                {currentUser?.full_name?.split(' ')[0] ?? 'Analyst'}
              </span>
            </h2>
            <p className="mt-1 text-sm text-text-tertiary">
              Here&apos;s your digital footprint intelligence overview.
            </p>
          </div>
          {/* Quick actions */}
          <div className="flex shrink-0 gap-3">
            <Link to="/scan">
              <Button id="btn-new-scan" size="sm">
                + New Scan
              </Button>
            </Link>
            <Link to="/results">
              <Button id="btn-view-results" variant="secondary" size="sm">
                View Results
              </Button>
            </Link>
          </div>
        </div>

        {/* ── Loading ────────────────────────────────────────────────── */}
        {isLoading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <LoadingSpinner size="lg" />
              <p className="text-sm text-text-tertiary">Loading dashboard…</p>
            </div>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────────────── */}
        {isError && !isLoading && (
          <Card>
            <ErrorState
              error={error}
              title="Dashboard unavailable"
              onRetry={() => void refetch()}
            />
          </Card>
        )}

        {/* ── Stats grid ─────────────────────────────────────────────── */}
        {stats && (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard
                label="Total Scans"
                value={stats.total_scans}
                colorClass="bg-accent-blue/10 text-accent-blue"
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                  </svg>
                }
              />
              <StatCard
                label="Completed"
                value={stats.completed_scans}
                colorClass="bg-accent-green/10 text-accent-green"
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                }
              />
              <StatCard
                label="Running"
                value={stats.running_scans}
                colorClass="bg-accent-amber/10 text-accent-amber"
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                }
                sub={stats.running_scans > 0 ? 'Active right now' : undefined}
              />
              <StatCard
                label="Avg Risk"
                value={stats.avg_risk_score}
                decimal
                colorClass="bg-accent-red/10 text-accent-red"
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                }
                sub="out of 10.0"
              />
              <StatCard
                label="Profiles Found"
                value={stats.total_profiles_found}
                colorClass="bg-accent-purple/10 text-accent-purple"
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                }
              />
              <StatCard
                label="Entities"
                value={stats.total_entities_found}
                colorClass="bg-accent-cyan/10 text-accent-cyan"
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" />
                    <line x1="8.5" y1="6" x2="15.5" y2="6" />
                    <line x1="18" y1="8.5" x2="18" y2="15.5" />
                  </svg>
                }
              />
            </div>

            {/* ── Recent scans ──────────────────────────────────────── */}
            <Card padding={false}>
              <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
                <h3 className="text-sm font-semibold text-text-primary">Recent Scans</h3>
                <Link
                  to="/results"
                  className="text-xs text-accent-blue hover:underline"
                >
                  View all →
                </Link>
              </div>
              <div className="p-5">
                <RecentScansTable scans={recent_scans} />
              </div>
            </Card>

            {/* ── Bottom row ────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Top platforms */}
              <Card>
                <h3 className="mb-4 text-sm font-semibold text-text-primary">
                  Top Platforms
                </h3>
                <TopPlatformsCard platforms={top_platforms} />
              </Card>

              {/* 14-day activity sparkline */}
              <Card>
                <h3 className="mb-4 text-sm font-semibold text-text-primary">
                  14-Day Activity
                </h3>
                <TimelineSparkline timeline={timeline} />
                {stats.avg_risk_score > 0 && (
                  <div className="mt-4 flex items-center gap-2 rounded-lg bg-white/[0.03] px-4 py-3">
                    <div
                      className={[
                        'h-2 w-2 rounded-full',
                        stats.avg_risk_score >= 8 ? 'bg-risk-critical' :
                        stats.avg_risk_score >= 6 ? 'bg-risk-high' :
                        stats.avg_risk_score >= 3 ? 'bg-risk-medium' :
                        'bg-risk-low',
                      ].join(' ')}
                    />
                    <p className="text-xs text-text-tertiary">
                      Average risk score:{' '}
                      <span className="font-semibold text-text-secondary">
                        {stats.avg_risk_score.toFixed(1)} / 10
                      </span>
                    </p>
                  </div>
                )}
              </Card>
            </div>

            {/* ── No-data CTA ───────────────────────────────────────── */}
            {stats.total_scans === 0 && (
              <Card>
                <div className="flex flex-col items-center gap-4 py-10 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-blue/10 text-accent-blue">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-text-primary">
                      Run your first scan
                    </p>
                    <p className="mt-1 text-sm text-text-tertiary">
                      Discover your digital footprint across the web.
                    </p>
                  </div>
                  <Link to="/scan">
                    <Button id="btn-first-scan">Start New Scan</Button>
                  </Link>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

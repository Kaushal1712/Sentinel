/**
 * ResultsHeader — scan summary / metadata bar at the top of the results page.
 *
 * Shows: target name, scan mode, status, dates, risk score, and action links.
 * Data comes exclusively from Scan.to_dict() — no invented fields.
 */

import { Link } from 'react-router-dom';
import { Badge, RiskBadge, ScanModeBadge, ScanStatusBadge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { resultsApi } from '@/api/results';
import type { Scan } from '@/types';

interface ResultsHeaderProps {
  scan: Scan;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

export function ResultsHeader({ scan }: ResultsHeaderProps) {
  const riskLevel =
    scan.risk_score === null ? null
    : scan.risk_score >= 8 ? 'critical'
    : scan.risk_score >= 6 ? 'high'
    : scan.risk_score >= 3 ? 'medium'
    : 'low';

  return (
    <div className="rounded-xl border border-white/[0.07] bg-bg-card p-5 space-y-4">
      {/* Top row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-text-primary">
              {scan.target_name}
            </h2>
            <ScanStatusBadge status={scan.status} />
            <ScanModeBadge mode={scan.mode} />
          </div>
          {scan.target_username && (
            <p className="mt-0.5 text-sm text-text-tertiary">@{scan.target_username}</p>
          )}
          {scan.target_email && (
            <p className="text-xs text-text-tertiary">{scan.target_email}</p>
          )}
        </div>

        {/* Actions + visualization links */}
        <div className="flex shrink-0 flex-wrap gap-2">
          {/* Visualization links — only shown for completed scans */}
          {scan.status === 'completed' && (
            <>
              <Link to={`/graph/${scan.id}`}>
                <Button variant="secondary" size="sm" id="btn-view-graph">Graph</Button>
              </Link>
              <Link to={`/geomap/${scan.id}`}>
                <Button variant="secondary" size="sm" id="btn-view-geomap">Geo</Button>
              </Link>
              <Link to={`/timeline/${scan.id}`}>
                <Button variant="secondary" size="sm" id="btn-view-timeline">Timeline</Button>
              </Link>
              <Link to={`/heatmap/${scan.id}`}>
                <Button variant="secondary" size="sm" id="btn-view-heatmap">Heatmap</Button>
              </Link>
            </>
          )}
          <Link to="/scan">
            <Button variant="secondary" size="sm" id="btn-new-scan-from-results">
              + New Scan
            </Button>
          </Link>
          <Link to="/dashboard">
            <Button variant="secondary" size="sm" id="btn-back-dashboard">
              Dashboard
            </Button>
          </Link>
        </div>
      </div>

      {/* Metadata row */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-white/[0.06] pt-4 text-xs text-text-tertiary">
        <span>
          <span className="mr-1 text-text-tertiary">Scan ID:</span>
          <span className="font-mono text-text-secondary">#{scan.id}</span>
        </span>
        <span>
          <span className="mr-1">Started:</span>
          <span className="text-text-secondary">{formatDateTime(scan.created_at)}</span>
        </span>
        {scan.completed_at && (
          <span>
            <span className="mr-1">Completed:</span>
            <span className="text-text-secondary">{formatDateTime(scan.completed_at)}</span>
          </span>
        )}
        {scan.completed_at && (
          <span>
            <span className="mr-1">Duration:</span>
            <span className="text-text-secondary">
              {formatDuration(scan.created_at, scan.completed_at)}
            </span>
          </span>
        )}
        {scan.execution_backend && (
          <span>
            <span className="mr-1">Backend:</span>
            <Badge variant="default">{scan.execution_backend}</Badge>
          </span>
        )}
      </div>

      {/* Risk + stats quick row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuickStat
          label="Risk Score"
          value={<RiskBadge score={scan.risk_score} />}
        />
        <QuickStat
          label="Risk Level"
          value={
            riskLevel ? (
              <Badge variant={riskLevel}>{riskLevel.toUpperCase()}</Badge>
            ) : <span className="text-text-tertiary text-xs">—</span>
          }
        />
        <QuickStat
          label="Platforms"
          value={<span className="text-lg font-bold tabular-nums text-text-primary">{scan.platforms_found}</span>}
        />
        <QuickStat
          label="Entities"
          value={
            <>
              <span className="text-lg font-bold tabular-nums text-text-primary">
                {scan.entities_found}
              </span>
              {scan.mode === 'quick' && scan.entities_found === 0 && (
                <p className="mt-0.5 text-[9px] leading-tight text-text-tertiary/70">
                  Quick Scan checks snippets only.{' '}
                  Run a Full Scan for deeper extraction.
                </p>
              )}
            </>
          }
        />
      </div>

      {/* Export actions */}
      {scan.status === 'completed' && (
        <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
          <span className="self-center text-xs text-text-tertiary">Export:</span>
          {(['json', 'csv', 'pdf'] as const).map((fmt) => (
            <a
              key={fmt}
              href={resultsApi.exportUrl(scan.id, fmt)}
              target="_blank"
              rel="noopener noreferrer"
              id={`btn-export-${fmt}`}
              className="rounded-md border border-white/[0.08] px-3 py-1 text-xs font-medium text-text-secondary hover:border-white/20 hover:text-text-primary transition-colors"
            >
              {fmt.toUpperCase()}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</p>
      <div className="mt-1">{value}</div>
    </div>
  );
}

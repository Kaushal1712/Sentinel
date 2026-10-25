/**
 * RecentScansTable — shows the last 10 scans from GET /api/dashboard/stats.
 *
 * Data source: DashboardResponse.recent_scans (Scan.to_dict() array)
 * Columns: Target, Mode, Status, Risk, Platforms, Date
 * Each row links to /results/:id (route added in Phase 3D).
 */

import { Link } from 'react-router-dom';
import { ScanStatusBadge, ScanModeBadge, RiskBadge } from '@/components/shared/Badge';
import { EmptyState } from '@/components/shared/EmptyState';
import type { Scan } from '@/types';

interface RecentScansTableProps {
  scans: Scan[];
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function RecentScansTable({ scans }: RecentScansTableProps) {
  if (scans.length === 0) {
    return (
      <EmptyState
        title="No scans yet"
        description="Start a new scan to see results here."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm" aria-label="Recent scans">
        <thead>
          <tr className="border-b border-white/[0.06]">
            {['Target', 'Mode', 'Status', 'Risk', 'Profiles', 'Started'].map((h) => (
              <th
                key={h}
                scope="col"
                className="pb-3 pr-4 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {scans.map((scan) => (
            <tr
              key={scan.id}
              className="group transition-colors hover:bg-white/[0.025]"
            >
              {/* Target */}
              <td className="py-3 pr-4">
                <Link
                  to={`/results/${scan.id}`}
                  className="font-medium text-text-primary group-hover:text-accent-blue transition-colors"
                >
                  {scan.target_name}
                </Link>
                {scan.target_username && (
                  <p className="text-xs text-text-tertiary">@{scan.target_username}</p>
                )}
              </td>

              {/* Mode */}
              <td className="py-3 pr-4">
                <ScanModeBadge mode={scan.mode} />
              </td>

              {/* Status */}
              <td className="py-3 pr-4">
                <ScanStatusBadge status={scan.status} />
              </td>

              {/* Risk */}
              <td className="py-3 pr-4">
                <RiskBadge score={scan.risk_score} />
              </td>

              {/* Profiles found */}
              <td className="py-3 pr-4 tabular-nums text-text-secondary">
                {scan.platforms_found}
              </td>

              {/* Date */}
              <td className="py-3 text-text-tertiary">
                {formatDate(scan.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

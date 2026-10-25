/**
 * FindingCard — renders a single ScanResult (discovered profile/page).
 *
 * Data from ScanResult.to_dict() — all fields confirmed from database.py.
 * Displays:
 *   - Platform name + risk badge
 *   - Username, display name, bio
 *   - Match score (as percentage)
 *   - Match reasons (collapsible)
 *   - Activity status (from last_seen_at)
 *   - Emails and phones found on the page (entity tags)
 *   - Category badge
 *   - Evidence indicator (evidence_available / evidence_filename)
 *   - External URL link (opens in new tab)
 */

import { useState } from 'react';
import { Badge } from '@/components/shared/Badge';
import type { ScanResult, RiskLevel } from '@/types';

interface FindingCardProps {
  result: ScanResult;
  index: number;
}

function getMatchColor(score: number): string {
  if (score >= 0.9) return 'text-accent-green';
  if (score >= 0.7) return 'text-accent-blue';
  if (score >= 0.5) return 'text-accent-amber';
  return 'text-text-tertiary';
}

function getActivityLabel(lastSeenAt: string | null): string | null {
  if (!lastSeenAt) return null;
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 7) return '● Active recently';
  if (days < 90) return '◌ Active ~' + Math.round(days / 7) + 'w ago';
  return '○ Historical';
}

const riskLevelVariants: Record<RiskLevel, string> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export function FindingCard({ result, index }: FindingCardProps) {
  const [showReasons, setShowReasons] = useState(false);

  const scorePct = result.match_score !== null
    ? Math.round(result.match_score * 100)
    : null;
  const activityLabel = getActivityLabel(result.last_seen_at);

  const categoryLabel: Record<string, string> = {
    social: 'Social',
    dev: 'Developer',
    developer: 'Developer',
    professional: 'Professional',
    forum: 'Forum',
    other: 'Other',
  };

  return (
    <div
      className="group rounded-lg border border-white/[0.07] bg-bg-card p-4 transition-all hover:border-white/[0.14]"
      style={{ animationDelay: `${index * 0.03}s` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-text-primary">
            {result.platform}
          </span>
          <Badge variant={riskLevelVariants[result.risk_level] as RiskLevel}>
            {result.risk_level}
          </Badge>
          <Badge variant="default">
            {categoryLabel[result.category] ?? result.category}
          </Badge>
        </div>
        {result.evidence_available && (
          <span
            title={result.evidence_filename ?? 'Evidence archived'}
            className="flex-shrink-0 text-[10px] font-medium text-accent-purple"
          >
            📁 Archived
          </span>
        )}
      </div>

      {/* Identity */}
      {result.username && (
        <p className="mt-1.5 text-sm font-medium text-accent-blue">
          @{result.username}
        </p>
      )}
      {result.display_name && (
        <p className="text-xs text-text-secondary">{result.display_name}</p>
      )}
      {result.bio && (
        <p className="mt-1.5 text-xs leading-relaxed text-text-tertiary">
          {result.bio.length > 140 ? result.bio.slice(0, 140) + '…' : result.bio}
        </p>
      )}

      {/* Meta pills */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {scorePct !== null && (
          <span className={`text-[11px] font-semibold ${getMatchColor(result.match_score ?? 0)}`}>
            Match {scorePct}%
          </span>
        )}
        {activityLabel && (
          <span className="text-[11px] text-text-tertiary">{activityLabel}</span>
        )}
        {result.last_seen_at && (
          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-text-tertiary">
            Seen {new Date(result.last_seen_at).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>

      {/* Match reasons — collapsible */}
      {result.match_reasons.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowReasons((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" aria-hidden="true"
              className={`transition-transform ${showReasons ? 'rotate-90' : ''}`}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            {result.match_reasons.length} match signal{result.match_reasons.length > 1 ? 's' : ''}
          </button>
          {showReasons && (
            <ul className="mt-1.5 space-y-0.5 pl-4 text-[11px] text-text-secondary list-disc">
              {result.match_reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Entity tags — emails and phones */}
      {(result.emails_found.length > 0 || result.phones_found.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {result.emails_found.map((e) => (
            <span key={e} className="rounded-full bg-accent-blue/10 px-2 py-0.5 text-[10px] font-medium text-accent-blue">
              ✉ {e}
            </span>
          ))}
          {result.phones_found.map((p) => (
            <span key={p} className="rounded-full bg-accent-amber/10 px-2 py-0.5 text-[10px] font-medium text-accent-amber">
              ☎ {p}
            </span>
          ))}
        </div>
      )}

      {/* URL */}
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 block truncate text-[11px] text-text-tertiary hover:text-accent-blue transition-colors"
      >
        {result.url}
      </a>
    </div>
  );
}

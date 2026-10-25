/**
 * RiskSummary — renders the AI-generated risk report from
 * GET /api/results/:id/report.
 *
 * Sections:
 *   - Summary paragraph (report.summary)
 *   - Findings list (report.findings — sorted by severity from backend)
 *   - Recommendations (report.recommendations)
 *
 * All data comes from RiskReport shape confirmed from core/reporter.py.
 * No risk recalculation is done on the frontend.
 */

import { useState } from 'react';
import { Badge } from '@/components/shared/Badge';
import type { RiskReport, ReportFinding, FindingSeverity } from '@/types';

interface RiskSummaryProps {
  report: RiskReport;
}

const severityVariants: Record<FindingSeverity, string> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

const severityIcons: Record<FindingSeverity, string> = {
  critical: '⛔',
  high: '🔴',
  medium: '🟡',
  low: '🟢',
};

function FindingRow({ finding }: { finding: ReportFinding }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-base leading-none">
            {severityIcons[finding.severity]}
          </span>
          <div>
            <p className="text-sm font-semibold text-text-primary">{finding.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-tertiary">
              {finding.description}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={severityVariants[finding.severity] as FindingSeverity}>
            {finding.severity}
          </Badge>
          <span className="text-[10px] text-text-tertiary">
            ×{finding.occurrences}
          </span>
        </div>
      </div>

      {/* Recommendation */}
      {finding.recommendation && (
        <div className="mt-3 rounded-md bg-accent-blue/[0.07] px-3 py-2 text-xs text-text-secondary">
          💡 {finding.recommendation}
        </div>
      )}

      {/* Example details — collapsible */}
      {finding.details.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" aria-hidden="true"
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            {finding.details.length} example{finding.details.length > 1 ? 's' : ''}
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1 pl-4 text-[11px] text-text-tertiary list-disc">
              {finding.details.map((d, i) => (
                <li key={i}>
                  <span className="font-medium text-text-secondary">{d.detail}</span>
                  {d.source && (
                    <span className="ml-1 text-text-tertiary/70">via {d.source}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function RiskSummary({ report }: RiskSummaryProps) {
  const criticalCount = report.findings.filter((f) => f.severity === 'critical').length;
  const highCount = report.findings.filter((f) => f.severity === 'high').length;

  const riskBg =
    report.risk_level === 'critical' ? 'border-risk-critical/30 bg-risk-critical/[0.06]' :
    report.risk_level === 'high'     ? 'border-risk-high/30 bg-risk-high/[0.06]' :
    report.risk_level === 'medium'   ? 'border-risk-medium/30 bg-risk-medium/[0.06]' :
    'border-risk-low/30 bg-risk-low/[0.06]';

  const riskText =
    report.risk_level === 'critical' ? 'text-risk-critical' :
    report.risk_level === 'high'     ? 'text-risk-high' :
    report.risk_level === 'medium'   ? 'text-risk-medium' :
    'text-risk-low';

  return (
    <div className="space-y-5">
      {/* Risk score hero */}
      <div className={`rounded-xl border p-5 ${riskBg}`}>
        <div className="flex items-center gap-5">
          <div className="text-center">
            <p className={`text-5xl font-black tabular-nums ${riskText}`}>
              {report.risk_score.toFixed(1)}
            </p>
            <p className="mt-0.5 text-xs text-text-tertiary">/ 10</p>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Badge variant={report.risk_level as FindingSeverity}>
                {report.risk_level.toUpperCase()} RISK
              </Badge>
              {criticalCount > 0 && (
                <span className="text-xs font-semibold text-risk-critical">
                  ⛔ {criticalCount} critical
                </span>
              )}
              {highCount > 0 && (
                <span className="text-xs font-semibold text-risk-high">
                  🔴 {highCount} high
                </span>
              )}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              {report.summary}
            </p>
          </div>
        </div>
      </div>

      {/* Findings */}
      {report.findings.length > 0 && (
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Findings ({report.findings.length})
          </h4>
          <div className="space-y-3">
            {report.findings.map((finding, i) => (
              <FindingRow key={i} finding={finding} />
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Recommendations
          </h4>
          <div className="space-y-2">
            {report.recommendations.map((rec, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg bg-white/[0.03] border border-white/[0.06] px-4 py-3"
              >
                <Badge variant={rec.priority as FindingSeverity} className="mt-0.5 shrink-0">
                  {rec.priority}
                </Badge>
                <div>
                  <p className="text-xs font-medium text-text-primary">{rec.action}</p>
                  <p className="mt-0.5 text-[11px] text-text-tertiary">
                    Re: {rec.related_finding}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

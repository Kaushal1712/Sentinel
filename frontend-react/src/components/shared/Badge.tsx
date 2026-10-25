/**
 * Badge — inline status/label chip used across the application.
 *
 * Variants map directly to backend status/mode/risk values:
 *   scan status:  pending | running | completed | failed
 *   scan mode:    quick | full
 *   risk:         low | medium | high | critical
 *   generic:      default | info | success | warning | danger
 */

type BadgeVariant =
  // Scan status
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  // Scan mode
  | 'quick'
  | 'full'
  // Risk
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  // Generic
  | 'default'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  // Scan statuses
  pending:   'bg-text-tertiary/15 text-text-tertiary',
  running:   'bg-accent-blue/15 text-accent-blue',
  completed: 'bg-accent-green/15 text-accent-green',
  failed:    'bg-accent-red/15 text-accent-red',
  // Modes
  quick:     'bg-accent-cyan/15 text-accent-cyan',
  full:      'bg-accent-purple/15 text-accent-purple',
  // Risk levels
  low:       'bg-risk-low/15 text-risk-low',
  medium:    'bg-risk-medium/15 text-risk-medium',
  high:      'bg-risk-high/15 text-risk-high',
  critical:  'bg-risk-critical/15 text-risk-critical',
  // Generic
  default:   'bg-white/10 text-text-secondary',
  info:      'bg-accent-blue/15 text-accent-blue',
  success:   'bg-accent-green/15 text-accent-green',
  warning:   'bg-accent-amber/15 text-accent-amber',
  danger:    'bg-accent-red/15 text-accent-red',
};

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5',
        'text-[11px] font-semibold uppercase tracking-wide',
        variantClasses[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

// ── Convenience helpers ───────────────────────────────────────────────────────

import type { ScanStatus, ScanMode, RiskLevel } from '@/types';

export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  const labels: Record<ScanStatus, string> = {
    pending:   'Pending',
    running:   'Running',
    completed: 'Done',
    failed:    'Failed',
  };
  return <Badge variant={status}>{labels[status] ?? status}</Badge>;
}

export function ScanModeBadge({ mode }: { mode: ScanMode }) {
  return <Badge variant={mode}>{mode}</Badge>;
}

export function RiskBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-text-tertiary">—</span>;

  let level: RiskLevel;
  if (score >= 8)      level = 'critical';
  else if (score >= 6) level = 'high';
  else if (score >= 3) level = 'medium';
  else                 level = 'low';

  return (
    <Badge variant={level}>
      {score.toFixed(1)}
    </Badge>
  );
}

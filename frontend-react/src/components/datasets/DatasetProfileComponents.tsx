/**
 * DatasetSchema — shows column profiles from DatasetDetail.columns[].
 *
 * For each column shows: name, dtype badge, missing %, unique count,
 * numeric stats (min/max/mean/std), top categorical values.
 *
 * Data from _generate_column_summary() in dataset.py — no frontend calculation.
 */

import { Badge } from '@/components/shared/Badge';
import type { DatasetColumnInfo } from '@/types';

const DTYPE_COLORS: Record<string, string> = {
  integer:     'text-accent-blue',
  float:       'text-accent-blue',
  boolean:     'text-accent-amber',
  datetime:    'text-accent-purple',
  categorical: 'text-accent-green',
  text:        'text-text-secondary',
};

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined) return '—';
  return Number(v).toFixed(decimals);
}

function MissingBar({ pct }: { pct: number }) {
  if (pct <= 0) return <span className="text-accent-green text-[10px]">None</span>;
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${pct > 10 ? 'bg-accent-red' : 'bg-accent-amber'}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-[10px] text-text-tertiary">{pct}%</span>
    </div>
  );
}

interface DatasetSchemaProps {
  columns: DatasetColumnInfo[];
}

export function DatasetSchema({ columns }: DatasetSchemaProps) {
  if (columns.length === 0) {
    return <p className="text-sm text-text-tertiary">No column information available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.07] text-left">
            <th className="pb-2 pr-4 font-medium text-text-tertiary">Column</th>
            <th className="pb-2 pr-4 font-medium text-text-tertiary">Type</th>
            <th className="pb-2 pr-4 font-medium text-text-tertiary">Missing</th>
            <th className="pb-2 pr-4 font-medium text-text-tertiary">Unique</th>
            <th className="pb-2 pr-4 font-medium text-text-tertiary">Stats / Values</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {columns.map((col) => (
            <tr key={col.name} className="hover:bg-white/[0.02]">
              <td className="py-2 pr-4 font-mono text-[11px] text-text-primary max-w-[150px] truncate" title={col.name}>
                {col.name}
              </td>
              <td className="py-2 pr-4">
                <span className={`font-medium capitalize ${DTYPE_COLORS[col.dtype] ?? 'text-text-secondary'}`}>
                  {col.dtype}
                </span>
              </td>
              <td className="py-2 pr-4">
                <MissingBar pct={col.missing_pct} />
              </td>
              <td className="py-2 pr-4 tabular-nums text-text-secondary">
                {col.unique_count.toLocaleString()}
              </td>
              <td className="py-2 pr-4 text-text-tertiary">
                {col.dtype === 'integer' || col.dtype === 'float' ? (
                  <span>
                    min {fmt(col.min)} · max {fmt(col.max)} · mean {fmt(col.mean)} · σ {fmt(col.std)}
                  </span>
                ) : col.dtype === 'categorical' && col.top_values ? (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(col.top_values).slice(0, 5).map(([k, v]) => (
                      <span key={k} className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px]">
                        {k} ({v})
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-text-tertiary/60">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DatasetInsightsListProps {
  insights: import('@/types').DatasetInsight[];
}

const IMPORTANCE_VARIANT: Record<string, string> = {
  high: 'critical',
  medium: 'medium',
  low: 'low',
};

export function DatasetInsightsList({ insights }: DatasetInsightsListProps) {
  if (insights.length === 0) {
    return <p className="text-sm text-text-tertiary">No automated insights found for this dataset.</p>;
  }

  return (
    <div className="space-y-3">
      {insights.map((insight, i) => (
        <div
          key={i}
          className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-text-primary">{insight.title}</p>
            <Badge variant={IMPORTANCE_VARIANT[insight.importance] as 'critical' | 'medium' | 'low'}>
              {insight.importance}
            </Badge>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-text-tertiary">
            {insight.description}
          </p>
          {insight.relatedColumns.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {insight.relatedColumns.map((col) => (
                <span key={col} className="rounded-full bg-accent-blue/10 px-2 py-0.5 text-[10px] font-mono text-accent-blue">
                  {col}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

interface CorrelationTableProps {
  correlations: import('@/types').CorrelationPair[];
}

export function CorrelationTable({ correlations }: CorrelationTableProps) {
  if (correlations.length === 0) {
    return <p className="text-sm text-text-tertiary">No significant correlations found (|r| &gt; 0.3 threshold).</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/[0.07] text-left">
            <th className="pb-2 pr-4 font-medium text-text-tertiary">Column A</th>
            <th className="pb-2 pr-4 font-medium text-text-tertiary">Column B</th>
            <th className="pb-2 pr-4 font-medium text-text-tertiary">Correlation (r)</th>
            <th className="pb-2 font-medium text-text-tertiary">Strength</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {correlations.map((corr, i) => {
            const abs = Math.abs(corr.value);
            const direction = corr.value > 0 ? 'positive' : 'negative';
            const strength = abs >= 0.7 ? 'strong' : 'moderate';
            const color = abs >= 0.7
              ? (corr.value > 0 ? 'text-accent-blue' : 'text-accent-red')
              : 'text-accent-amber';
            return (
              <tr key={i} className="hover:bg-white/[0.02]">
                <td className="py-2 pr-4 font-mono text-text-secondary">{corr.col1}</td>
                <td className="py-2 pr-4 font-mono text-text-secondary">{corr.col2}</td>
                <td className={`py-2 pr-4 tabular-nums font-semibold ${color}`}>
                  {corr.value > 0 ? '+' : ''}{corr.value.toFixed(3)}
                </td>
                <td className="py-2 text-text-tertiary capitalize">
                  {strength} {direction}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

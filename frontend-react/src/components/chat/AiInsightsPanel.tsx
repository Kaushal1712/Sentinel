/**
 * AiInsightsPanel — generates and displays AI-powered insights.
 *
 * Uses POST /api/insights/:id/generate.
 * Requires an OpenAI API key configured server-side.
 * Backend returns 503 when key is absent — handled gracefully.
 *
 * AI insights are visually differentiated from rule-based insights
 * (gold ✦ badge vs grey indicator in the rule-based DatasetInsightsList).
 *
 * Rate limit: 10/hour (enforced server-side).
 * No AI SDK added to the frontend — OpenAI communication is backend-only.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/shared/Button';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { aiInsightsApi } from '@/api/chat';
import { isApiError } from '@/api/client';
import type { DatasetInsight } from '@/types';

const IMPORTANCE_COLORS: Record<string, string> = {
  high:   'bg-accent-red/10 border-accent-red/20',
  medium: 'bg-accent-amber/10 border-accent-amber/20',
  low:    'bg-white/[0.04] border-white/[0.08]',
};

const IMPORTANCE_TEXT: Record<string, string> = {
  high:   'text-accent-red',
  medium: 'text-accent-amber',
  low:    'text-text-tertiary',
};

const TYPE_ICONS: Record<string, string> = {
  trend:        '📈',
  outlier:      '⚠️',
  correlation:  '🔗',
  distribution: '📊',
  comparison:   '⚖️',
  summary:      '📋',
};

interface AiInsightCardProps {
  insight: DatasetInsight;
  index: number;
}

function AiInsightCard({ insight, index }: AiInsightCardProps) {
  const borderColor = IMPORTANCE_COLORS[insight.importance] ?? IMPORTANCE_COLORS.low;
  const textColor = IMPORTANCE_TEXT[insight.importance] ?? IMPORTANCE_TEXT.low;
  const icon = TYPE_ICONS[insight.type] ?? '✦';

  return (
    <div
      className={`rounded-xl border p-4 ${borderColor}`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-base" aria-hidden="true">{icon}</span>
          <p className="text-sm font-semibold text-text-primary leading-snug">{insight.title}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${textColor}`}>
            {insight.importance}
          </span>
          <span className="text-[10px] text-accent-amber font-semibold uppercase tracking-wider">AI</span>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-text-tertiary">{insight.description}</p>
      {insight.relatedColumns.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {insight.relatedColumns.map((col) => (
            <span key={col} className="rounded-full bg-accent-amber/10 px-2 py-0.5 text-[10px] font-mono text-accent-amber">
              {col}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface AiInsightsPanelProps {
  datasetId: number;
  datasetName: string;
}

export function AiInsightsPanel({ datasetId, datasetName }: AiInsightsPanelProps) {
  const [insights, setInsights] = useState<DatasetInsight[] | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => aiInsightsApi.generateInsights(datasetId),
    onSuccess: (data) => {
      setInsights(data.insights);
    },
  });

  const errorMsg = generateMutation.isError
    ? (() => {
        const e = generateMutation.error;
        if (isApiError(e)) {
          if (e.status === 503) return 'AI features require an OpenAI API key configured on the server.';
          if (e.status === 429) return 'Rate limit reached (10/hour). Please try again later.';
          return e.error ?? 'Failed to generate insights.';
        }
        return 'Failed to generate insights. Please try again.';
      })()
    : null;

  return (
    <div className="space-y-4">
      {/* Header + action */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            AI-Powered Insights
            <span className="rounded-full border border-accent-amber/30 bg-accent-amber/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-amber">
              AI
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary">
            OpenAI analyses your dataset and surfaces 5–8 key findings.
          </p>
        </div>
        <Button
          id={`btn-generate-ai-insights-${datasetId}`}
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          variant="secondary"
          size="sm"
        >
          {generateMutation.isPending ? (
            <span className="flex items-center gap-2">
              <LoadingSpinner size="sm" /> Generating…
            </span>
          ) : insights ? 'Regenerate' : 'Generate AI Insights'}
        </Button>
      </div>

      {/* Error */}
      {errorMsg && (
        <div role="alert" className="rounded-md border border-accent-red/25 bg-accent-red/[0.07] px-3 py-2 text-xs text-accent-red">
          {errorMsg}
        </div>
      )}

      {/* Initial state */}
      {!insights && !generateMutation.isPending && !generateMutation.isError && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.10] py-10 text-center">
          <span className="text-3xl mb-3" aria-hidden="true">✦</span>
          <p className="text-sm font-medium text-text-secondary">No AI insights generated yet</p>
          <p className="mt-1 text-xs text-text-tertiary max-w-xs">
            Click "Generate AI Insights" to let the AI analyse {datasetName} and surface actionable findings.
          </p>
        </div>
      )}

      {/* Loading state */}
      {generateMutation.isPending && (
        <div className="flex items-center justify-center gap-3 py-10">
          <LoadingSpinner />
          <span className="text-sm text-text-tertiary">Analysing dataset with AI…</span>
        </div>
      )}

      {/* Results */}
      {insights && insights.length === 0 && (
        <p className="text-sm text-text-tertiary py-4 text-center">
          No insights generated. Try again or check that the dataset has meaningful data.
        </p>
      )}

      {insights && insights.length > 0 && (
        <div className="space-y-3">
          {insights.map((insight, i) => (
            <AiInsightCard key={i} insight={insight} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

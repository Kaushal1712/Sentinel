/**
 * DatasetInsightsPage — /datasets/:id/insights
 *
 * Shows both:
 *   - Rule-based insights (GET /api/insights/:id/summary) — no AI key needed
 *   - AI-generated insights (POST /api/insights/:id/generate) — requires OpenAI key
 *
 * Fetches rule-based insights immediately on mount.
 * AI insights are generated only when the user clicks "Generate AI Insights".
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { Badge } from '@/components/shared/Badge';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { DatasetInsightsList, CorrelationTable } from '@/components/datasets/DatasetProfileComponents';
import { AiInsightsPanel } from '@/components/chat/AiInsightsPanel';
import { datasetsApi } from '@/api/datasets';
import { isApiError } from '@/api/client';

export function DatasetInsightsPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);

  // Dataset context (name/status)
  const { data: datasetData, isLoading: datasetLoading, isError: datasetError, error: datasetErr } = useQuery({
    queryKey: ['dataset', id] as const,
    queryFn: () => datasetsApi.get(id),
    enabled: !isNaN(id) && id > 0,
    staleTime: 60_000,
    retry: (count, err) => {
      const e = err as { status?: number } | null;
      if (e?.status === 404 || e?.status === 403) return false;
      return count < 2;
    },
  });

  // Rule-based insights (no AI required)
  const { data: summaryData, isLoading: summaryLoading, isError: summaryError, refetch } = useQuery({
    queryKey: ['dataset-insights', id] as const,
    queryFn: () => datasetsApi.getSummary(id),
    enabled: !isNaN(id) && id > 0 && !!datasetData,
    staleTime: 60_000,
  });

  if (isNaN(id) || id <= 0) {
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center p-6">
          <Card className="max-w-sm text-center">
            <p className="text-sm text-text-tertiary">Invalid dataset ID.</p>
            <Link to="/datasets">
              <Button variant="secondary" size="sm" id="btn-insights-back-invalid" className="mt-4">← Datasets</Button>
            </Link>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (datasetLoading || summaryLoading) {
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  if (datasetError) {
    const is404 = isApiError(datasetErr) && datasetErr.status === 404;
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center p-6">
          <Card className="max-w-md text-center">
            <p className="text-base font-semibold text-text-primary">
              {is404 ? 'Dataset not found' : 'Failed to load dataset'}
            </p>
            <Link to="/datasets">
              <Button size="sm" id="btn-insights-back-error" className="mt-4">← Datasets</Button>
            </Link>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const ds = datasetData!.dataset;

  return (
    <AppLayout>
      <div className="page-enter min-h-full space-y-5 p-6">
        {/* Breadcrumb */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <nav className="flex items-center gap-2 text-sm" aria-label="Breadcrumb">
            <Link to="/datasets" className="text-text-tertiary hover:text-text-secondary transition-colors">Datasets</Link>
            <span className="text-text-tertiary">/</span>
            <Link to={`/datasets/${id}`} className="text-text-tertiary hover:text-text-secondary transition-colors">{ds.name}</Link>
            <span className="text-text-tertiary">/</span>
            <span className="text-text-primary font-medium">Insights</span>
          </nav>
          <div className="flex gap-2">
            <Link to={`/datasets/${id}`}>
              <Button variant="secondary" size="sm" id="btn-insights-to-detail">← Dataset Detail</Button>
            </Link>
            <Link to={`/datasets/${id}/chat`}>
              <Button variant="secondary" size="sm" id="btn-insights-to-chat">💬 Chat</Button>
            </Link>
          </div>
        </div>

        {/* Rule-based insights */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2">
              Automated Insights
              <Badge variant="default">Rule-based</Badge>
            </h2>
          </div>
          {summaryError ? (
            <ErrorState title="Failed to load insights" onRetry={() => void refetch()} />
          ) : summaryData ? (
            <DatasetInsightsList insights={summaryData.insights} />
          ) : (
            <div className="flex items-center gap-2 py-4">
              <LoadingSpinner size="sm" />
              <span className="text-sm text-text-tertiary">Loading…</span>
            </div>
          )}
        </Card>

        {/* Correlations */}
        {summaryData?.summary.top_correlations && summaryData.summary.top_correlations.length > 0 && (
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-text-primary">
              Top Correlations <span className="font-normal text-text-tertiary">(|r| &gt; 0.3)</span>
            </h2>
            <CorrelationTable correlations={summaryData.summary.top_correlations} />
          </Card>
        )}

        {/* AI Insights panel */}
        <Card>
          <AiInsightsPanel datasetId={id} datasetName={ds.name} />
        </Card>
      </div>
    </AppLayout>
  );
}

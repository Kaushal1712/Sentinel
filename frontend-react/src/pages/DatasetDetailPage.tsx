/**
 * DatasetDetailPage — /datasets/:id
 *
 * Tabs: Overview | Schema | Preview | Insights
 *
 * Data sources:
 *   - GET /api/dataset/:id       → dataset meta + columns[] + summary{}
 *   - GET /api/insights/:id/summary → rule-based insights + correlations
 *   - GET /api/dataset/:id/data  → paginated row preview (lazy, on tab switch)
 *
 * Ownership enforced server-side (user_id filter).
 * data_json never loaded wholesale — preview uses pagination.
 */

import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { DatasetSchema, DatasetInsightsList, CorrelationTable } from '@/components/datasets/DatasetProfileComponents';
import { DatasetDataPreview } from '@/components/datasets/DatasetDataPreview';
import { DeleteConfirmDialog } from '@/components/datasets/DeleteConfirmDialog';
import { datasetsApi } from '@/api/datasets';
import { isApiError } from '@/api/client';

type Tab = 'overview' | 'schema' | 'preview' | 'insights';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'schema',   label: 'Schema' },
  { id: 'preview',  label: 'Data Preview' },
  { id: 'insights', label: 'Insights' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function DatasetDetailPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const id = Number(idParam);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [showDelete, setShowDelete] = useState(false);

  // Dataset detail (meta + columns + summary)
  const {
    data: detailData, isLoading: detailLoading,
    isError: detailError, error: detailErr,
  } = useQuery({
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

  // Rule-based insights (no AI, no OpenAI key needed)
  const {
    data: summaryData, isLoading: summaryLoading,
    isError: summaryError,
  } = useQuery({
    queryKey: ['dataset-insights', id] as const,
    queryFn: () => datasetsApi.getSummary(id),
    enabled: !isNaN(id) && id > 0 && activeTab === 'insights',
    staleTime: 60_000,
  });

  if (isNaN(id) || id <= 0) {
    return (
      <AppLayout>
        <div className="flex min-h-full items-center justify-center p-6">
          <Card className="max-w-sm text-center">
            <p className="text-sm text-text-tertiary">Invalid dataset ID.</p>
            <Link to="/datasets" className="mt-4 inline-block">
              <Button variant="secondary" size="sm" id="btn-back-invalid">← Datasets</Button>
            </Link>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (detailLoading) {
    return (
      <AppLayout>
        <div className="flex min-h-full items-center justify-center p-6">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  if (detailError) {
    const is404 = isApiError(detailErr) && detailErr.status === 404;
    return (
      <AppLayout>
        <div className="flex min-h-full items-center justify-center p-6">
          <Card className="max-w-md text-center">
            <p className="text-base font-semibold text-text-primary">
              {is404 ? 'Dataset not found' : 'Failed to load dataset'}
            </p>
            <p className="mt-1 text-sm text-text-tertiary">
              {is404 ? "This dataset doesn't exist or you don't have access." : 'Check your connection and try again.'}
            </p>
            <Link to="/datasets" className="mt-5 inline-block">
              <Button size="sm" id="btn-back-error">← Datasets</Button>
            </Link>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const ds = detailData!.dataset;
  const summary = ds.summary ?? {};
  const isReady = ds.upload_status === 'ready';

  return (
    <AppLayout>
      <div className="page-enter min-h-full space-y-5 p-6">

        {/* ── Breadcrumb + actions ─────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="flex items-center gap-2 text-sm" aria-label="Breadcrumb">
            <Link to="/datasets" className="text-text-tertiary hover:text-text-secondary transition-colors">
              Datasets
            </Link>
            <span className="text-text-tertiary">/</span>
            <span className="text-text-primary font-medium">{ds.name}</span>
          </nav>

          <div className="flex flex-wrap gap-2">
            <Link to="/datasets">
              <Button variant="secondary" size="sm" id="btn-back-to-datasets">← Back</Button>
            </Link>
            {ds.upload_status === 'ready' && (
              <>
                <Link to={`/datasets/${id}/chat`}>
                  <Button variant="secondary" size="sm" id="btn-detail-to-chat">💬 Chat</Button>
                </Link>
                <Link to={`/datasets/${id}/insights`}>
                  <Button variant="secondary" size="sm" id="btn-detail-to-insights">✦ AI Insights</Button>
                </Link>
              </>
            )}
            <Button
              variant="danger"
              size="sm"
              id="btn-delete-dataset-detail"
              onClick={() => setShowDelete(true)}
            >
              Delete
            </Button>
          </div>
        </div>

        {/* ── Dataset header card ──────────────────────────────── */}
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-blue/10 text-accent-blue">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-text-primary">{ds.name}</h1>
                <p className="text-xs text-text-tertiary">{ds.original_filename}</p>
                {ds.description && (
                  <p className="mt-1.5 text-sm text-text-secondary max-w-prose leading-relaxed">
                    {ds.description}
                  </p>
                )}
              </div>
            </div>
            <Badge variant={isReady ? 'low' : 'medium'}>{ds.upload_status}</Badge>
          </div>

          {/* Quick stats */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Rows', value: ds.row_count.toLocaleString() },
              { label: 'Columns', value: String(ds.column_count) },
              { label: 'Size', value: formatBytes(ds.file_size_bytes) },
              { label: 'Uploaded', value: formatDate(ds.created_at) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</p>
                <p className="mt-0.5 text-sm font-semibold text-text-primary tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Tab bar ──────────────────────────────────────────── */}
        <div role="tablist" className="flex gap-1 rounded-lg border border-white/[0.07] bg-white/[0.03] p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              id={`dataset-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'flex-1 rounded-md px-3 py-2 text-center text-xs font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'text-text-tertiary hover:text-text-secondary',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ──────────────────────────────────────── */}

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Summary stats */}
            {[
              { label: 'Total Rows', value: summary.total_rows?.toLocaleString() ?? '—' },
              { label: 'Total Columns', value: summary.total_columns ?? '—' },
              { label: 'Missing Values', value: summary.total_missing?.toLocaleString() ?? '0' },
              { label: 'Duplicate Rows', value: summary.total_duplicates?.toLocaleString() ?? '0' },
              { label: 'Numeric Columns', value: summary.numeric_columns ?? '—' },
              { label: 'Categorical Columns', value: summary.categorical_columns ?? '—' },
              {
                label: 'Memory Usage',
                value: summary.memory_usage_bytes != null
                  ? formatBytes(summary.memory_usage_bytes)
                  : '—',
              },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-white/[0.07] bg-bg-card px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-text-primary">{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Schema */}
        {activeTab === 'schema' && (
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-text-primary">
              Column Schema <span className="text-text-tertiary font-normal">({ds.columns.length} columns)</span>
            </h2>
            <DatasetSchema columns={ds.columns} />
          </Card>
        )}

        {/* Preview */}
        {activeTab === 'preview' && (
          <Card>
            <h2 className="mb-4 text-sm font-semibold text-text-primary">Data Preview</h2>
            {isReady ? (
              <DatasetDataPreview datasetId={id} />
            ) : (
              <p className="text-sm text-text-tertiary">Dataset is still processing.</p>
            )}
          </Card>
        )}

        {/* Insights */}
        {activeTab === 'insights' && (
          <div className="space-y-4">
            {summaryLoading && (
              <Card>
                <div className="flex items-center gap-3 py-8">
                  <LoadingSpinner />
                  <span className="text-xs text-text-tertiary">Loading insights…</span>
                </div>
              </Card>
            )}
            {summaryError && (
              <Card>
                <ErrorState title="Failed to load insights" />
              </Card>
            )}
            {summaryData && (
              <>
                {/* Rule-based insights */}
                <Card>
                  <h2 className="mb-4 text-sm font-semibold text-text-primary">
                    Automated Insights
                  </h2>
                  <DatasetInsightsList insights={summaryData.insights} />
                </Card>

                {/* Correlations */}
                {summaryData.summary.top_correlations && summaryData.summary.top_correlations.length > 0 && (
                  <Card>
                    <h2 className="mb-4 text-sm font-semibold text-text-primary">
                      Top Correlations <span className="text-text-tertiary font-normal">(|r| &gt; 0.3)</span>
                    </h2>
                    <CorrelationTable correlations={summaryData.summary.top_correlations} />
                  </Card>
                )}
              </>
            )}
          </div>
        )}

      </div>

      {/* ── Delete dialog ────────────────────────────────────── */}
      {showDelete && (
        <DeleteConfirmDialog
          datasetId={id}
          datasetName={ds.name}
          onClose={() => setShowDelete(false)}
          onDeleted={() => navigate('/datasets')}
        />
      )}
    </AppLayout>
  );
}

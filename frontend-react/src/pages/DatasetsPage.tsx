/**
 * DatasetsPage — /datasets
 *
 * Dataset list + upload panel.
 * Data: GET /api/dataset/list → { datasets[], total }
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { DatasetCard } from '@/components/datasets/DatasetCard';
import { DatasetUploadForm } from '@/components/datasets/DatasetUploadForm';
import { DeleteConfirmDialog } from '@/components/datasets/DeleteConfirmDialog';
import { datasetsApi } from '@/api/datasets';

interface PendingDelete {
  id: number;
  name: string;
}

export function DatasetsPage() {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['datasets'] as const,
    queryFn: () => datasetsApi.list(),
    staleTime: 30_000,
    retry: 2,
  });

  function handleDelete(id: number, name: string) {
    setPendingDelete({ id, name });
    setUploadSuccess(false);
  }

  function handleUploadSuccess() {
    setUploadSuccess(true);
    void refetch();
  }

  return (
    <AppLayout>
      <div className="page-enter min-h-full space-y-6 p-6">
        {/* ── Page header ───────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold text-text-primary">Dataset Studio</h1>
          <p className="mt-1 text-sm text-text-tertiary">
            Upload and explore datasets. Chat and AI insights available in the Dataset Workspace.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* ── Dataset list ─────────────────────────────────────── */}
          <div className="space-y-4 lg:col-span-2">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text-secondary">
                {data ? `${data.total} dataset${data.total !== 1 ? 's' : ''}` : 'Your Datasets'}
              </p>
            </div>

            {isLoading && (
              <div className="flex items-center justify-center py-20">
                <LoadingSpinner size="lg" />
              </div>
            )}

            {isError && (
              <Card>
                <ErrorState
                  title="Failed to load datasets"
                  error={error}
                  onRetry={() => void refetch()}
                />
              </Card>
            )}

            {!isLoading && !isError && data?.datasets.length === 0 && (
              <EmptyState
                title="No datasets yet"
                description="Upload a CSV, XLSX, or XLS file to get started."
              />
            )}

            {!isLoading && !isError && data && data.datasets.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {data.datasets.map((ds) => (
                  <DatasetCard
                    key={ds.id}
                    dataset={ds}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Upload panel ─────────────────────────────────────── */}
          <div className="space-y-4">
            <DatasetUploadForm onSuccess={handleUploadSuccess} />
            {uploadSuccess && (
              <div
                role="status"
                className="rounded-md border border-accent-green/25 bg-accent-green/[0.06] px-3 py-2 text-xs text-accent-green"
              >
                Dataset uploaded. Processing complete.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Delete confirmation dialog ────────────────────────── */}
      {pendingDelete && (
        <DeleteConfirmDialog
          datasetId={pendingDelete.id}
          datasetName={pendingDelete.name}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </AppLayout>
  );
}

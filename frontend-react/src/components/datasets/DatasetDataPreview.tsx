/**
 * DatasetDataPreview — paginated row preview from GET /api/dataset/:id/data.
 *
 * Uses server-side pagination: page, page_size, total_pages from backend.
 * page_size clamped to max 200 by the backend.
 * Only fetches the current page — does not load the full dataset blob.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { datasetsApi } from '@/api/datasets';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { Button } from '@/components/shared/Button';

const PAGE_SIZE = 50;

interface DatasetDataPreviewProps {
  datasetId: number;
}

export function DatasetDataPreview({ datasetId }: DatasetDataPreviewProps) {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dataset-data', datasetId, page] as const,
    queryFn: () => datasetsApi.getData(datasetId, page, PAGE_SIZE),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 py-8">
        <LoadingSpinner />
        <span className="text-xs text-text-tertiary">Loading preview…</span>
      </div>
    );
  }

  if (isError) {
    return <ErrorState title="Failed to load preview" error={error} onRetry={() => void refetch()} />;
  }

  if (!data || data.data.length === 0) {
    return <p className="text-sm text-text-tertiary">No data available.</p>;
  }

  const columns = Object.keys(data.data[0]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-text-tertiary">
        <span>
          Showing rows {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} of {data.total.toLocaleString()}
        </span>
        <span>Page {data.page} / {data.total_pages}</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-white/[0.07]">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-white/[0.07] bg-white/[0.03]">
              <th className="px-2 py-2 text-left text-[10px] font-medium text-text-tertiary">#</th>
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-left font-medium font-mono text-text-secondary max-w-[120px] truncate"
                  title={col}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {data.data.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-white/[0.02]">
                <td className="px-2 py-1.5 tabular-nums text-text-tertiary">
                  {(page - 1) * PAGE_SIZE + rowIdx + 1}
                </td>
                {columns.map((col) => {
                  const val = row[col];
                  return (
                    <td key={col} className="px-3 py-1.5 text-text-secondary max-w-[200px]">
                      <span className="block truncate" title={val !== null && val !== undefined ? String(val) : ''}>
                        {val === null || val === undefined
                          ? <span className="text-text-tertiary/40 italic">null</span>
                          : String(val)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data.total_pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            id="btn-preview-prev"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ←
          </Button>
          <span className="text-xs text-text-tertiary">
            {page} / {data.total_pages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            id="btn-preview-next"
            disabled={page >= data.total_pages}
            onClick={() => setPage((p) => p + 1)}
          >
            →
          </Button>
        </div>
      )}
    </div>
  );
}

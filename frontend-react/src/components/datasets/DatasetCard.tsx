/**
 * DatasetCard — compact card shown in the dataset list grid.
 *
 * Displays: name, filename, rows, cols, size, status, created date.
 * Actions: View (navigate to detail) | Delete (with confirmation).
 *
 * Data from _dataset_list_item() — no columns_json / summary_json blobs.
 */

import { Link } from 'react-router-dom';
import { Badge } from '@/components/shared/Badge';
import { Button } from '@/components/shared/Button';
import type { DatasetListItem } from '@/types';

interface DatasetCardProps {
  dataset: DatasetListItem;
  onDelete: (id: number, name: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getFileExt(filename: string): string {
  const ext = filename.split('.').pop()?.toUpperCase() ?? '';
  return ext;
}

export function DatasetCard({ dataset, onDelete }: DatasetCardProps) {
  const isReady = dataset.upload_status === 'ready';

  return (
    <div className="group flex flex-col rounded-xl border border-white/[0.07] bg-bg-card p-4 transition-all hover:border-white/[0.14]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* File icon */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <Badge variant="default">{getFileExt(dataset.original_filename)}</Badge>
        </div>
        <Badge variant={isReady ? 'low' : 'medium'}>
          {dataset.upload_status}
        </Badge>
      </div>

      {/* Name + filename */}
      <h3 className="mt-3 truncate text-sm font-semibold text-text-primary" title={dataset.name}>
        {dataset.name}
      </h3>
      <p className="truncate text-[11px] text-text-tertiary" title={dataset.original_filename}>
        {dataset.original_filename}
      </p>

      {/* Description */}
      {dataset.description && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-text-tertiary line-clamp-2">
          {dataset.description}
        </p>
      )}

      {/* Stats */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
        <span>
          <span className="font-semibold tabular-nums">{dataset.row_count.toLocaleString()}</span> rows
        </span>
        <span>
          <span className="font-semibold tabular-nums">{dataset.column_count}</span> cols
        </span>
        <span className="text-text-tertiary">{formatBytes(dataset.file_size_bytes)}</span>
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
        <span className="text-[10px] text-text-tertiary">{formatDate(dataset.created_at)}</span>

        <div className="flex gap-1.5">
          <button
            type="button"
            id={`btn-delete-dataset-${dataset.id}`}
            onClick={(e) => { e.preventDefault(); onDelete(dataset.id, dataset.name); }}
            className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-accent-red/10 hover:text-accent-red"
            title="Delete dataset"
            aria-label={`Delete ${dataset.name}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
          <Link to={`/datasets/${dataset.id}`}>
            <Button
              size="sm"
              variant="secondary"
              id={`btn-view-dataset-${dataset.id}`}
              disabled={!isReady}
            >
              View
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

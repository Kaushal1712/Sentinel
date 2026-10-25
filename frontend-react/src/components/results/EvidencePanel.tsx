/**
 * EvidencePanel — lists evidence snapshot files for a scan.
 *
 * Data from GET /api/evidence/:id → { scan_id, count, evidence: EvidenceFile[] }
 * Each entry has { filename, size_bytes, created_at }.
 *
 * The evidence detail (GET /api/evidence/:id/:filename) returns raw JSON.
 * We show filename, size, date, and an expandable raw JSON view.
 * We do NOT render arbitrary HTML from the evidence content to avoid XSS.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { resultsApi } from '@/api/results';
import type { EvidenceFile } from '@/types';

interface EvidencePanelProps {
  scanId: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

interface EvidenceRowProps {
  scanId: number;
  file: EvidenceFile;
}

function EvidenceRow({ scanId, file }: EvidenceRowProps) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['evidence-detail', scanId, file.filename] as const,
    queryFn: () => resultsApi.getEvidenceDetail(scanId, file.filename),
    enabled: expanded,      // Only fetch when expanded
    staleTime: Infinity,    // Evidence is immutable once captured
    retry: 1,
  });

  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between p-3 text-left hover:bg-white/[0.03] transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-purple shrink-0" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <div>
            <p className="text-xs font-medium text-text-primary">{file.filename}</p>
            <p className="text-[10px] text-text-tertiary">
              {formatBytes(file.size_bytes)} · {formatDate(file.created_at)}
            </p>
          </div>
        </div>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" aria-hidden="true"
          className={`text-text-tertiary transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] p-3">
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-text-tertiary">
              <LoadingSpinner size="sm" />
              Loading evidence…
            </div>
          )}
          {isError && (
            <p className="text-xs text-accent-red">Failed to load evidence contents.</p>
          )}
          {data && (
            <pre className="max-h-64 overflow-auto rounded bg-black/30 p-3 text-[10px] leading-relaxed text-text-secondary">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function EvidencePanel({ scanId }: EvidencePanelProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['evidence', scanId] as const,
    queryFn: () => resultsApi.listEvidence(scanId),
    staleTime: 60_000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-text-tertiary">
        <LoadingSpinner size="sm" />
        Loading evidence…
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-accent-red">
        Could not load evidence for this scan.
      </p>
    );
  }

  if (!data || data.count === 0) {
    return (
      <EmptyState
        title="No evidence archived"
        description="Evidence is captured during Full scans when the scraper saves page snapshots."
      />
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-tertiary mb-3">
        {data.count} archived snapshot{data.count !== 1 ? 's' : ''}
      </p>
      {data.evidence.map((file) => (
        <EvidenceRow key={file.filename} scanId={scanId} file={file} />
      ))}
    </div>
  );
}

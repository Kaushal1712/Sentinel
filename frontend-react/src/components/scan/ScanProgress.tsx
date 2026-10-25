/**
 * ScanProgress — live scan status display shown after scan creation.
 *
 * Displays:
 *   - Animated progress bar (real `progress` 0–100 from backend)
 *   - Current stage label (from `current_stage` in Scan.to_dict())
 *   - Stage tracker with the actual pipeline stages from backend/core/pipeline.py
 *   - Platforms discovered counter (from `platforms_found`)
 *   - Completion state → "View Results" button
 *   - Failure state → error message + retry option
 *
 * Pipeline stages (exact strings from backend/core/pipeline.py):
 *   Normalizing identity (progress ~10%)
 *   Running discovery (progress ~15%)
 *   Processing discovered profiles (progress ~40%)
 *   Scraping discovered pages (progress ~55%)  — full mode only
 *   Extracting entities (progress ~70%)
 *   Data Enrichment & Threat Intel (progress ~80%)
 *   Building identity graph (progress ~85%)
 *   Generating risk report (progress ~95%)
 *   Scan complete (progress 100%)
 *
 * Failure stages:
 *   Scan failed
 *   Scan timed out
 */

import { Link } from 'react-router-dom';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Button } from '@/components/shared/Button';
import { RiskBadge, ScanModeBadge } from '@/components/shared/Badge';
import type { Scan, ScanMode } from '@/types';

interface ScanProgressProps {
  scan: Scan | null;
  isPolling: boolean;
  mode: ScanMode;
  onNewScan: () => void;
}

// Ordered pipeline stages matching exact strings from backend/core/pipeline.py
const PIPELINE_STAGES: readonly string[] = [
  'Normalizing identity',
  'Running discovery',
  'Processing discovered profiles',
  'Scraping discovered pages',      // full mode only, but show for both
  'Extracting entities',
  'Data Enrichment & Threat Intel',
  'Building identity graph',
  'Generating risk report',
];

function getStageIndex(currentStage: string | null): number {
  if (!currentStage) return -1;
  // Match prefix — pipeline sometimes appends additional info
  return PIPELINE_STAGES.findIndex((s) =>
    currentStage.toLowerCase().startsWith(s.toLowerCase()),
  );
}

function formatDuration(createdAt: string): string {
  const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  return `${Math.floor(diff / 60)}m ${diff % 60}s`;
}

export function ScanProgress({ scan, isPolling, mode, onNewScan }: ScanProgressProps) {
  const isCompleted = scan?.status === 'completed';
  const isFailed = scan?.status === 'failed' || scan?.current_stage === 'Scan timed out';
  const isPending = !scan || scan.status === 'pending';
  const isRunning = scan?.status === 'running';

  const progress = scan?.progress ?? 0;
  const currentStageIdx = getStageIndex(scan?.current_stage ?? null);

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-text-primary">
            {isCompleted
              ? 'Scan Complete'
              : isFailed
                ? 'Scan Failed'
                : 'Scan In Progress'}
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Scan #{scan?.id ?? '—'} ·{' '}
            <ScanModeBadge mode={mode} />
            {scan?.created_at && (
              <> · {formatDuration(scan.created_at)} elapsed</>
            )}
          </p>
        </div>
        {isPolling && <LoadingSpinner size="sm" />}
      </div>

      {/* ── Progress bar ──────────────────────────────────────────── */}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-text-secondary">
            {scan?.current_stage ?? 'Initializing…'}
          </span>
          <span className="tabular-nums text-text-tertiary">{progress}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className={[
              'h-full rounded-full transition-all duration-700 ease-out',
              isCompleted
                ? 'bg-accent-green'
                : isFailed
                  ? 'bg-accent-red'
                  : 'bg-accent-blue',
            ].join(' ')}
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      {/* ── Stage tracker ─────────────────────────────────────────── */}
      <div className="space-y-1.5">
        {PIPELINE_STAGES.map((stage, idx) => {
          const isDone = isCompleted || idx < currentStageIdx;
          const isActive = !isCompleted && idx === currentStageIdx;
          const isPast = isDone;

          return (
            <div
              key={stage}
              className={[
                'flex items-center gap-3 text-xs',
                isPast || isActive ? '' : 'opacity-30',
              ].join(' ')}
            >
              {/* Dot */}
              <div
                className={[
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                  isDone
                    ? 'bg-accent-green/20 text-accent-green'
                    : isActive
                      ? 'bg-accent-blue/20 text-accent-blue'
                      : 'bg-white/[0.06] text-text-tertiary',
                ].join(' ')}
              >
                {isDone ? (
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <polyline points="2 6 5 9 10 3" />
                  </svg>
                ) : isActive ? (
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                ) : (
                  <div className="h-1 w-1 rounded-full bg-current" />
                )}
              </div>
              <span
                className={[
                  isDone ? 'text-accent-green' : isActive ? 'text-text-primary font-medium' : 'text-text-tertiary',
                ].join(' ')}
              >
                {stage}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Live metrics ──────────────────────────────────────────── */}
      {(scan?.platforms_found ?? 0) > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-accent-green/10 border border-accent-green/20 px-3 py-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-green shrink-0" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-sm text-accent-green">
            {scan!.platforms_found} platform{scan!.platforms_found !== 1 ? 's' : ''} discovered
          </span>
        </div>
      )}

      {/* ── Completion state ──────────────────────────────────────── */}
      {isCompleted && scan && (
        <div className="space-y-4">
          <div className="rounded-lg bg-accent-green/10 border border-accent-green/20 p-4">
            <p className="text-sm font-semibold text-accent-green">
              ✓ Scan completed successfully
            </p>
            <div className="mt-2 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-lg font-bold tabular-nums text-text-primary">
                  {scan.platforms_found}
                </p>
                <p className="text-[10px] text-text-tertiary">Platforms</p>
              </div>
              <div>
                <p className="text-lg font-bold tabular-nums text-text-primary">
                  {scan.entities_found}
                </p>
                <p className="text-[10px] text-text-tertiary">Entities</p>
                {scan.mode === 'quick' && scan.entities_found === 0 && (
                  <p className="mt-0.5 text-[9px] leading-tight text-text-tertiary/70">
                    Quick Scan checks snippets only.{' '}
                    Run a Full Scan for deeper extraction.
                  </p>
                )}
              </div>
              <div>
                <p className="text-lg font-bold text-text-primary">
                  <RiskBadge score={scan.risk_score} />
                </p>
                <p className="text-[10px] text-text-tertiary">Risk Score</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Link to={`/results/${scan.id}`} className="flex-1">
              <Button id="btn-view-results" className="w-full">
                View Results →
              </Button>
            </Link>
            <Button
              variant="secondary"
              onClick={onNewScan}
              id="btn-new-scan-after-complete"
            >
              New Scan
            </Button>
          </div>
        </div>
      )}

      {/* ── Failure state ─────────────────────────────────────────── */}
      {isFailed && (
        <div className="space-y-4">
          <div className="rounded-lg bg-accent-red/10 border border-accent-red/20 p-4">
            <p className="text-sm font-semibold text-accent-red">Scan failed</p>
            <p className="mt-1 text-xs text-text-tertiary">
              {scan?.current_stage === 'Scan timed out'
                ? 'The scan timed out before completing. This can happen if the target has many profiles or the network is slow.'
                : 'An error occurred during the scan pipeline. This may be temporary — please try again.'}
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              id="btn-retry-scan"
              onClick={onNewScan}
              variant="secondary"
              className="flex-1"
            >
              ← Start New Scan
            </Button>
          </div>
        </div>
      )}

      {/* ── Pending / indeterminate ───────────────────────────────── */}
      {(isPending || (isRunning && !isCompleted && !isFailed && progress === 0)) && (
        <p className="text-center text-xs text-text-tertiary">
          Queuing scan in background worker…
        </p>
      )}
    </div>
  );
}

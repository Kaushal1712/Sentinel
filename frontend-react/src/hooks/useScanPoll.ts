/**
 * useScanPoll — polls GET /api/scan/:id/status until the scan reaches a
 * terminal state (completed | failed).
 *
 * Uses TanStack Query's `refetchInterval` for polling. The interval is set
 * to a function that returns `false` when the scan is in a terminal state,
 * which causes TanStack Query to stop polling automatically.
 *
 * The hook also disables polling when:
 *   - scanId is null (no scan started)
 *   - the query has entered an error state
 *   - the window is hidden (refetchIntervalInBackground: false)
 *
 * Cleanup: When the component unmounts, TanStack Query automatically
 * cancels in-flight requests and stops polling.
 *
 * Terminal states (from backend/database.py Scan model):
 *   completed | failed
 *
 * Active states (polling continues):
 *   pending | running
 */

import { useQuery } from '@tanstack/react-query';
import { scansApi } from '@/api/scans';
import type { Scan, ScanStatus } from '@/types';

const TERMINAL_STATUSES: ReadonlySet<ScanStatus> = new Set(['completed', 'failed']);

const POLL_INTERVAL_MS = 1500; // 1.5s — same as existing vanilla frontend

interface UseScanPollOptions {
  /** Scan ID to poll. Pass null to disable polling. */
  scanId: number | null;
}

interface UseScanPollResult {
  scan: Scan | null;
  isPolling: boolean;
  isError: boolean;
  error: unknown;
}

export function useScanPoll({ scanId }: UseScanPollOptions): UseScanPollResult {
  const isTerminal = (scan: Scan | null): boolean =>
    scan !== null && TERMINAL_STATUSES.has(scan.status);

  const query = useQuery({
    queryKey: ['scan', scanId, 'status'] as const,
    queryFn: async () => {
      if (scanId === null) throw new Error('No scan ID');
      const { scan } = await scansApi.getScanStatus(scanId);
      return scan;
    },
    // Only run if scanId is set.
    enabled: scanId !== null,
    // Poll every 1.5s while scan is active; return false to stop polling
    // when the scan is in a terminal state.
    refetchInterval: (query) => {
      const scan = query.state.data ?? null;
      if (isTerminal(scan)) return false;
      return POLL_INTERVAL_MS;
    },
    // Don't poll in the background tab — not critical enough to waste requests.
    refetchIntervalInBackground: false,
    // Don't retry on 404 (scan not found) — it won't appear on retry.
    retry: (failureCount, error: unknown) => {
      const apiErr = error as { status?: number } | null;
      if (apiErr?.status === 404) return false;
      return failureCount < 2;
    },
    // Keep data stale so it shows even after polling stops.
    staleTime: Infinity,
  });

  const scan = query.data ?? null;

  return {
    scan,
    // isPolling = query is enabled AND scan is NOT in terminal state
    isPolling: scanId !== null && !isTerminal(scan) && !query.isError,
    isError: query.isError,
    error: query.error,
  };
}

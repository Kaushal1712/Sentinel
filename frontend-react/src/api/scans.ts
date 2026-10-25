/**
 * Scan API module.
 *
 * Endpoints (confirmed from backend/api/scan.py):
 *
 *   POST /api/scan/quick
 *     Body: ScanPayload
 *     201: { message, scan: Scan }
 *     400: { error } — missing body / missing self_attested / missing name
 *     403: { error } — name or email mismatch (SELF_SCAN_ONLY)
 *     429: { error: "daily_quota_exceeded", message } — daily quota hit
 *     429: rate limit (10/min) — { error }
 *
 *   POST /api/scan/full
 *     Same as above, different pipeline (includes scraping)
 *
 *   GET /api/scan/:id/status
 *     200: { scan: Scan }
 *     404: { error: "Scan not found" }
 *
 *   GET /api/scan/:id/results  (used by Results page, Phase 3E)
 *     200: { scan: Scan, results: ScanResult[], total: number }
 *     404: { error: "Scan not found" }
 *
 * Backend SELF_SCAN_ONLY=true (default):
 *   - target_name is always set from user.full_name (server-side)
 *   - target_email is always set from user.email (server-side)
 *   - The frontend must send `name` matching user.full_name and `email`
 *     matching user.email in the payload, or omit them (server uses trusted values)
 *   - `self_attested: true` is REQUIRED
 *   - `username` (optional) and `phone` (optional) are the only
 *     freely-supplied fields
 *
 * Note: The `progress` field (0–100) is real and persisted by the pipeline.
 * The `current_stage` string is one of the pipeline stage labels.
 */

import { request } from './client';
import type { Scan, ScanMode } from '@/types';

// ── Request types ─────────────────────────────────────────────────────────────

/**
 * Payload for POST /api/scan/quick and POST /api/scan/full.
 *
 * In SELF_SCAN_ONLY mode (default):
 *   - name: must match the authenticated user's full_name exactly (case-insensitive normalized)
 *   - email: must match the authenticated user's email (omit if it's a placeholder)
 *   - self_attested: REQUIRED and must be true
 *   - username: optional — must belong to the requester
 *   - phone: optional — must belong to the requester
 */
export interface ScanPayload {
  name: string;
  email?: string;
  username?: string;
  phone?: string;
  /** Required by backend SELF_SCAN_ONLY guard. Must be true. */
  self_attested: true;
}

// ── Response types ────────────────────────────────────────────────────────────

export interface CreateScanResponse {
  message: string;
  scan: Scan;
}

export interface ScanStatusResponse {
  scan: Scan;
}

// ── Scan API ──────────────────────────────────────────────────────────────────

export const scansApi = {
  /**
   * Start a Quick Mode scan.
   * Rate-limited: 10 per minute per user.
   */
  createQuickScan(payload: ScanPayload): Promise<CreateScanResponse> {
    return request<CreateScanResponse>('/api/scan/quick', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Start a Full Mode scan (includes page scraping).
   * Rate-limited: 10 per minute per user.
   */
  createFullScan(payload: ScanPayload): Promise<CreateScanResponse> {
    return request<CreateScanResponse>('/api/scan/full', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Poll the current status of a scan.
   * Returns the full Scan.to_dict() shape including progress (0-100)
   * and current_stage string.
   */
  getScanStatus(scanId: number): Promise<ScanStatusResponse> {
    return request<ScanStatusResponse>(`/api/scan/${scanId}/status`);
  },

  /**
   * Create a scan using the mode param to select the right endpoint.
   * Convenience wrapper used by ScanPage.
   */
  createScan(mode: ScanMode, payload: ScanPayload): Promise<CreateScanResponse> {
    return mode === 'full'
      ? scansApi.createFullScan(payload)
      : scansApi.createQuickScan(payload);
  },
};

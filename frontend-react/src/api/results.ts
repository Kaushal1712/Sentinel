/**
 * Results API module.
 *
 * Endpoints (confirmed from backend/api/scan.py, backend/api/results.py,
 * backend/api/evidence.py, backend/api/export.py):
 *
 *   GET /api/scan/:id/results
 *     Auth: Required
 *     200: { scan: Scan, results: ScanResult[], total: number }
 *     404: { error: "Scan not found" }
 *
 *   GET /api/results/:id/report
 *     Auth: Required
 *     200: { report: RiskReport }
 *     404: { error: "Scan not found" }
 *
 *   GET /api/results/history
 *     Auth: Required
 *     200: { scans: Scan[], total: number }
 *
 *   GET /api/evidence/:id
 *     Auth: Required
 *     200: { scan_id, count, evidence: EvidenceFile[] }
 *     404: { error: "Scan not found" }
 *
 *   GET /api/evidence/:id/:filename
 *     Auth: Required
 *     200: raw evidence JSON dict
 *     404: { error: "Evidence file not found" }
 *
 * Export URLs (opened directly in a new browser tab — no fetch needed):
 *   GET /api/export/:id/json  → JSON download
 *   GET /api/export/:id/csv   → CSV download
 *   GET /api/export/:id/pdf   → PDF download
 *
 * Note: DELETE /api/export/:id/delete exists but scan deletion is not
 * exposed in Phase 3E UI to avoid accidental data loss.
 */

import { request } from './client';
import type {
  ScanResultsResponse,
  ScanReportResponse,
  EvidenceListResponse,
  EvidenceDetail,
  Scan,
} from '@/types';

export interface ScanHistoryResponse {
  scans: Scan[];
  total: number;
}

export const resultsApi = {
  /**
   * Fetch full results for a scan (profile list + scan header).
   * Use with TanStack Query; staleTime=Infinity since results don't change.
   */
  getScanResults(scanId: number): Promise<ScanResultsResponse> {
    return request<ScanResultsResponse>(`/api/scan/${scanId}/results`);
  },

  /**
   * Fetch the AI-generated risk analysis report for a scan.
   * Can be called independently so the results list loads first.
   */
  getScanReport(scanId: number): Promise<ScanReportResponse> {
    return request<ScanReportResponse>(`/api/results/${scanId}/report`);
  },

  /**
   * Fetch the list of evidence snapshot filenames for a scan.
   * Each entry has { filename, size_bytes, created_at }.
   */
  listEvidence(scanId: number): Promise<EvidenceListResponse> {
    return request<EvidenceListResponse>(`/api/evidence/${scanId}`);
  },

  /**
   * Fetch the contents of a specific evidence snapshot file.
   * The response is raw JSON; shape varies per scraper.
   */
  getEvidenceDetail(scanId: number, filename: string): Promise<EvidenceDetail> {
    return request<EvidenceDetail>(`/api/evidence/${scanId}/${encodeURIComponent(filename)}`);
  },

  /**
   * Fetch the user's scan history (last 50 scans).
   */
  getScanHistory(): Promise<ScanHistoryResponse> {
    return request<ScanHistoryResponse>('/api/results/history');
  },

  /**
   * Return the URL for a download export. The caller opens it in a new tab.
   * No fetch — the browser handles the authenticated download via cookie.
   */
  exportUrl(scanId: number, format: 'json' | 'csv' | 'pdf'): string {
    return `/api/export/${scanId}/${format}`;
  },
};

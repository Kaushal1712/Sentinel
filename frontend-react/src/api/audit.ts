/**
 * Audit API — confirmed from backend/api/audit.py
 *
 * Authentication required on all endpoints.
 * RBAC: regular users see own logs; admin/analyst see all.
 *
 * Endpoints:
 *   GET /api/audit/logs?page=1&per_page=50&event_type=
 *     → { logs: AuditLogEntry[], total, page, pages, per_page }
 *     per_page clamped to max 200 server-side
 *
 *   GET /api/audit/event-types
 *     → { event_types: string[] }
 *
 *   GET /api/audit/logs/export  → CSV download (browser navigation, not fetch)
 *     Not called via JS — browser window.location triggers a direct download.
 *
 * NOTE: The export endpoint returns a streaming CSV response — it should be
 * triggered by navigating the browser directly (window.open or <a href>)
 * rather than via fetch(), so the browser's native file save dialog appears.
 */

import { request } from './client';
import type {
  AuditLogEntry,
  AuditLogsResponse,
  AuditEventTypesResponse,
} from '@/types';

export const auditApi = {
  getLogs(params: {
    page?: number;
    per_page?: number;
    event_type?: string;
  } = {}): Promise<AuditLogsResponse> {
    const qs = new URLSearchParams();
    if (params.page != null) qs.set('page', String(params.page));
    if (params.per_page != null) qs.set('per_page', String(Math.min(params.per_page, 200)));
    if (params.event_type) qs.set('event_type', params.event_type);
    const query = qs.toString();
    return request<AuditLogsResponse>(`/api/audit/logs${query ? `?${query}` : ''}`);
  },

  getEventTypes(): Promise<AuditEventTypesResponse> {
    return request<AuditEventTypesResponse>('/api/audit/event-types');
  },
};

export type { AuditLogEntry };

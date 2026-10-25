/**
 * Dashboard API module.
 *
 * Endpoint: GET /api/dashboard/stats
 * Auth:     Required (JWT cookie)
 * Returns:  DashboardResponse
 *
 * Confirmed from backend/api/dashboard.py inspection.
 */

import { request } from './client';
import type { DashboardResponse } from '@/types';

export const dashboardApi = {
  /**
   * Fetch dashboard statistics for the current authenticated user.
   *
   * Returns:
   *  - stats: total/completed/running scans, avg risk, profiles, entities
   *  - recent_scans: last 10 scans (Scan.to_dict() shape)
   *  - top_platforms: top 10 platforms by result count
   *  - timeline: 14-day daily scan count + avg risk
   */
  getStats(): Promise<DashboardResponse> {
    return request<DashboardResponse>('/api/dashboard/stats');
  },
};

/**
 * Schedules API — confirmed from backend/api/schedule.py
 *
 * All endpoints require authentication.
 * Ownership enforced via user_id filter on ScheduledScan.
 *
 * Endpoints:
 *   GET    /api/schedule/         → { schedules: ScheduledScan[], total }
 *   POST   /api/schedule/         → { message, schedule: ScheduledScan }
 *     body: { target_username: string, frequency: Frequency, notify_on_change?: boolean }
 *   PUT    /api/schedule/:id      → { message, schedule: ScheduledScan }
 *     body: { frequency?, notify_on_change?, active? }
 *   DELETE /api/schedule/:id      → { message }
 *   POST   /api/schedule/:id/toggle → { message, schedule: ScheduledScan }
 *
 * frequency values: "daily" | "weekly" | "monthly"
 * No rate limit decorator on schedule endpoints.
 */

import { request } from './client';
import type {
  ScheduledScan,
  ScheduleListResponse,
  ScheduleCreateRequest,
  ScheduleUpdateRequest,
  ScheduleMutationResponse,
  GenericMessageResponse,
} from '@/types';

export const schedulesApi = {
  list(): Promise<ScheduleListResponse> {
    return request<ScheduleListResponse>('/api/schedule/');
  },

  create(body: ScheduleCreateRequest): Promise<ScheduleMutationResponse> {
    return request<ScheduleMutationResponse>('/api/schedule/', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  update(id: number, body: ScheduleUpdateRequest): Promise<ScheduleMutationResponse> {
    return request<ScheduleMutationResponse>(`/api/schedule/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  delete(id: number): Promise<GenericMessageResponse> {
    return request<GenericMessageResponse>(`/api/schedule/${id}`, {
      method: 'DELETE',
    });
  },

  toggle(id: number): Promise<ScheduleMutationResponse> {
    return request<ScheduleMutationResponse>(`/api/schedule/${id}/toggle`, {
      method: 'POST',
    });
  },
};

export type { ScheduledScan };

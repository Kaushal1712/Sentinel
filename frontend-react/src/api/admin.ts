/**
 * Admin API — confirmed from backend/api/admin.py
 *
 * All endpoints require authentication + @require_admin (role in {admin, analyst}).
 * Backend returns 403 for non-admin users.
 *
 * Endpoints:
 *   GET /api/admin/stats
 *     → AdminStats
 *
 *   GET /api/admin/users
 *     → { users: AdminUser[], total }
 *
 *   PUT /api/admin/users/:id/role
 *     Body: { role: UserRole }
 *     → { message, user: AdminUser }
 *     Valid roles: "admin" | "analyst" | "user" | "viewer"
 *
 *   PUT /api/admin/users/:id/quota
 *     Body: { max_scans_per_day: number | null }
 *     → { message, user: AdminUser }
 */

import { request } from './client';
import type {
  AdminStats,
  AdminUser,
  AdminUsersResponse,
  AdminUserMutationResponse,
  UserRole,
} from '@/types';

export const adminApi = {
  getStats(): Promise<AdminStats> {
    return request<AdminStats>('/api/admin/stats');
  },

  listUsers(): Promise<AdminUsersResponse> {
    return request<AdminUsersResponse>('/api/admin/users');
  },

  updateRole(userId: number, role: UserRole): Promise<AdminUserMutationResponse> {
    return request<AdminUserMutationResponse>(`/api/admin/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
  },

  updateQuota(userId: number, max_scans_per_day: number | null): Promise<AdminUserMutationResponse> {
    return request<AdminUserMutationResponse>(`/api/admin/users/${userId}/quota`, {
      method: 'PUT',
      body: JSON.stringify({ max_scans_per_day }),
    });
  },
};

export type { AdminStats, AdminUser, UserRole };

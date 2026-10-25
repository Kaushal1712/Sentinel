/**
 * AdminPage — /admin
 *
 * System statistics and user management for admin/analyst roles.
 * Backend enforces RBAC via @require_admin on all endpoints.
 * This frontend guard redirects non-admin users to /dashboard immediately.
 * The backend remains authoritative — a 403 from any admin endpoint is handled.
 *
 * Tabs:
 *   - Overview: system stats (GET /api/admin/stats)
 *   - Users: user list + role/quota management (GET/PUT /api/admin/users)
 *   - Audit: audit log viewer (GET /api/audit/logs)
 *
 * User management operations:
 *   - Update role: PUT /api/admin/users/:id/role
 *   - Update quota: PUT /api/admin/users/:id/quota
 *   Valid roles: admin | analyst | user | viewer (backend-validated)
 *
 * No destructive user operations exist in the backend (no delete user endpoint).
 */

import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { adminApi } from '@/api/admin';
import { auditApi } from '@/api/audit';
import { isApiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import type { AdminUser, UserRole, AuditLogEntry } from '@/types';

type Tab = 'overview' | 'users' | 'audit';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users',    label: 'Users' },
  { id: 'audit',    label: 'Audit Logs' },
];

const VALID_ROLES: UserRole[] = ['admin', 'analyst', 'user', 'viewer'];

const ROLE_COLORS: Record<UserRole, string> = {
  admin:   'bg-accent-red/10 text-accent-red',
  analyst: 'bg-accent-purple/10 text-accent-purple',
  user:    'bg-accent-blue/10 text-accent-blue',
  viewer:  'bg-white/5 text-text-tertiary',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── System Overview ───────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-stats'] as const,
    queryFn: () => adminApi.getStats(),
    staleTime: 60_000,
    retry: 1,
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><LoadingSpinner size="lg" /></div>;
  if (isError) return <Card><ErrorState title="Failed to load stats" error={error} onRetry={() => void refetch()} /></Card>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total Users',     value: data.total_users },
          { label: 'Total Scans',     value: data.total_scans },
          { label: 'This Week',       value: data.scans_this_week },
          { label: 'This Month',      value: data.scans_this_month },
          { label: 'Completed',       value: data.scans_by_status.completed },
          { label: 'Failed',          value: data.scans_by_status.failed },
          { label: 'Running',         value: data.scans_by_status.running },
          { label: 'Avg Risk Score',  value: data.average_risk_score.toFixed(1) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl border border-white/[0.07] bg-bg-card px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-text-primary">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Top targets */}
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Top Scanned Targets</h3>
          {data.top_targets.length === 0 ? (
            <p className="text-xs text-text-tertiary">No scan data yet.</p>
          ) : (
            <div className="space-y-2">
              {data.top_targets.map(({ username, count }) => (
                <div key={username} className="flex items-center justify-between">
                  <span className="text-xs font-mono text-text-secondary">@{username}</span>
                  <span className="text-xs tabular-nums text-text-tertiary">{count} scan{count !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Scans per user */}
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Scans by User</h3>
          {data.scans_per_user.length === 0 ? (
            <p className="text-xs text-text-tertiary">No data.</p>
          ) : (
            <div className="space-y-2">
              {data.scans_per_user.map(({ email, count }) => (
                <div key={email} className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary truncate max-w-[200px]">{email}</span>
                  <span className="text-xs tabular-nums text-text-tertiary">{count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── User Management ───────────────────────────────────────────────────────────

interface RoleSelectProps {
  user: AdminUser;
  onUpdate: (userId: number, role: UserRole) => void;
  isUpdating: boolean;
}

function RoleSelect({ user, onUpdate, isUpdating }: RoleSelectProps) {
  return (
    <select
      id={`role-select-${user.id}`}
      value={user.role}
      disabled={isUpdating}
      onChange={(e) => onUpdate(user.id, e.target.value as UserRole)}
      className="rounded border border-white/[0.10] bg-bg-card px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-blue/40 disabled:opacity-50"
      aria-label={`Role for ${user.email}`}
    >
      {VALID_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
    </select>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [editQuotaId, setEditQuotaId] = useState<number | null>(null);
  const [quotaInput, setQuotaInput] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-users'] as const,
    queryFn: () => adminApi.listUsers(),
    staleTime: 30_000,
    retry: 1,
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: UserRole }) =>
      adminApi.updateRole(userId, role),
    onMutate: ({ userId }) => setUpdatingId(userId),
    onSettled: () => {
      setUpdatingId(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  const quotaMutation = useMutation({
    mutationFn: ({ userId, quota }: { userId: number; quota: number | null }) =>
      adminApi.updateQuota(userId, quota),
    onSuccess: () => {
      setEditQuotaId(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  if (isLoading) return <div className="flex items-center justify-center py-20"><LoadingSpinner size="lg" /></div>;
  if (isError) return <Card><ErrorState title="Failed to load users" error={error} onRetry={() => void refetch()} /></Card>;

  const users = data?.users ?? [];

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-text-primary">{users.length} users</p>
        {roleMutation.isError && (
          <p className="text-xs text-accent-red">
            {isApiError(roleMutation.error) ? roleMutation.error.error : 'Role update failed.'}
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-white/[0.08] text-left">
              {['User', 'Role', 'Scans', 'Quota/day', 'Verified', '2FA', 'Actions'].map((h) => (
                <th key={h} className="px-3 py-2 font-medium text-text-tertiary whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-white/[0.02]">
                <td className="px-3 py-2.5">
                  <p className="font-medium text-text-primary">{u.full_name}</p>
                  <p className="text-text-tertiary">{u.email}</p>
                </td>
                <td className="px-3 py-2.5">
                  <RoleSelect
                    user={u}
                    onUpdate={(id, role) => roleMutation.mutate({ userId: id, role })}
                    isUpdating={updatingId === u.id}
                  />
                </td>
                <td className="px-3 py-2.5 tabular-nums text-text-secondary">{u.scan_count}</td>
                <td className="px-3 py-2.5">
                  {editQuotaId === u.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        id={`quota-input-${u.id}`}
                        type="number"
                        min={1}
                        value={quotaInput}
                        onChange={(e) => setQuotaInput(e.target.value)}
                        className="w-16 rounded border border-white/[0.10] bg-bg-card px-1.5 py-0.5 text-xs text-text-primary outline-none"
                        placeholder="∞"
                      />
                      <button
                        type="button"
                        id={`btn-save-quota-${u.id}`}
                        className="text-[10px] text-accent-green hover:underline"
                        disabled={quotaMutation.isPending}
                        onClick={() => quotaMutation.mutate({
                          userId: u.id,
                          quota: quotaInput.trim() ? parseInt(quotaInput, 10) : null,
                        })}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="text-[10px] text-text-tertiary hover:underline"
                        onClick={() => setEditQuotaId(null)}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      id={`btn-edit-quota-${u.id}`}
                      onClick={() => { setEditQuotaId(u.id); setQuotaInput(u.max_scans_per_day?.toString() ?? ''); }}
                      className="text-text-secondary hover:text-accent-blue transition-colors"
                    >
                      {u.max_scans_per_day ?? '∞'}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <span className={u.is_verified ? 'text-accent-green' : 'text-text-tertiary'}>
                    {u.is_verified ? '✓' : '—'}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={u.has_2fa ? 'text-accent-green' : 'text-text-tertiary'}>
                    {u.has_2fa ? '✓' : '—'}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_COLORS[u.role]}`}>
                    {u.role}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <p className="py-6 text-center text-sm text-text-tertiary">No users found.</p>}
      </div>
    </Card>
  );
}

// ── Audit Log Viewer ──────────────────────────────────────────────────────────

function AuditTab() {
  const [page, setPage] = useState(1);
  const [eventFilter, setEventFilter] = useState('');

  const { data: typesData } = useQuery({
    queryKey: ['audit-event-types'] as const,
    queryFn: () => auditApi.getEventTypes(),
    staleTime: 120_000,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['audit-logs', page, eventFilter] as const,
    queryFn: () => auditApi.getLogs({ page, per_page: 50, event_type: eventFilter || undefined }),
    staleTime: 30_000,
    retry: 1,
  });

  return (
    <div className="space-y-4">
      {/* Filter + export row */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          id="audit-event-filter"
          value={eventFilter}
          onChange={(e) => { setEventFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-white/[0.10] bg-bg-card px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent-blue/40"
        >
          <option value="">All event types</option>
          {(typesData?.event_types ?? []).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* CSV export — direct browser navigation (streaming response) */}
        <a
          href="/api/audit/logs/export"
          download="dfas_audit_log.csv"
          id="btn-export-audit"
          className="rounded-lg border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          Export CSV
        </a>

        {data && (
          <span className="text-xs text-text-tertiary">
            {data.total} events · page {data.page} of {data.pages}
          </span>
        )}
      </div>

      {isLoading && <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>}
      {isError && <Card><ErrorState title="Failed to load audit logs" error={error} onRetry={() => void refetch()} /></Card>}

      {!isLoading && !isError && (
        <>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-white/[0.08] text-left">
                    {['Timestamp', 'Event Type', 'Target', 'User ID', 'IP'].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium text-text-tertiary whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {(data?.logs ?? []).map((log: AuditLogEntry) => (
                    <tr key={log.id} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2 whitespace-nowrap text-text-tertiary tabular-nums">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded-full border border-accent-blue/20 bg-accent-blue/[0.06] px-1.5 py-0.5 text-[10px] font-mono text-accent-blue">
                          {log.event_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary max-w-[160px] truncate" title={log.target ?? ''}>
                        {log.target ?? '—'}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-text-tertiary">{log.user_id ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-text-tertiary">{log.ip_address ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data?.logs.length === 0 && (
                <p className="py-6 text-center text-sm text-text-tertiary">No audit events found.</p>
              )}
            </div>
          </Card>

          {/* Pagination */}
          {data && data.pages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                id="btn-audit-prev"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Prev
              </Button>
              <span className="text-xs text-text-tertiary">{page} / {data.pages}</span>
              <Button
                variant="secondary"
                size="sm"
                id="btn-audit-next"
                disabled={page >= data.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────

export function AdminPage() {
  const { currentUser } = useAuth();
  const { pathname } = useLocation();
  const initialTab: Tab =
    pathname === '/admin/users' ? 'users' :
    pathname === '/admin/audit' ? 'audit' :
    'overview';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // Frontend guard — backend remains authoritative (returns 403 for non-admin)
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'analyst';
  if (currentUser && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!currentUser) {
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="page-enter min-h-full space-y-5 p-6">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            Admin Panel
            <span className="rounded-full border border-accent-red/30 bg-accent-red/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-red">
              {currentUser.role}
            </span>
          </h1>
          <p className="mt-1 text-sm text-text-tertiary">System statistics, user management, and audit trail.</p>
        </div>

        {/* Tab bar */}
        <div role="tablist" className="flex gap-1 rounded-lg border border-white/[0.07] bg-white/[0.03] p-1 max-w-xs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              id={`admin-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'flex-1 rounded-md px-3 py-2 text-center text-xs font-medium transition-all',
                activeTab === tab.id
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'text-text-tertiary hover:text-text-secondary',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'users'    && <UsersTab />}
        {activeTab === 'audit'    && <AuditTab />}
      </div>
    </AppLayout>
  );
}

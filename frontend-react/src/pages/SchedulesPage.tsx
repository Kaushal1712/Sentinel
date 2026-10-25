/**
 * SchedulesPage — /schedules
 *
 * Manage recurring scan schedules.
 * All CRUD backed by /api/schedule/ endpoints.
 * Ownership enforced server-side (user_id filter).
 *
 * Supported operations: list, create, toggle active, delete.
 * Frequency: daily | weekly | monthly (backend-validated).
 * next_run computed by backend on create/toggle — not displayed as editable.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { Badge } from '@/components/shared/Badge';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { schedulesApi } from '@/api/schedules';
import { isApiError } from '@/api/client';
import type { ScheduledScan, Frequency } from '@/types';

const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

interface ScheduleCardProps {
  schedule: ScheduledScan;
  onToggle: (id: number) => void;
  onDelete: (schedule: ScheduledScan) => void;
  isTogglingId: number | null;
}

function ScheduleCard({ schedule, onToggle, onDelete, isTogglingId }: ScheduleCardProps) {
  const isToggling = isTogglingId === schedule.id;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-text-primary font-mono">
              @{schedule.target_username}
            </span>
            <Badge variant={schedule.active ? 'low' : 'default'}>
              {schedule.active ? 'Active' : 'Paused'}
            </Badge>
            <Badge variant="default">{FREQUENCY_LABELS[schedule.frequency]}</Badge>
            {schedule.notify_on_change && (
              <Badge variant="default">Notify on change</Badge>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-tertiary">
            <span>Last run: <span className="text-text-secondary">{formatDate(schedule.last_run)}</span></span>
            <span>Next run: <span className="text-text-secondary">{formatDate(schedule.next_run)}</span></span>
            <span>Created: <span className="text-text-secondary">{formatDate(schedule.created_at)}</span></span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            size="sm"
            id={`btn-toggle-schedule-${schedule.id}`}
            disabled={isToggling}
            onClick={() => onToggle(schedule.id)}
          >
            {isToggling ? <LoadingSpinner size="sm" /> : schedule.active ? 'Pause' : 'Resume'}
          </Button>
          <Button
            variant="danger"
            size="sm"
            id={`btn-delete-schedule-${schedule.id}`}
            onClick={() => onDelete(schedule)}
          >
            Delete
          </Button>
        </div>
      </div>
    </Card>
  );
}

interface CreateFormProps {
  onSuccess: () => void;
}

function CreateScheduleForm({ onSuccess }: CreateFormProps) {
  const [username, setUsername] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('weekly');
  const [notify, setNotify] = useState(true);

  const mutation = useMutation({
    mutationFn: () => schedulesApi.create({ target_username: username.trim(), frequency, notify_on_change: notify }),
    onSuccess: () => {
      setUsername('');
      setFrequency('weekly');
      setNotify(true);
      onSuccess();
    },
  });

  const errorMsg = mutation.isError
    ? isApiError(mutation.error)
      ? mutation.error.error ?? 'Failed to create schedule.'
      : 'Failed to create schedule.'
    : null;

  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-text-primary">New Schedule</h2>
      <div className="space-y-3">
        <div>
          <label htmlFor="schedule-username" className="block text-xs text-text-tertiary mb-1">
            Target username <span className="text-accent-red">*</span>
          </label>
          <input
            id="schedule-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. john_doe"
            className="w-full rounded-lg border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent-blue/40 focus:ring-1 focus:ring-accent-blue/20"
          />
        </div>
        <div>
          <label htmlFor="schedule-frequency" className="block text-xs text-text-tertiary mb-1">Frequency</label>
          <select
            id="schedule-frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
            className="w-full rounded-lg border border-white/[0.10] bg-bg-card px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-blue/40"
          >
            {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
              <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            id="schedule-notify"
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="rounded border-white/20"
          />
          <span className="text-xs text-text-secondary">Notify when risk changes</span>
        </label>

        {errorMsg && (
          <p role="alert" className="text-xs text-accent-red">{errorMsg}</p>
        )}

        <Button
          id="btn-create-schedule"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !username.trim()}
          className="w-full"
        >
          {mutation.isPending ? 'Creating…' : 'Create Schedule'}
        </Button>
      </div>
    </Card>
  );
}

export function SchedulesPage() {
  const queryClient = useQueryClient();
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScheduledScan | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['schedules'] as const,
    queryFn: () => schedulesApi.list(),
    staleTime: 30_000,
    retry: 2,
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => schedulesApi.toggle(id),
    onMutate: (id) => setTogglingId(id),
    onSettled: () => {
      setTogglingId(null);
      void queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => schedulesApi.delete(id),
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });

  return (
    <AppLayout>
      <div className="page-enter min-h-full space-y-6 p-6">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Scheduled Scans</h1>
          <p className="mt-1 text-sm text-text-tertiary">
            Automate recurring scans for monitored targets.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Schedule list */}
          <div className="space-y-4 lg:col-span-2">
            <p className="text-sm text-text-secondary font-medium">
              {data ? `${data.total} schedule${data.total !== 1 ? 's' : ''}` : 'Your Schedules'}
            </p>

            {isLoading && (
              <div className="flex items-center justify-center py-16">
                <LoadingSpinner size="lg" />
              </div>
            )}

            {isError && (
              <Card>
                <ErrorState title="Failed to load schedules" error={error} onRetry={() => void refetch()} />
              </Card>
            )}

            {!isLoading && !isError && data?.schedules.length === 0 && (
              <EmptyState
                title="No schedules yet"
                description="Create a schedule to automatically rescan a target on a recurring basis."
              />
            )}

            {!isLoading && !isError && data && data.schedules.map((s) => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                onToggle={(id) => toggleMutation.mutate(id)}
                onDelete={(sched) => setPendingDelete(sched)}
                isTogglingId={togglingId}
              />
            ))}
          </div>

          {/* Create form */}
          <CreateScheduleForm onSuccess={() => void queryClient.invalidateQueries({ queryKey: ['schedules'] })} />
        </div>
      </div>

      {/* Delete confirmation */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="max-w-sm w-full">
            <h3 className="text-base font-semibold text-text-primary mb-2">Delete Schedule?</h3>
            <p className="text-sm text-text-tertiary mb-4">
              Stop tracking <span className="font-mono text-text-secondary">@{pendingDelete.target_username}</span> ({FREQUENCY_LABELS[pendingDelete.frequency]}). This cannot be undone.
            </p>
            {deleteMutation.isError && (
              <p className="text-xs text-accent-red mb-3">Failed to delete. Please try again.</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" id="btn-cancel-delete-schedule" onClick={() => setPendingDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                id="btn-confirm-delete-schedule"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(pendingDelete.id)}
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}

/**
 * SettingsPage — /settings
 *
 * Displays account information and webhook management.
 *
 * GAP (documented): No /api/user/profile update endpoint exists in the backend.
 * No 2FA setup endpoint exists. Profile display is read-only from AuthContext.
 *
 * Supported:
 *   - Account info (read-only, from AuthContext)
 *   - Webhook list, create, delete, test
 *
 * Not supported (backend gap):
 *   - Profile editing (no PUT /api/user/profile)
 *   - 2FA setup (no POST /api/auth/2fa/setup)
 *   - Password change (no endpoint)
 *   - Notification preferences (no endpoint)
 *
 * SECURITY:
 *   - Webhook secret shown ONCE at creation time, then cleared from state
 *   - Secret never logged or persisted
 *   - Webhook URLs not logged
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorState } from '@/components/shared/ErrorState';
import { webhooksApi } from '@/api/webhooks';
import { isApiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import type { Webhook, WebhookWithSecret } from '@/types';

const KNOWN_EVENTS = ['scan_complete', 'scan_failed', '*'];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusBadge(code: number | null): React.ReactElement {
  if (code === null) return <span className="text-[10px] text-text-tertiary">Never triggered</span>;
  const ok = code >= 200 && code < 300;
  return (
    <span className={`text-[10px] font-mono ${ok ? 'text-accent-green' : 'text-accent-red'}`}>
      {code}
    </span>
  );
}

interface WebhookCardProps {
  webhook: Webhook;
  onDelete: (id: number) => void;
  onTest: (id: number) => void;
  isTestingId: number | null;
  testResult: { id: number; success: boolean; status_code: number } | null;
}

function WebhookCard({ webhook, onDelete, onTest, isTestingId, testResult }: WebhookCardProps) {
  const isTesting = isTestingId === webhook.id;
  const thisTestResult = testResult?.id === webhook.id ? testResult : null;

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* URL shown but not logged */}
          <p className="text-xs font-mono text-text-primary truncate" title={webhook.url}>
            {webhook.url}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-text-tertiary">
            <span>Events: <span className="text-text-secondary">{webhook.events.join(', ')}</span></span>
            <span>Last status: {statusBadge(webhook.last_status_code)}</span>
            <span>Triggered: {formatDate(webhook.last_triggered)}</span>
            <span>Created: {formatDate(webhook.created_at)}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            id={`btn-test-webhook-${webhook.id}`}
            disabled={isTesting}
            onClick={() => onTest(webhook.id)}
          >
            {isTesting ? <LoadingSpinner size="sm" /> : 'Test'}
          </Button>
          <Button
            variant="danger"
            size="sm"
            id={`btn-delete-webhook-${webhook.id}`}
            onClick={() => onDelete(webhook.id)}
          >
            Delete
          </Button>
        </div>
      </div>
      {thisTestResult && (
        <div className={`text-xs ${thisTestResult.success ? 'text-accent-green' : 'text-accent-red'}`}>
          Test {thisTestResult.success ? 'succeeded' : 'failed'} — HTTP {thisTestResult.status_code}
        </div>
      )}
    </div>
  );
}

interface CreateWebhookFormProps {
  onCreated: (webhook: WebhookWithSecret) => void;
}

function CreateWebhookForm({ onCreated }: CreateWebhookFormProps) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['scan_complete']);
  const [customSecret, setCustomSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  function toggleEvent(ev: string) {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    );
  }

  const mutation = useMutation({
    mutationFn: () =>
      webhooksApi.create({
        url: url.trim(),
        events: events.length > 0 ? events : ['scan_complete'],
        ...(customSecret.trim() ? { secret: customSecret.trim() } : {}),
      }),
    onSuccess: (data) => {
      onCreated(data.webhook);
      setUrl('');
      setEvents(['scan_complete']);
      setCustomSecret('');
      setShowSecret(false);
    },
  });

  const errorMsg = mutation.isError
    ? isApiError(mutation.error) ? mutation.error.error ?? 'Failed to create webhook.' : 'Failed to create webhook.'
    : null;

  const urlValid = url.trim().startsWith('http');

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="webhook-url" className="block text-xs text-text-tertiary mb-1">
          URL <span className="text-accent-red">*</span>
        </label>
        <input
          id="webhook-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-server.com/webhook"
          className="w-full rounded-lg border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent-blue/40 focus:ring-1 focus:ring-accent-blue/20"
        />
      </div>

      <div>
        <p className="text-xs text-text-tertiary mb-1">Events</p>
        <div className="flex flex-wrap gap-2">
          {KNOWN_EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                id={`webhook-event-${ev}`}
                checked={events.includes(ev)}
                onChange={() => toggleEvent(ev)}
                className="rounded border-white/20"
              />
              <span className="text-xs font-mono text-text-secondary">{ev}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="webhook-secret" className="block text-xs text-text-tertiary mb-1">
          Secret <span className="text-text-tertiary">(leave blank to auto-generate)</span>
        </label>
        <input
          id="webhook-secret"
          type={showSecret ? 'text' : 'password'}
          value={customSecret}
          onChange={(e) => setCustomSecret(e.target.value)}
          placeholder="HMAC-SHA256 signing secret"
          className="w-full rounded-lg border border-white/[0.10] bg-white/[0.05] px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent-blue/40"
        />
        <button
          type="button"
          onClick={() => setShowSecret((v) => !v)}
          className="mt-1 text-[10px] text-accent-blue hover:underline"
        >
          {showSecret ? 'Hide' : 'Show'} secret
        </button>
      </div>

      {errorMsg && <p role="alert" className="text-xs text-accent-red">{errorMsg}</p>}

      <Button
        id="btn-create-webhook"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !urlValid}
        className="w-full"
      >
        {mutation.isPending ? 'Creating…' : 'Add Webhook'}
      </Button>
    </div>
  );
}

export function SettingsPage() {
  const { currentUser: user } = useAuth();
  const queryClient = useQueryClient();
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number; success: boolean; status_code: number } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  // Secret shown once at creation, then discarded from state on next action
  const [creationSecret, setCreationSecret] = useState<{ webhookId: number; secret: string } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['webhooks'] as const,
    queryFn: () => webhooksApi.list(),
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => webhooksApi.delete(id),
    onSuccess: () => {
      setPendingDeleteId(null);
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => webhooksApi.test(id),
    onMutate: (id) => { setTestingId(id); setTestResult(null); },
    onSuccess: (result, id) => {
      setTestingId(null);
      setTestResult({ id, success: result.success, status_code: result.status_code });
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
    onError: () => { setTestingId(null); },
  });

  function handleCreated(webhook: WebhookWithSecret) {
    void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    if (webhook.secret) {
      setCreationSecret({ webhookId: webhook.id, secret: webhook.secret });
    }
  }

  return (
    <AppLayout>
      <div className="page-enter min-h-full space-y-6 p-6">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Settings</h1>
          <p className="mt-1 text-sm text-text-tertiary">Account information and webhook configuration.</p>
        </div>

        {/* Account info — read-only (no profile update endpoint) */}
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-text-primary">Account</h2>
          {user ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: 'Full Name', value: user.full_name },
                { label: 'Email', value: user.email },
                { label: 'Role', value: user.role ?? '—' },
                { label: 'Email Verified', value: user.is_verified ? 'Yes' : 'No' },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</p>
                  <p className="mt-0.5 text-sm text-text-primary">{value}</p>
                </div>
              ))}
            </div>
          ) : (
            <LoadingSpinner size="sm" />
          )}
          <p className="mt-3 text-xs text-text-tertiary">
            Profile editing and 2FA setup are not yet available. Contact your administrator to update account details.
          </p>
        </Card>

        {/* Webhooks */}
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-text-primary">Webhooks</h2>
          <p className="mb-4 text-xs text-text-tertiary">
            Receive HMAC-SHA256 signed HTTP POST notifications when scans complete.
            The signing secret is shown only once after creation — copy it now.
          </p>

          {/* Post-creation secret banner — shown once, then cleared on any action */}
          {creationSecret && (
            <div className="mb-4 rounded-md border border-accent-amber/30 bg-accent-amber/[0.07] p-3 space-y-1">
              <p className="text-xs font-semibold text-accent-amber">⚠ Save your webhook secret now — it won't be shown again</p>
              <code className="block break-all text-xs font-mono text-text-primary select-all">
                {creationSecret.secret}
              </code>
              <button
                type="button"
                id="btn-dismiss-secret"
                className="text-[10px] text-accent-amber/70 hover:underline"
                onClick={() => setCreationSecret(null)}
              >
                I've saved it — dismiss
              </button>
            </div>
          )}

          {isLoading && <div className="flex items-center gap-2 py-4"><LoadingSpinner size="sm" /><span className="text-xs text-text-tertiary">Loading webhooks…</span></div>}
          {isError && <ErrorState title="Failed to load webhooks" onRetry={() => void refetch()} />}

          {!isLoading && !isError && data?.webhooks.length === 0 && (
            <EmptyState title="No webhooks" description="Add a webhook endpoint to receive scan notifications." />
          )}

          {!isLoading && !isError && data && data.webhooks.length > 0 && (
            <div className="space-y-3 mb-5">
              {data.webhooks.map((wh) => (
                <WebhookCard
                  key={wh.id}
                  webhook={wh}
                  onDelete={(id) => setPendingDeleteId(id)}
                  onTest={(id) => testMutation.mutate(id)}
                  isTestingId={testingId}
                  testResult={testResult}
                />
              ))}
            </div>
          )}

          {testMutation.isError && (
            <p className="text-xs text-accent-red mb-3">Webhook test failed. Check the target URL is reachable.</p>
          )}

          <div className="border-t border-white/[0.07] pt-4">
            <h3 className="text-xs font-semibold text-text-secondary mb-3">Add Webhook</h3>
            <CreateWebhookForm onCreated={handleCreated} />
          </div>
        </Card>
      </div>

      {/* Delete confirmation */}
      {pendingDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="max-w-sm w-full">
            <h3 className="text-base font-semibold text-text-primary mb-2">Delete Webhook?</h3>
            <p className="text-sm text-text-tertiary mb-4">This webhook will stop receiving notifications. This cannot be undone.</p>
            {deleteMutation.isError && <p className="text-xs text-accent-red mb-3">Failed to delete. Please try again.</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" id="btn-cancel-delete-webhook" onClick={() => setPendingDeleteId(null)}>Cancel</Button>
              <Button
                variant="danger"
                size="sm"
                id="btn-confirm-delete-webhook"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(pendingDeleteId!)}
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

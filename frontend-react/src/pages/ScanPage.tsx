/**
 * ScanPage — Sentinel scan workflow page.
 *
 * Page states (two-panel approach):
 *   1. FORM  — scan form shown; no active scan
 *   2. PROGRESS — form hidden; scan progress shown with polling
 *
 * After completing a scan the user clicks "View Results" → /results/:id
 *
 * Error cases handled:
 *   400 — missing/invalid field (shown inline)
 *   403 — SELF_SCAN_ONLY identity mismatch (shown inline)
 *   429 — daily quota exceeded (shown inline with hint)
 *   429 — rate limit hit (shown inline with hint)
 *   Network error — shown inline
 *
 * Backend endpoints used:
 *   POST /api/scan/quick  or  POST /api/scan/full
 *   GET  /api/scan/:id/status  (polled via useScanPoll)
 */

import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { ScanForm } from '@/components/scan/ScanForm';
import { ScanProgress } from '@/components/scan/ScanProgress';
import { useScanPoll } from '@/hooks/useScanPoll';
import { scansApi } from '@/api/scans';
import { isApiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import type { ScanMode } from '@/types';

function isPlaceholderEmail(email: string): boolean {
  return email.endsWith('@digilocker.gov.in') || !email.includes('@');
}

export function ScanPage() {
  const { currentUser } = useAuth();

  // ── Scan state machine ────────────────────────────────────────────────────
  const [activeScanId, setActiveScanId] = useState<number | null>(null);
  const [activeScanMode, setActiveScanMode] = useState<ScanMode>('quick');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Polling stops automatically when scan reaches terminal state.
  const { scan, isPolling } = useScanPoll({ scanId: activeScanId });

  // ── Handle form submission ────────────────────────────────────────────────

  async function handleSubmit(mode: ScanMode, username: string, phone: string) {
    setFormError('');
    setIsSubmitting(true);

    const trustedName = (currentUser?.full_name ?? '').trim();
    const trustedEmail = (currentUser?.email ?? '').trim();
    const hasUsableEmail = trustedEmail && !isPlaceholderEmail(trustedEmail);

    try {
      const payload = {
        name: trustedName,
        ...(hasUsableEmail ? { email: trustedEmail } : {}),
        ...(username ? { username } : {}),
        ...(phone ? { phone } : {}),
        self_attested: true as const,
      };

      const { scan: createdScan } = await scansApi.createScan(mode, payload);

      // Switch to progress view.
      setActiveScanMode(mode);
      setActiveScanId(createdScan.id);
    } catch (err: unknown) {
      if (isApiError(err)) {
        const errMsg = (err.error ?? '') as string;
        // Daily quota exceeded
        if (errMsg === 'daily_quota_exceeded' || err.status === 429) {
          const hint =
            typeof err['message'] === 'string' && err['message']
              ? err['message']
              : 'Daily scan quota reached. Please try again tomorrow.';
          setFormError(hint);
        } else if (err.status === 403) {
          setFormError(errMsg || 'You cannot scan another person\'s identity.');
        } else {
          setFormError(errMsg || 'Failed to start scan. Please try again.');
        }
      } else {
        setFormError('Network error. Check your connection and try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Reset to form state ────────────────────────────────────────────────────

  function handleNewScan() {
    setActiveScanId(null);
    setFormError('');
  }

  const showProgress = activeScanId !== null;

  return (
    <AppLayout>
      <div className="page-enter min-h-full p-6">
        <div className="mx-auto max-w-2xl space-y-6">

          {/* ── Page header ────────────────────────────────────────── */}
          <div>
            <h2 className="text-xl font-semibold text-text-primary">
              {showProgress ? 'Scan Progress' : 'New Scan'}
            </h2>
            <p className="mt-1 text-sm text-text-tertiary">
              {showProgress
                ? 'Your scan is running in the background.'
                : 'Run a digital footprint analysis on your identity.'}
            </p>
          </div>

          {/* ── Main card ──────────────────────────────────────────── */}
          <Card>
            {showProgress ? (
              <ScanProgress
                scan={scan}
                isPolling={isPolling}
                mode={activeScanMode}
                onNewScan={handleNewScan}
              />
            ) : (
              <>
                {/* Form error */}
                {formError && (
                  <div
                    id="scan-error"
                    role="alert"
                    className="mb-6 flex items-start gap-2.5 rounded-lg bg-accent-red/10 border border-accent-red/20 px-4 py-3"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-accent-red" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <p className="text-sm text-accent-red">{formError}</p>
                  </div>
                )}

                <ScanForm
                  onScanCreated={(id, mode) => {
                    setActiveScanMode(mode);
                    setActiveScanId(id);
                  }}
                  onError={setFormError}
                  isSubmitting={isSubmitting}
                  onSubmit={(mode, username, phone) =>
                    void handleSubmit(mode, username, phone)
                  }
                />
              </>
            )}
          </Card>

          {/* ── Info cards ─────────────────────────────────────────── */}
          {!showProgress && (
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoCard
                title="Quick Scan"
                body="Searches known social, developer, and professional platforms. Results in ~1 minute."
                accentClass="border-accent-cyan/20 bg-accent-cyan/[0.04]"
              />
              <InfoCard
                title="Full Scan"
                body="Adds deep page scraping, entity extraction, and threat intelligence. Takes ~5 minutes."
                accentClass="border-accent-purple/20 bg-accent-purple/[0.04]"
              />
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function InfoCard({
  title,
  body,
  accentClass,
}: {
  title: string;
  body: string;
  accentClass: string;
}) {
  return (
    <div className={`rounded-lg border p-4 ${accentClass}`}>
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-text-tertiary">{body}</p>
    </div>
  );
}

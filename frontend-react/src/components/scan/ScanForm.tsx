/**
 * ScanForm — scan initiation form for Sentinel.
 *
 * Backend behavior (SELF_SCAN_ONLY=true, the default):
 *   - target_name and target_email are always derived from the authenticated
 *     user's account. The frontend shows them as read-only locked fields.
 *   - Only `username` and `phone` are user-supplied optional extras.
 *   - `self_attested: true` is REQUIRED — the form has a required checkbox.
 *
 * The payload sent is:
 *   {
 *     name: user.full_name,      // locked
 *     email: user.email,         // locked (omitted if placeholder)
 *     username?: string,         // optional, user-supplied
 *     phone?: string,            // optional, user-supplied
 *     self_attested: true        // required checkbox
 *   }
 *
 * Modes:
 *   quick — faster, no page scraping
 *   full  — includes page scraping, entity extraction, deeper analysis
 */

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/shared/Button';
import { useAuth } from '@/hooks/useAuth';
import type { ScanMode } from '@/types';

interface ScanFormProps {
  onScanCreated: (scanId: number, mode: ScanMode) => void;
  onError: (msg: string) => void;
  isSubmitting: boolean;
  onSubmit: (mode: ScanMode, username: string, phone: string) => void;
}

function isPlaceholderEmail(email: string): boolean {
  return email.endsWith('@digilocker.gov.in') || !email.includes('@');
}

export function ScanForm({ onScanCreated: _onScanCreated, onError: _onError, isSubmitting, onSubmit }: ScanFormProps) {
  const { currentUser } = useAuth();
  const [mode, setMode] = useState<ScanMode>('quick');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [selfAttested, setSelfAttested] = useState(false);

  const trustedName = currentUser?.full_name?.trim() ?? '';
  const trustedEmail = currentUser?.email?.trim() ?? '';
  const hasUsableEmail = trustedEmail && !isPlaceholderEmail(trustedEmail);

  function validate(): string | null {
    if (!trustedName) {
      return 'Your account is missing a full name. Update your account before scanning.';
    }
    if (!selfAttested) {
      return 'Confirm the self-scan checkbox before starting.';
    }
    // Phone validation — allow empty, or basic format
    if (phone && !/^[+\d\s\-().]{7,20}$/.test(phone.trim())) {
      return 'Enter a valid phone number or leave it blank.';
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { _onError(err); return; }
    onSubmit(mode, username.trim(), phone.trim());
  }

  return (
    <form
      id="scan-form"
      onSubmit={handleSubmit}
      noValidate
      className="space-y-6"
    >
      {/* ── Mode selector ──────────────────────────────────────────── */}
      <fieldset>
        <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Scan Mode
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              {
                value: 'quick' as ScanMode,
                label: 'Quick Scan',
                desc: 'Fast discovery across known platforms. No page scraping.',
                badge: '~1 min',
                badgeCls: 'bg-accent-cyan/15 text-accent-cyan',
              },
              {
                value: 'full' as ScanMode,
                label: 'Full Scan',
                desc: 'Deep scan including page scraping, entity extraction, and threat intel.',
                badge: '~5 min',
                badgeCls: 'bg-accent-purple/15 text-accent-purple',
              },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              id={`scan-mode-${opt.value}`}
              onClick={() => setMode(opt.value)}
              className={[
                'flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all',
                mode === opt.value
                  ? 'border-accent-blue/50 bg-accent-blue/10 ring-1 ring-accent-blue/30'
                  : 'border-white/[0.07] bg-white/[0.03] hover:border-white/[0.14] hover:bg-white/[0.05]',
              ].join(' ')}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-sm font-semibold text-text-primary">
                  {opt.label}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${opt.badgeCls}`}>
                  {opt.badge}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-text-tertiary">
                {opt.desc}
              </p>
            </button>
          ))}
        </div>
      </fieldset>

      {/* ── Identity section (locked to authenticated user) ─────────── */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Identity
        </p>
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-4">
          <div className="mb-3 flex items-start gap-2 rounded-md bg-accent-blue/10 border border-accent-blue/20 px-3 py-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-accent-blue" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <p className="text-xs text-accent-blue/90">
              Scans are locked to your signed-in profile. You cannot scan another person's data.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Name — read-only */}
            <div>
              <label htmlFor="scan-name" className="mb-1.5 block text-xs font-medium text-text-secondary">
                Full Name <span className="text-text-tertiary">(locked)</span>
              </label>
              <input
                id="scan-name"
                type="text"
                value={trustedName || '—'}
                readOnly
                className={readOnlyInputCls}
              />
            </div>

            {/* Email — read-only */}
            <div>
              <label htmlFor="scan-email" className="mb-1.5 block text-xs font-medium text-text-secondary">
                Email <span className="text-text-tertiary">(locked)</span>
              </label>
              <input
                id="scan-email"
                type="email"
                value={hasUsableEmail ? trustedEmail : ''}
                readOnly
                placeholder={
                  hasUsableEmail
                    ? 'Locked to your account email'
                    : 'No verified email on this account'
                }
                className={readOnlyInputCls}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Optional fields ─────────────────────────────────────────── */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Optional Identity Hints{' '}
          <span className="normal-case font-normal text-text-tertiary/70">
            (must belong to you)
          </span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="scan-username" className="mb-1.5 block text-xs font-medium text-text-secondary">
              Username
            </label>
            <input
              id="scan-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isSubmitting}
              className={inputCls}
              placeholder="e.g. janedoe"
              autoComplete="username"
            />
          </div>

          <div>
            <label htmlFor="scan-phone" className="mb-1.5 block text-xs font-medium text-text-secondary">
              Phone number
            </label>
            <input
              id="scan-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isSubmitting}
              className={inputCls}
              placeholder="e.g. +91 98765 43210"
              autoComplete="tel"
            />
          </div>
        </div>
      </div>

      {/* ── Self-attestation checkbox ─────────────────────────────── */}
      <div>
        <label
          htmlFor="scan-self-attested"
          className={[
            'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-all',
            selfAttested
              ? 'border-accent-green/30 bg-accent-green/[0.07]'
              : 'border-white/[0.07] bg-white/[0.03] hover:border-white/[0.12]',
          ].join(' ')}
        >
          <input
            id="scan-self-attested"
            type="checkbox"
            checked={selfAttested}
            onChange={(e) => setSelfAttested(e.target.checked)}
            disabled={isSubmitting}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent-green"
          />
          <div>
            <p className="text-sm font-medium text-text-primary">
              I confirm this is my own identity data
            </p>
            <p className="mt-0.5 text-xs text-text-tertiary">
              Required by the platform. Scanning another person&apos;s data is prohibited
              and will be blocked.
            </p>
          </div>
        </label>
      </div>

      {/* ── Submit ──────────────────────────────────────────────────── */}
      <Button
        id="btn-start-scan"
        type="submit"
        isLoading={isSubmitting}
        disabled={isSubmitting || !selfAttested}
        className="w-full"
        size="lg"
      >
        {isSubmitting
          ? 'Starting scan…'
          : mode === 'full'
            ? 'Start Full Scan'
            : 'Start Quick Scan'}
      </Button>
    </form>
  );
}

const inputCls = [
  'w-full rounded-lg bg-white/[0.04] px-3.5 py-2.5 text-sm text-text-primary',
  'border border-white/[0.08]',
  'placeholder:text-text-tertiary/60',
  'outline-none transition-colors duration-150',
  'focus:border-accent-blue/40 focus:ring-2 focus:ring-accent-blue/15',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ');

const readOnlyInputCls = [
  'w-full rounded-lg bg-white/[0.02] px-3.5 py-2.5 text-sm',
  'border border-white/[0.05]',
  'text-text-tertiary cursor-default',
  'placeholder:text-text-tertiary/40',
  'outline-none',
].join(' ');

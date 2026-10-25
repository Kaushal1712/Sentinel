/**
 * LoginPage — Sentinel sign-in screen.
 *
 * Backend contract (POST /api/auth/login):
 *   Body: { email: string, password: string }
 *   200:  { message, user } + sets JWT httpOnly cookie
 *   401:  { error: "Invalid email or password" }
 *   423:  { error: "Account is temporarily locked" }
 *   400:  { error: "..." }
 *
 * Auth flow:
 *   1. Submit form → AuthContext.login() → POST /api/auth/login
 *   2. On success: backend sets JWT cookie, AuthContext sets currentUser
 *   3. PublicOnlyRoute detects isAuthenticated → navigate to /dashboard
 *
 * JWT is never read by JavaScript. Cookie handling is fully browser-managed.
 */

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/shared/Button';
import { useAuth } from '@/hooks/useAuth';
import { authApi } from '@/api/auth';
import { isApiError } from '@/api/client';

export function LoginPage() {
  const { login, isAuthenticated, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Already-authenticated users leave the login page immediately.
  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  // ── Email + password submit ────────────────────────────────────────────────

  function validate(): string | null {
    if (!email.trim()) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return 'Enter a valid email address.';
    if (!password) return 'Password is required.';
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    setIsLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      if (isApiError(err)) {
        // 423 = account locked (from backend brute-force protection)
        if (err.status === 423) {
          setError(
            typeof err.error === 'string'
              ? err.error
              : 'Account is temporarily locked. Please try again later.',
          );
        } else {
          setError(
            typeof err.error === 'string' && err.error
              ? err.error
              : 'Invalid email or password.',
          );
        }
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  // ── OAuth popup flow ───────────────────────────────────────────────────────

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'digilocker' | null>(null);

  function clearPoll() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function handleOAuth(provider: 'google' | 'digilocker') {
    setError('');
    setOauthLoading(provider);
    try {
      const status =
        provider === 'google'
          ? await authApi.getGoogleStatus()
          : await authApi.getDigiLockerStatus();

      if (!status.available) {
        setError(status.message || `${provider} integration is not configured on this server.`);
        return;
      }

      const { auth_url } =
        provider === 'google'
          ? await authApi.initGoogle()
          : await authApi.initDigiLocker();

      const popup = window.open(
        auth_url,
        `${provider}-auth`,
        'width=600,height=700,menubar=no,toolbar=no',
      );
      if (!popup) {
        setError('Popup blocked. Please allow popups for this site and try again.');
        return;
      }

      clearPoll();
      // Each tick is 1 200 ms; 100 ticks ≈ 120 s maximum wait.
      let pollTicks = 0;
      const MAX_POLL_TICKS = 100;
      pollRef.current = setInterval(async () => {
        if (popup.closed) { clearPoll(); setOauthLoading(null); return; }

        pollTicks += 1;
        if (pollTicks >= MAX_POLL_TICKS) {
          clearPoll();
          popup.close();
          setOauthLoading(null);
          setError(`${provider} sign-in timed out. Please try again.`);
          return;
        }

        try {
          const user = await refreshUser();
          if (user) {
            clearPoll();
            popup.close();
            navigate('/dashboard', { replace: true });
          }
        } catch {
          // Still waiting for OAuth flow to complete.
        }
      }, 1200);
    } catch (err: unknown) {
      setError(
        isApiError(err) && err.error
          ? err.error
          : `${provider} sign-in failed. Please try again.`,
      );
    } finally {
      setOauthLoading(null);
    }
  }

  useEffect(() => () => clearPoll(), []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AuthLayout>
      <div className="space-y-6">
        {/* Heading */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-text-primary">
            Sign in to Sentinel
          </h2>
          <p className="mt-1.5 text-sm text-text-tertiary">
            Access your intelligence workspace
          </p>
        </div>

        {/* Form */}
        <form
          id="login-form"
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="login-email"
              className="mb-1.5 block text-xs font-medium text-text-secondary"
            >
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              className={inputCls}
              placeholder="you@example.com"
              disabled={isLoading}
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="mb-1.5 block text-xs font-medium text-text-secondary"
            >
              Password
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              className={inputCls}
              placeholder="••••••••••"
              disabled={isLoading}
            />
          </div>

          {/* Error */}
          {error && (
            <div
              id="login-error"
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-accent-red/10 border border-accent-red/20 px-3 py-2.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-accent-red" aria-hidden="true">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="text-sm text-accent-red">{error}</p>
            </div>
          )}

          <Button
            id="btn-login"
            type="submit"
            isLoading={isLoading}
            className="w-full"
          >
            Sign In
          </Button>
        </form>

        {/* Divider */}
        <div className="relative flex items-center gap-3">
          <div className="h-px flex-1 bg-white/[0.07]" />
          <span className="text-[11px] text-text-tertiary">or continue with</span>
          <div className="h-px flex-1 bg-white/[0.07]" />
        </div>

        {/* OAuth */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            type="button"
            data-oauth-provider="google"
            isLoading={oauthLoading === 'google'}
            onClick={() => void handleOAuth('google')}
          >
            Google
          </Button>
          <Button
            variant="secondary"
            type="button"
            data-oauth-provider="digilocker"
            isLoading={oauthLoading === 'digilocker'}
            onClick={() => void handleOAuth('digilocker')}
          >
            DigiLocker
          </Button>
        </div>

        {/* Register link */}
        <p className="text-center text-sm text-text-tertiary">
          Don&apos;t have an account?{' '}
          <Link
            to="/register"
            id="show-register"
            className="font-medium text-accent-blue hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </AuthLayout>
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

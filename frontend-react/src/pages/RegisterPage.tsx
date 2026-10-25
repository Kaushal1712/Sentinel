/**
 * RegisterPage — Sentinel account creation.
 *
 * Backend contract (POST /api/auth/register):
 *   Body: { full_name: string, email: string, password: string }
 *   201:  { message, user } + sets JWT httpOnly cookie
 *   400:  { error: "Email, password, and full name are required" }
 *   400:  { error: "Please enter a valid email address" }
 *   400:  { error: "Password must be at least 10 characters." }
 *   400:  { error: "Password must include upper-case, lower-case, and numeric characters." }
 *   409:  { error: "Email already registered" }
 *
 * Password rules (from backend/auth/routes.py + config.py):
 *   - Minimum 10 characters (PASSWORD_MIN_LENGTH env var default)
 *   - Must include uppercase, lowercase, and digit
 *
 * Only the three fields above are accepted — no others are sent.
 */

import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/shared/Button';
import { useAuth } from '@/hooks/useAuth';
import { isApiError } from '@/api/client';

// Password requirements matching backend/_password_validation_error()
const PASSWORD_MIN_LENGTH = 10;

interface FormFields {
  fullName: string;
  email: string;
  password: string;
}

function validateFields({ fullName, email, password }: FormFields): string | null {
  if (!fullName.trim()) return 'Full name is required.';
  if (fullName.trim().length < 2) return 'Full name must be at least 2 characters.';
  if (!email.trim()) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return 'Enter a valid email address.';
  if (!password) return 'Password is required.';
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password))
    return 'Password must include uppercase, lowercase, and numeric characters.';
  return null;
}

export function RegisterPage() {
  const { register, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) navigate('/dashboard', { replace: true });
  }, [isAuthenticated, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const validationError = validateFields({ fullName, email, password });
    if (validationError) { setError(validationError); return; }

    setIsLoading(true);
    try {
      await register(fullName.trim(), email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      if (isApiError(err)) {
        // 409 = email already registered
        setError(
          typeof err.error === 'string' && err.error
            ? err.error
            : 'Registration failed. Please try again.',
        );
      } else {
        setError('Registration failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-text-primary">
            Create your account
          </h2>
          <p className="mt-1.5 text-sm text-text-tertiary">
            Start analysing your digital footprint
          </p>
        </div>

        <form
          id="register-form"
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="register-name"
              className="mb-1.5 block text-xs font-medium text-text-secondary"
            >
              Full name
            </label>
            <input
              id="register-name"
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => { setFullName(e.target.value); setError(''); }}
              className={inputCls}
              placeholder="Jane Smith"
              disabled={isLoading}
            />
          </div>

          <div>
            <label
              htmlFor="register-email"
              className="mb-1.5 block text-xs font-medium text-text-secondary"
            >
              Email address
            </label>
            <input
              id="register-email"
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
              htmlFor="register-password"
              className="mb-1.5 block text-xs font-medium text-text-secondary"
            >
              Password
            </label>
            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              className={inputCls}
              placeholder={`Min. ${PASSWORD_MIN_LENGTH} chars, upper + lower + digit`}
              disabled={isLoading}
            />
            {/* Inline password hint */}
            <p className="mt-1.5 text-[11px] text-text-tertiary">
              Min. {PASSWORD_MIN_LENGTH} characters · uppercase · lowercase · number
            </p>
          </div>

          {/* Error */}
          {error && (
            <div
              id="register-error"
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
            id="btn-register"
            type="submit"
            isLoading={isLoading}
            className="w-full"
          >
            Create Account
          </Button>
        </form>

        <p className="text-center text-sm text-text-tertiary">
          Already have an account?{' '}
          <Link
            to="/login"
            id="show-login"
            className="font-medium text-accent-blue hover:underline"
          >
            Sign in
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

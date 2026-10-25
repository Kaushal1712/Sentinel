/**
 * ErrorState — displayed when a request or page fails unexpectedly.
 */

import { isApiError } from '@/api/client';

interface ErrorStateProps {
  error?: unknown;
  title?: string;
  description?: string;
  /** Optional retry callback — renders a Retry button. */
  onRetry?: () => void;
}

function getErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 403) return 'You do not have permission to view this.';
    if (error.status === 404) return 'The requested resource was not found.';
    if (error.status === 429) return 'Too many requests. Please wait a moment and try again.';
    if (error.status === 0) return 'Network error. Check your connection and try again.';
    return error.error || 'An unexpected error occurred.';
  }
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}

export function ErrorState({ error, title = 'Something went wrong', description, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-red/10 text-accent-red">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="space-y-1">
        <p className="text-base font-medium text-text-primary">{title}</p>
        <p className="max-w-sm text-sm text-text-tertiary">
          {description ?? (error !== undefined ? getErrorMessage(error) : 'An unexpected error occurred.')}
        </p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 rounded-md bg-accent-blue/10 px-4 py-2 text-sm font-medium text-accent-blue transition-colors hover:bg-accent-blue/20"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * LoadingSpinner — animated spinner for async loading states.
 *
 * Sizes: sm (16px) | md (24px, default) | lg (40px)
 */

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-[3px]',
};

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={[
        'inline-block animate-spin rounded-full',
        'border-text-tertiary border-t-accent-blue',
        sizeMap[size],
        className,
      ].join(' ')}
    />
  );
}

/** Full-page centered loading state used during auth hydration. */
export function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary">
      <div className="flex flex-col items-center gap-4">
        <LoadingSpinner size="lg" />
        <p className="text-sm text-text-tertiary">Loading Sentinel…</p>
      </div>
    </div>
  );
}

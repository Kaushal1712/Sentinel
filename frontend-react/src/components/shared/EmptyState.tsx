/**
 * EmptyState — displayed when a list or query returns no data.
 */

interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export function EmptyState({
  title = 'Nothing here yet',
  description,
  action,
  icon,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      {icon ? (
        <div className="text-text-tertiary opacity-40">{icon}</div>
      ) : (
        <div className="text-text-tertiary opacity-30">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4m0 4h.01" />
          </svg>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-base font-medium text-text-secondary">{title}</p>
        {description && (
          <p className="max-w-xs text-sm text-text-tertiary">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

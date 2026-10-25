/**
 * PlaceholderPage — shown for routes that haven't been implemented yet.
 *
 * Each Phase 3D+ page will replace this with its real implementation.
 * The placeholder confirms routing works and shows a clear "coming in phase N" message.
 */

import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { Link } from 'react-router-dom';

interface PlaceholderPageProps {
  title: string;
  description?: string;
  phase?: string;
}

export function PlaceholderPage({
  title,
  description,
  phase,
}: PlaceholderPageProps) {
  return (
    <AppLayout>
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center p-6">
        <Card className="w-full max-w-md text-center">
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-blue/10 text-accent-blue">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M12 8v4m0 4h.01" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-semibold text-text-primary">{title}</p>
              <p className="mt-1 text-sm text-text-tertiary">
                {description ?? 'This page is being implemented.'}
              </p>
              {phase && (
                <p className="mt-2 text-xs font-medium text-accent-blue">
                  Coming in {phase}
                </p>
              )}
            </div>
            <Link to="/dashboard">
              <Button variant="secondary" size="sm">
                ← Back to Dashboard
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}

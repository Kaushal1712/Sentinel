/**
 * RouteErrorBoundary — catches render-time and lazy-chunk loading failures.
 *
 * Route-level code splitting means a page's JavaScript is fetched on first
 * navigation.  If that fetch fails (network drop, or a new deployment removed
 * the old hashed chunk files) React.lazy rejects and, without a boundary, the
 * whole app would unmount to a blank page.  This boundary shows the existing
 * ErrorState with a reload action instead.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from '@/components/shared/ErrorState';

interface RouteErrorBoundaryProps {
  children: ReactNode;
  /**
   * When this value changes (e.g. the current pathname) a displayed error is
   * cleared so navigating to another route works.  Unlike a React `key`, this
   * does not remount healthy children.
   */
  resetKey?: string;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RouteErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private handleReload = () => {
    // A full reload fetches a fresh index.html that references current chunk names.
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-bg-primary">
          <ErrorState
            title="Failed to load this page"
            description="The page could not be loaded. Check your connection, or the app may have been updated. Reload to try again."
            onRetry={this.handleReload}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

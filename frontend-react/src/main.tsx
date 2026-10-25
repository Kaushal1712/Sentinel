/**
 * main.tsx — application entry point.
 *
 * Provider order (outermost → innermost):
 *   StrictMode            → double-render in dev to surface side-effects
 *   QueryClientProvider   → TanStack Query (server state)
 *   AuthProvider          → global auth state (uses fetch, not TanStack Query)
 *   BrowserRouter         → React Router (path-based)
 *   AppRoutes             → route tree with protected + public-only guards
 *
 * Note: AuthProvider is placed inside QueryClientProvider so that future
 * auth-related queries (if any) can also use the QueryClient.  It is placed
 * outside BrowserRouter because it does not navigate — navigation is done
 * inside pages/guards that have access to React Router.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/context/AuthContext';
import { AppRoutes } from './App';
import './index.css';

// ── TanStack Query client ─────────────────────────────────────────────────────

const queryClient = new QueryClient({
  // Global 401 handler: clear all cached queries and let React Router/guards
  // redirect to /login.  Individual auth routes are excluded.
  queryCache: new QueryCache({
    onError: (error: unknown) => {
      const apiError = error as { status?: number } | null;
      if (apiError?.status === 401) {
        // Invalidate all cached data so stale user-specific data is gone.
        void queryClient.invalidateQueries();
        // Redirect to /login so the user can re-authenticate.
        // Guard against a redirect loop when already on an auth page.
        const { pathname } = window.location;
        if (pathname !== '/login' && pathname !== '/register') {
          window.location.href = '/login';
        }
      }
    },
  }),
  defaultOptions: {
    queries: {
      // Don't retry on 401/403/404 — these are expected states, not transient.
      retry: (failureCount, error: unknown) => {
        const apiError = error as { status?: number } | null;
        if (apiError?.status && [401, 403, 404].includes(apiError.status)) {
          return false;
        }
        return failureCount < 2;
      },
      // Data is considered fresh for 30 seconds by default.
      staleTime: 30_000,
      // Keep unused data in cache for 5 minutes.
      gcTime: 5 * 60_000,
      // Refetch on window focus to keep security-relevant data fresh.
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Mutations never retry automatically — let the user decide.
      retry: false,
    },
  },
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error(
    '[main.tsx] Could not find #root element. Check index.html.',
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

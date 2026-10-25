/**
 * AuthLayout — centered card shell for login and register pages.
 *
 * Provides the dark background, the Sentinel brand mark, and a centered
 * content card.  Feature-specific content is rendered via `children`.
 */

import { type ReactNode } from 'react';

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg-primary px-4 py-12">
      {/* Background gradient orbs — decorative, aria-hidden */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        <div className="absolute -top-40 left-1/4 h-80 w-80 rounded-full bg-accent-blue/10 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 h-80 w-80 rounded-full bg-accent-purple/10 blur-[120px]" />
      </div>

      {/* Brand mark */}
      <div className="relative mb-8 flex flex-col items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-blue/15 ring-1 ring-accent-blue/30">
          {/* Shield icon */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight text-text-primary">
            Sentinel
          </h1>
        </div>
      </div>

      {/* Content card */}
      <div className="relative w-full max-w-md">
        <div className="rounded-xl border border-white/[0.08] bg-bg-secondary/80 p-8 shadow-card-lg backdrop-blur-glass">
          {children}
        </div>
      </div>
    </div>
  );
}

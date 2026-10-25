/**
 * AppLayout — authenticated application shell.
 *
 * Structure:
 *   fixed sidebar (w-sidebar = 260px) + flex main area
 *   Mobile: sidebar slides in/out with overlay
 *   Desktop (lg+): sidebar always visible
 *
 * The Sidebar component handles all navigation and user display.
 * Children render in the scrollable main content area.
 */

import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';

interface AppLayoutProps {
  children: React.ReactNode;
}

/** Derive a readable page title from the current path. */
function usePageTitle(): string {
  const { pathname } = useLocation();
  const segment = pathname.split('/').filter(Boolean)[0] ?? 'dashboard';
  const titles: Record<string, string> = {
    dashboard: 'Dashboard',
    scan:      'New Scan',
    results:   'Results',
    graph:     'Identity Graph',
    geomap:    'Geo Map',
    timeline:  'Timeline',
    heatmap:   'Heatmap',
    datasets:  'Datasets',
    chat:      'Chat with Data',
    visualize: 'Visualize',
    insights:  'AI Insights',
    schedules: 'Schedules',
    catalog:   'Platform Catalog',
    settings:  'Settings',
    admin:     'Admin',
    history:   'History',
    audit:     'Audit Logs',
  };
  return titles[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
}

export function AppLayout({ children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pageTitle = usePageTitle();

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">
      {/* ── Mobile overlay ───────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        id="sidebar"
        aria-label="Main navigation"
        className={[
          'fixed inset-y-0 left-0 z-40 w-sidebar shrink-0',
          'border-r border-white/[0.06] bg-bg-secondary',
          'transition-transform duration-300 ease-in-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:relative lg:translate-x-0',
        ].join(' ')}
      >
        <Sidebar onNavClick={() => setSidebarOpen(false)} />
      </aside>

      {/* ── Main area ────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-white/[0.06] bg-bg-secondary/50 px-6 backdrop-blur-sm">
          {/* Mobile hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            id="mobile-menu-btn"
            aria-label="Open navigation menu"
            className="flex-shrink-0 rounded-md p-1.5 text-text-tertiary hover:bg-white/5 hover:text-text-primary lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {/* Page title */}
          <h1 className="flex-1 truncate text-base font-semibold text-text-primary">
            {pageTitle}
          </h1>

          {/* Right side: status indicator */}
          <div className="flex items-center gap-2 text-xs text-text-tertiary">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-green shadow-glow-green" aria-hidden="true" />
            <span className="hidden sm:inline">Sentinel Active</span>
          </div>
        </header>

        {/* Scrollable page content */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

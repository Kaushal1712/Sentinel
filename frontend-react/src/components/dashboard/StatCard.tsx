/**
 * Dashboard stat card component.
 *
 * Used by DashboardPage to display the 6 stats from GET /api/dashboard/stats.
 * Animates the number from 0 to `value` on mount using requestAnimationFrame.
 */

import { useEffect, useRef, useState } from 'react';

interface StatCardProps {
  label: string;
  value: number;
  /** Display as one decimal place (for avg risk score). */
  decimal?: boolean;
  icon: React.ReactNode;
  /** Tailwind color class for the icon background. e.g. "bg-accent-blue/10 text-accent-blue" */
  colorClass: string;
  /** Optional sub-label shown below the value. */
  sub?: string;
}

function useAnimatedCounter(target: number, decimal: boolean): string {
  const [displayed, setDisplayed] = useState(0);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const DURATION = 600; // ms

  useEffect(() => {
    const start = performance.now();
    startRef.current = start;

    function animate(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / DURATION, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(eased * target);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    }

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [target]);

  return decimal ? displayed.toFixed(1) : Math.round(displayed).toLocaleString();
}

export function StatCard({ label, value, decimal = false, icon, colorClass, sub }: StatCardProps) {
  const displayValue = useAnimatedCounter(value, decimal);

  return (
    <div className="rounded-lg border border-white/[0.07] bg-bg-card p-5 transition-all hover:border-white/[0.12] hover:shadow-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
            {label}
          </p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-text-primary">
            {displayValue}
          </p>
          {sub && (
            <p className="mt-1 text-xs text-text-tertiary">{sub}</p>
          )}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colorClass}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

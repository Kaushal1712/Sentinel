/**
 * TopPlatformsCard — horizontal bar chart using pure CSS.
 *
 * Data source: DashboardResponse.top_platforms
 * No chart library is needed in Phase 3C — the visualization phase adds Recharts.
 * We render simple proportional bars using Tailwind width utilities.
 */

import type { TopPlatform } from '@/types';

interface TopPlatformsCardProps {
  platforms: TopPlatform[];
}

const PLATFORM_COLORS = [
  'bg-accent-blue',
  'bg-accent-purple',
  'bg-accent-green',
  'bg-accent-cyan',
  'bg-accent-amber',
  'bg-accent-red',
];

export function TopPlatformsCard({ platforms }: TopPlatformsCardProps) {
  if (platforms.length === 0) {
    return (
      <p className="text-sm text-text-tertiary">
        No platform data yet.
      </p>
    );
  }

  const maxCount = Math.max(...platforms.map((p) => p.count));

  return (
    <div className="space-y-2.5">
      {platforms.slice(0, 8).map((p, i) => {
        const widthPct = maxCount > 0 ? (p.count / maxCount) * 100 : 0;
        const colorClass = PLATFORM_COLORS[i % PLATFORM_COLORS.length];
        return (
          <div key={p.platform} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-right text-xs text-text-tertiary">
              {p.platform}
            </span>
            <div className="flex-1 overflow-hidden rounded-full bg-white/[0.05]" style={{ height: '8px' }}>
              <div
                className={`h-full rounded-full ${colorClass} opacity-70 transition-all duration-500`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-text-secondary">
              {p.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

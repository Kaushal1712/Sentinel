/**
 * TimelineSparkline — 14-day activity bar chart using pure SVG.
 *
 * Data source: DashboardResponse.timeline (14 TimelinePoint entries)
 * Renders a compact bar chart — no chart library needed in Phase 3C.
 * Full timeline visualization with Recharts goes in the visualization phase.
 */

import type { TimelinePoint } from '@/types';

interface TimelineSparklineProps {
  timeline: TimelinePoint[];
}

export function TimelineSparkline({ timeline }: TimelineSparklineProps) {
  if (timeline.length === 0) {
    return <p className="text-sm text-text-tertiary">No timeline data.</p>;
  }

  const maxScans = Math.max(...timeline.map((t) => t.scans), 1);
  const height = 48;
  const barWidth = Math.floor(100 / timeline.length);
  const gap = 1;

  return (
    <div className="space-y-2">
      {/* Bar chart */}
      <div className="flex items-end gap-0.5" style={{ height: `${height}px` }}>
        {timeline.map((point, i) => {
          const barH = maxScans > 0 ? Math.max((point.scans / maxScans) * height, point.scans > 0 ? 4 : 0) : 0;
          return (
            <div key={i} className="group relative flex-1">
              <div
                className="w-full rounded-sm bg-accent-blue/50 transition-all duration-300 group-hover:bg-accent-blue"
                style={{ height: `${barH}px` }}
                title={`${point.date}: ${point.scans} scan${point.scans !== 1 ? 's' : ''}${point.avg_risk > 0 ? `, avg risk ${point.avg_risk}` : ''}`}
              />
            </div>
          );
          void barWidth; void gap; // suppress unused warning
        })}
      </div>

      {/* Date labels (first and last) */}
      <div className="flex justify-between">
        <span className="text-[10px] text-text-tertiary">
          {timeline[0]?.date?.slice(5) ?? ''}
        </span>
        <span className="text-xs text-text-tertiary">
          {timeline.reduce((s, t) => s + t.scans, 0)} scans in 14 days
        </span>
        <span className="text-[10px] text-text-tertiary">
          {timeline[timeline.length - 1]?.date?.slice(5) ?? ''}
        </span>
      </div>
    </div>
  );
}

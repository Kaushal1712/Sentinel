/**
 * TimelineChart — D3-based horizontal timeline of scan events.
 *
 * Data: GET /api/timeline/:id/events → { events[], total, type_counts, scan_id }
 *
 * Features preserved from old timeline.js:
 *   - D3 time scale on X axis
 *   - Circles colored by risk_level
 *   - Hover tooltip: label, date, detail
 *   - Click node to open URL (if present)
 *   - Type count badges summary
 *
 * Cleanup:
 *   - SVG element is removed on unmount via useEffect return
 *   - Tooltip div is removed on unmount
 *
 * Note: D3 manipulates the SVG container directly. The SVG ref is
 * attached to an empty <div> that D3 owns fully — it does NOT touch
 * any React-managed DOM nodes.
 */

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { EmptyState } from '@/components/shared/EmptyState';
import type { TimelineEvent, TimelineResponse, RiskLevel } from '@/types';

const RISK_COLORS: Record<RiskLevel | string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#3b82f6',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  scan:            'Scan',
  discovery:       'Discovery',
  activity:        'Activity',
  profile_created: 'Profile Created',
  archive:         'Archive',
  breach:          'Breach',
  darkweb:         'Dark Web',
  paste_leak:      'Paste Leak',
};

interface TimelineChartProps {
  data: TimelineResponse;
}

export function TimelineChart({ data }: TimelineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || data.events.length === 0) return;

    const container = containerRef.current;

    // Clean up previous render
    d3.select(container).selectAll('*').remove();

    // Remove any lingering tooltips from previous renders
    d3.selectAll('.dfas-timeline-tooltip').remove();

    const margin = { top: 30, right: 30, bottom: 50, left: 30 };
    const totalWidth = container.clientWidth || 700;
    const width = totalWidth - margin.left - margin.right;
    const height = 160;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', totalWidth)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Parse dates from ISO strings
    const events = data.events
      .map((e) => ({ ...e, parsedDate: new Date(e.date) }))
      .filter((e) => !isNaN(e.parsedDate.getTime()));

    if (events.length === 0) return;

    // X scale — time
    const x = d3.scaleTime()
      .domain(d3.extent(events, (d) => d.parsedDate) as [Date, Date])
      .range([0, width])
      .nice();

    // Axis
    svg.append('g')
      .attr('transform', `translate(0,${height / 2})`)
      .call(
        d3.axisBottom(x)
          // No explicit tickFormat: D3's scaleTime default is an adaptive
          // multi-scale format (years, months, days) chosen per tick.
          .ticks(Math.min(events.length, 6))
      )
      .call((g) => {
        g.select('.domain').attr('stroke', 'rgba(148,163,184,0.3)');
        g.selectAll('.tick line').attr('stroke', 'rgba(148,163,184,0.2)');
        g.selectAll('.tick text')
          .attr('fill', '#94a3b8')
          .attr('font-size', 10)
          .attr('dy', '1.2em');
      });

    // Horizontal guide line
    svg.append('line')
      .attr('x1', 0).attr('x2', width)
      .attr('y1', height / 2).attr('y2', height / 2)
      .attr('stroke', 'rgba(148,163,184,0.2)')
      .attr('stroke-width', 1);

    // Tooltip div — attached to body, removed on cleanup
    const tooltip = d3.select('body')
      .append('div')
      .attr('class', 'dfas-timeline-tooltip')
      .style('position', 'absolute')
      .style('background', '#1e293b')
      .style('border', '1px solid #334155')
      .style('border-radius', '8px')
      .style('padding', '10px 12px')
      .style('color', '#f1f5f9')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('z-index', '9999')
      .style('max-width', '240px')
      .style('opacity', '0')
      .style('box-shadow', '0 4px 6px rgba(0,0,0,0.4)');

    // Nodes
    svg.selectAll<SVGCircleElement, typeof events[0]>('.timeline-node')
      .data(events)
      .enter()
      .append('circle')
      .attr('class', 'timeline-node')
      .attr('cx', (d) => x(d.parsedDate))
      .attr('cy', height / 2)
      .attr('r', 6)
      .attr('fill', (d) => RISK_COLORS[d.risk_level] ?? '#3b82f6')
      .attr('stroke', '#0f172a')
      .attr('stroke-width', 2)
      .style('cursor', (d) => (d.url ? 'pointer' : 'default'))
      .on('mouseover', function (event: MouseEvent, d) {
        d3.select(this).transition().duration(150).attr('r', 10);

        const dateStr = d3.timeFormat('%b %d, %Y')(d.parsedDate);
        const typeLabel = EVENT_TYPE_LABELS[d.type] ?? d.type;

        tooltip
          .html(
            `<strong>${d.label}</strong><br>
             <span style="color:#94a3b8;font-size:10px">${dateStr} · ${typeLabel}</span>
             ${d.detail ? `<br><span style="color:#cbd5e1;font-size:11px">${d.detail.substring(0, 120)}</span>` : ''}`
          )
          .style('left', `${event.pageX + 15}px`)
          .style('top', `${event.pageY - 28}px`)
          .transition().duration(200).style('opacity', '0.97');
      })
      .on('mouseout', function () {
        d3.select(this).transition().duration(150).attr('r', 6);
        tooltip.transition().duration(300).style('opacity', '0');
      })
      .on('click', (_event, d) => {
        if (d.url) window.open(d.url, '_blank', 'noopener,noreferrer');
      });

    return () => {
      // Cleanup D3-owned elements
      d3.select(container).selectAll('*').remove();
      tooltip.remove();
    };
  }, [data]);

  if (data.events.length === 0) {
    return (
      <EmptyState
        title="No timeline events"
        description="No timestamped events were found for this scan."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Type count badges */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(data.type_counts).map(([type, count]) => (
          <span
            key={type}
            className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-medium text-text-secondary"
          >
            {(EVENT_TYPE_LABELS[type] ?? type).toUpperCase()}: {count}
          </span>
        ))}
        <span className="ml-auto text-xs text-text-tertiary self-center">
          {data.total} event{data.total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* D3 canvas */}
      <div
        ref={containerRef}
        className="w-full overflow-x-auto rounded-lg border border-white/[0.07] bg-[#050816] py-2"
        style={{ minHeight: 220 }}
      />

      {/* Risk color legend */}
      <div className="flex flex-wrap gap-4 text-xs text-text-tertiary">
        {Object.entries(RISK_COLORS).map(([level, color]) => (
          <span key={level} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            {level.charAt(0).toUpperCase() + level.slice(1)}
          </span>
        ))}
        <span className="text-text-tertiary/60">· Click event to open URL</span>
      </div>

      {/* Event list (accessible fallback) */}
      <div className="max-h-60 overflow-y-auto rounded-lg border border-white/[0.07] bg-white/[0.02]">
        {data.events.map((event: TimelineEvent, i) => (
          <div
            key={i}
            className="flex items-start gap-3 border-b border-white/[0.04] px-4 py-2.5 last:border-b-0 hover:bg-white/[0.03]"
          >
            <div
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: RISK_COLORS[event.risk_level] ?? '#3b82f6' }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-text-primary truncate">{event.label}</p>
              {event.detail && (
                <p className="text-[10px] text-text-tertiary truncate">{event.detail}</p>
              )}
            </div>
            <span className="shrink-0 text-[10px] text-text-tertiary">
              {new Date(event.date).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

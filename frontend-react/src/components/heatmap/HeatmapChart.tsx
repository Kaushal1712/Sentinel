/**
 * HeatmapChart — D3 adjacency matrix heatmap of identity node relationships.
 *
 * Data: GET /api/heatmap/:id/matrix →
 *   { labels, matrix (n×n), node_types, edge_info, total_nodes, total_edges }
 *
 * Features preserved from old heatmap.js:
 *   - D3 band scales for row/col
 *   - Blue sequential color scale (d3.interpolateBlues) for confidence 0–1
 *   - Diagonal cells styled differently (slate, self-connection)
 *   - Hover tooltip: label pair, confidence %, relationship (from edge_info)
 *   - Yellow highlight stroke on hover
 *   - Row and column labels (truncated at 15 chars, same as backend truncation of 30)
 *   - Rotated column labels (–45°)
 *   - Dynamic cell size based on node count
 *
 * Cleanup:
 *   - SVG and tooltip are removed on unmount/data change.
 *
 * Note: D3 owns the SVG container. React does not manage any DOM inside
 * the containerRef div.
 */

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { EmptyState } from '@/components/shared/EmptyState';
import type { HeatmapMatrixResponse } from '@/types';

// Node type colours from graph_builder.py NODE_COLORS (used for label ticks)
const NODE_TYPE_COLORS: Record<string, string> = {
  name:       '#8b5cf6',
  email:      '#3b82f6',
  phone:      '#ef4444',
  username:   '#10b981',
  platform:   '#f59e0b',
  url:        '#6b7280',
  repository: '#ec4899',
  breach:     '#dc2626',
  metadata:   '#14b8a6',
  document:   '#06b6d4',
  event:      '#a855f7',
};

interface HeatmapChartProps {
  data: HeatmapMatrixResponse;
}

export function HeatmapChart({ data }: HeatmapChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || data.labels.length === 0) return;

    const container = containerRef.current;
    d3.select(container).selectAll('*').remove();
    d3.selectAll('.dfas-heatmap-tooltip').remove();

    const n = data.labels.length;
    const margin = { top: 100, right: 60, bottom: 20, left: 110 };
    const cellSize = Math.min(36, Math.max(10, 480 / n));
    const gridWidth = cellSize * n;
    const gridHeight = cellSize * n;
    const totalWidth = gridWidth + margin.left + margin.right;
    const totalHeight = gridHeight + margin.top + margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', totalWidth)
      .attr('height', totalHeight)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales
    const x = d3.scaleBand<number>()
      .domain(d3.range(n))
      .range([0, gridWidth]);

    const y = d3.scaleBand<number>()
      .domain(d3.range(n))
      .range([0, gridHeight]);

    // Blue scale for confidence
    const colorScale = d3.scaleSequential()
      .interpolator(d3.interpolateBlues)
      .domain([0, 1]);

    // Tooltip
    const tooltip = d3.select('body')
      .append('div')
      .attr('class', 'dfas-heatmap-tooltip')
      .style('position', 'absolute')
      .style('background', '#1e293b')
      .style('border', '1px solid #334155')
      .style('border-radius', '8px')
      .style('padding', '10px 12px')
      .style('color', '#f1f5f9')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('z-index', '9999')
      .style('opacity', '0')
      .style('max-width', '220px')
      .style('box-shadow', '0 4px 6px rgba(0,0,0,0.4)');

    // Draw cells
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const val = data.matrix[row][col];
        if (val <= 0) continue;

        const isDiagonal = row === col;
        const key = `${Math.min(row, col)}-${Math.max(row, col)}`;
        const edgeInfo = data.edge_info[key] ?? null;

        const cellX = x(col) ?? 0;
        const cellY = y(row) ?? 0;
        const bw = x.bandwidth() - 1;
        const bh = y.bandwidth() - 1;

        svg.append('rect')
          .attr('x', cellX)
          .attr('y', cellY)
          .attr('width', bw)
          .attr('height', bh)
          .attr('fill', isDiagonal ? '#334155' : colorScale(val))
          .attr('rx', 2)
          .on('mouseover', function (event: MouseEvent) {
            d3.select(this).attr('stroke', '#fbbf24').attr('stroke-width', 2);

            let html = `<strong>${data.labels[row]}</strong> ↔ <strong>${data.labels[col]}</strong><br>`;
            html += `Confidence: <strong>${(val * 100).toFixed(0)}%</strong>`;
            if (edgeInfo) {
              html += `<br><span style="color:#94a3b8">Relation: ${edgeInfo.relationship}</span>`;
            }
            if (isDiagonal) {
              html = `<strong>${data.labels[row]}</strong><br><span style="color:#94a3b8">Self-connection</span>`;
            }

            tooltip
              .html(html)
              .style('left', `${event.pageX + 15}px`)
              .style('top', `${event.pageY - 28}px`)
              .transition().duration(150).style('opacity', '0.97');
          })
          .on('mouseout', function () {
            d3.select(this).attr('stroke', 'none');
            tooltip.transition().duration(300).style('opacity', '0');
          });
      }
    }

    const fontSize = Math.min(12, cellSize - 2);

    // Row labels
    svg.selectAll('.row-label')
      .data(data.labels)
      .enter()
      .append('text')
      .attr('class', 'row-label')
      .text((d) => d.length > 15 ? d.slice(0, 15) + '…' : d)
      .attr('x', -5)
      .attr('y', (_d, i) => (y(i) ?? 0) + y.bandwidth() / 2)
      .attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .attr('font-size', fontSize)
      .attr('fill', (_d, i) => NODE_TYPE_COLORS[data.node_types[i]] ?? '#94a3b8');

    // Column labels (rotated)
    svg.selectAll('.col-label')
      .data(data.labels)
      .enter()
      .append('text')
      .attr('class', 'col-label')
      .text((d) => d.length > 15 ? d.slice(0, 15) + '…' : d)
      .attr('x', (_d, i) => (x(i) ?? 0) + x.bandwidth() / 2)
      .attr('y', -6)
      .attr('dy', '0.32em')
      .attr('text-anchor', 'start')
      .attr('transform', (_d, i) => {
        // Rotate about the label's own anchor point (column centre, just above grid)
        const xi = (x(i) ?? 0) + x.bandwidth() / 2;
        return `rotate(-45, ${xi}, -6)`;
      })
      .attr('font-size', fontSize)
      .attr('fill', (_d, i) => NODE_TYPE_COLORS[data.node_types[i]] ?? '#94a3b8');

    return () => {
      d3.select(container).selectAll('*').remove();
      tooltip.remove();
    };
  }, [data]);

  if (data.labels.length === 0) {
    return (
      <EmptyState
        title="No heatmap data"
        description="The identity graph has no nodes. Run a full scan to generate relationship data."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="flex gap-4 text-xs text-text-tertiary">
        <span>{data.total_nodes} nodes</span>
        <span>{data.total_edges} edges</span>
        <span className="text-text-tertiary/60">· Hover cell for details</span>
      </div>

      {/* D3 canvas */}
      <div
        ref={containerRef}
        className="overflow-auto rounded-lg border border-white/[0.07] bg-[#050816] p-2"
      />

      {/* Color scale legend */}
      <div className="flex items-center gap-3 text-xs text-text-tertiary">
        <span>Confidence:</span>
        <div className="flex gap-0.5">
          {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((v) => (
            <div
              key={v}
              className="h-3 w-8"
              style={{
                backgroundColor: `hsl(${211 + v * 20},${40 + v * 30}%,${70 - v * 40}%)`,
              }}
              title={`${(v * 100).toFixed(0)}%`}
            />
          ))}
        </div>
        <span>0% → 100%</span>
      </div>
    </div>
  );
}

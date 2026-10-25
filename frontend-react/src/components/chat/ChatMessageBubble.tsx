/**
 * ChatMessageBubble — renders a single chat message.
 *
 * User messages: right-aligned blue bubble.
 * Assistant messages: left-aligned glass card with:
 *   - AI response content
 *   - query_generated: human-readable description (NOT executable code)
 *   - data_result: bounded tabular result (max 200 KB server-side)
 *   - chart_config: chart suggestion metadata
 *
 * Security invariants:
 *   - Content rendered as text (no dangerouslySetInnerHTML)
 *   - query_generated is a backend-produced description string — treated as text
 *   - data_result rows are untrusted data — rendered as table cells
 *   - chart_config is untrusted AI output — rendered as readable metadata only
 *   - No eval(), exec(), or dynamic code execution occurs anywhere
 */

import { useState } from 'react';
import type { ChatMessage, ChartConfig, DatasetRow } from '@/types';

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

const CHART_TYPE_ICONS: Record<string, string> = {
  bar:       '📊',
  line:      '📈',
  pie:       '🥧',
  doughnut:  '🍩',
  scatter:   '⚬',
  polarArea: '🎯',
};

function ChartSuggestion({ config }: { config: ChartConfig }) {
  return (
    <div className="mt-3 rounded-md border border-accent-purple/20 bg-accent-purple/[0.06] p-3">
      <div className="flex items-center gap-2 mb-2">
        <span aria-hidden="true">{CHART_TYPE_ICONS[config.chartType] ?? '📊'}</span>
        <span className="text-xs font-semibold text-accent-purple capitalize">
          Suggested: {config.chartType} chart
        </span>
      </div>
      <p className="text-xs font-medium text-text-primary">{config.title}</p>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-tertiary">
        <span>X: <span className="font-mono text-text-secondary">{config.xColumn}</span></span>
        <span>Y: <span className="font-mono text-text-secondary">{config.yColumn}</span></span>
      </div>
      {config.reasoning && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-text-tertiary italic">
          {config.reasoning}
        </p>
      )}
    </div>
  );
}

function QueryInfo({ description }: { description: string }) {
  return (
    <div className="mt-2.5 rounded-md border border-white/[0.07] bg-white/[0.03] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">
        Query performed
      </p>
      {/* query_generated is a human-readable text description from describe_query() — NOT code */}
      <p className="text-[11px] text-text-secondary">{description}</p>
    </div>
  );
}

function DataResultTable({ rows }: { rows: DatasetRow[] }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const columns = Object.keys(rows[0]);
  const visibleRows = expanded ? rows : rows.slice(0, 5);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          Result data — {rows.length} row{rows.length !== 1 ? 's' : ''}
        </span>
        {rows.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-accent-blue hover:underline"
          >
            {expanded ? 'Show less' : `Show all ${rows.length}`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto rounded-md border border-white/[0.07]">
        <table className="w-full text-[10px]">
          <thead>
            <tr className="border-b border-white/[0.07] bg-white/[0.04]">
              {columns.map((col) => (
                <th key={col} className="px-2 py-1.5 text-left font-mono font-medium text-text-tertiary">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {visibleRows.map((row, i) => (
              <tr key={i} className="hover:bg-white/[0.02]">
                {columns.map((col) => {
                  const val = row[col];
                  return (
                    <td key={col} className="px-2 py-1.5 text-text-secondary max-w-[180px]">
                      <span className="block truncate" title={val !== null ? String(val) : ''}>
                        {val === null || val === undefined
                          ? <span className="text-text-tertiary/40 italic">—</span>
                          : String(val)
                        }
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const isUser = message.role === 'user';
  const time = message.created_at
    ? new Date(message.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] space-y-1">
          <div className="rounded-2xl rounded-br-sm bg-accent-blue/20 px-4 py-2.5 text-sm text-text-primary">
            {message.content}
          </div>
          {time && <p className="text-right text-[10px] text-text-tertiary">{time}</p>}
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex items-start gap-2.5">
      {/* AI avatar */}
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-purple/15 text-sm">
        ✦
      </div>
      <div className="max-w-[85%] space-y-1 flex-1">
        <div className="rounded-2xl rounded-bl-sm border border-white/[0.08] bg-white/[0.04] px-4 py-3">
          <p className="text-sm leading-relaxed text-text-primary whitespace-pre-wrap break-words">
            {message.content}
          </p>

          {/* Query description (text only, not code) */}
          {message.query_generated && (
            <QueryInfo description={message.query_generated} />
          )}

          {/* Bounded data result table */}
          {message.data_result && message.data_result.length > 0 && (
            <DataResultTable rows={message.data_result} />
          )}

          {/* Chart suggestion */}
          {message.chart_config && (
            <ChartSuggestion config={message.chart_config} />
          )}
        </div>
        {time && <p className="text-[10px] text-text-tertiary">{time}</p>}
      </div>
    </div>
  );
}

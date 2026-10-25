/**
 * DatasetChatPage — /datasets/:id/chat
 *
 * Full Chat-with-Dataset experience.
 *
 * Data sources:
 *   - GET /api/dataset/:id             — dataset context (name, cols, rows)
 *   - GET /api/chat/history/:id        — recent 100 messages (bounded, chronological)
 *   - POST /api/chat/message           — send message, receive AI response
 *   - DELETE /api/chat/history/:id     — clear history
 *
 * Security invariants:
 *   - No eval/exec/compile/Function constructor
 *   - No dangerouslySetInnerHTML or innerHTML
 *   - No chat history in localStorage/sessionStorage
 *   - No OpenAI key in frontend
 *   - No full dataset blob loaded — backend processes data server-side
 *   - dataset ownership backend-enforced (user_id filter on every query)
 *   - All AI/LLM output rendered as plain text
 *
 * Architecture note:
 *   The backend's query_generated field contains a human-readable DESCRIPTION
 *   (not executable Python) as of Phase 2C-3. The React frontend never
 *   generates, evaluates, or executes any Python or query expressions.
 *
 * Chart suggestions are embedded in the assistant ChatMessage response (chat_config).
 * There is no standalone /api/chart/suggest endpoint — suggestions come from
 * suggest_chart() which the backend calls internally during send_message().
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { Badge } from '@/components/shared/Badge';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ChatMessageBubble } from '@/components/chat/ChatMessageBubble';
import { datasetsApi } from '@/api/datasets';
import { chatApi } from '@/api/chat';
import { isApiError } from '@/api/client';
import type { ChatMessage } from '@/types';

const MAX_MESSAGE_LENGTH = 1000;

export function DatasetChatPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const id = Number(idParam);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [input, setInput] = useState('');
  // Optimistic message list: history + any in-flight/sent messages
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // ── Dataset context ────────────────────────────────────────────────────────
  const { data: datasetData, isLoading: datasetLoading, isError: datasetError, error: datasetErr } = useQuery({
    queryKey: ['dataset', id] as const,
    queryFn: () => datasetsApi.get(id),
    enabled: !isNaN(id) && id > 0,
    staleTime: 60_000,
    retry: (count, err) => {
      const e = err as { status?: number } | null;
      if (e?.status === 404 || e?.status === 403) return false;
      return count < 2;
    },
  });

  // ── Chat history (bounded: max 100, or 200 server-cap) ─────────────────────
  const { data: historyData, isLoading: historyLoading, isError: historyError } = useQuery({
    queryKey: ['chat-history', id] as const,
    queryFn: () => chatApi.getHistory(id, 100),
    enabled: !isNaN(id) && id > 0 && !!datasetData,
    staleTime: 0,
    gcTime: 0,  // never cache history to avoid showing stale messages
    retry: 1,
  });

  // Seed local messages from history once
  useEffect(() => {
    if (historyData && !historyLoaded) {
      setLocalMessages(historyData.messages);
      setHistoryLoaded(true);
    }
  }, [historyData, historyLoaded]);

  // ── Auto-scroll to bottom ──────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages]);

  // ── Send message mutation ──────────────────────────────────────────────────
  const sendMutation = useMutation({
    mutationFn: (text: string) =>
      chatApi.sendMessage({ message: text, dataset_id: id }),
    onMutate: (text) => {
      // Optimistic: add user message immediately
      const optimisticUser: ChatMessage = {
        id: Date.now(),   // temporary — will be replaced by refetch
        role: 'user',
        content: text,
        query_generated: null,
        data_result: null,
        chart_config: null,
        created_at: new Date().toISOString(),
      };
      setLocalMessages((prev) => [...prev, optimisticUser]);
    },
    onSuccess: (response) => {
      // Append the actual assistant message from the backend
      setLocalMessages((prev) => [...prev, response.message]);
    },
    onError: () => {
      // Remove the optimistic user message on error so user can retry
      setLocalMessages((prev) => {
        // findLastIndex not available in ES2020 — scan backward instead
        let idx = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === 'user') { idx = i; break; }
        }
        return idx >= 0 ? prev.filter((_, i) => i !== idx) : prev;
      });
    },
  });

  // ── Clear history mutation ─────────────────────────────────────────────────
  const clearMutation = useMutation({
    mutationFn: () => chatApi.clearHistory(id),
    onSuccess: () => {
      setLocalMessages([]);
      setHistoryLoaded(false);
      void queryClient.invalidateQueries({ queryKey: ['chat-history', id] });
    },
  });

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || sendMutation.isPending || text.length > MAX_MESSAGE_LENGTH) return;
    setInput('');
    sendMutation.mutate(text);
  }, [input, sendMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Guard: invalid ID ──────────────────────────────────────────────────────
  if (isNaN(id) || id <= 0) {
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center p-6">
          <Card className="max-w-sm text-center">
            <p className="text-sm text-text-tertiary">Invalid dataset ID.</p>
            <Link to="/datasets" className="mt-4 inline-block">
              <Button variant="secondary" size="sm" id="btn-chat-back-invalid">← Datasets</Button>
            </Link>
          </Card>
        </div>
      </AppLayout>
    );
  }

  // ── Guard: dataset loading ─────────────────────────────────────────────────
  if (datasetLoading) {
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </AppLayout>
    );
  }

  // ── Guard: dataset error / 404 ─────────────────────────────────────────────
  if (datasetError) {
    const is404 = isApiError(datasetErr) && datasetErr.status === 404;
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center p-6">
          <Card className="max-w-md text-center">
            <p className="text-base font-semibold text-text-primary">
              {is404 ? 'Dataset not found' : 'Failed to load dataset'}
            </p>
            <Link to="/datasets" className="mt-4 inline-block">
              <Button size="sm" id="btn-chat-back-error">← Datasets</Button>
            </Link>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const ds = datasetData!.dataset;

  const sendErrorMsg = sendMutation.isError
    ? (() => {
        const e = sendMutation.error;
        if (isApiError(e)) {
          if (e.status === 503) return 'AI service unavailable. Ensure OPENAI_API_KEY is set on the server.';
          if (e.status === 429) return 'Rate limit reached (30/hour). Please wait before sending another message.';
          if (e.status === 400) return e.error ?? 'Invalid request.';
          return e.error ?? 'Failed to send message.';
        }
        return 'Network error. Please try again.';
      })()
    : null;

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-4rem)] flex-col">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/[0.07] px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to={`/datasets/${id}`}>
              <Button variant="ghost" size="sm" id="btn-chat-back">← Back</Button>
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-text-primary">{ds.name}</p>
                <Badge variant="default">Chat</Badge>
              </div>
              <p className="text-[10px] text-text-tertiary">
                {ds.row_count.toLocaleString()} rows · {ds.column_count} columns
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {historyData?.limited && (
              <span className="text-[10px] text-text-tertiary">
                Showing last 100 of {historyData.total} messages
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              id="btn-clear-chat"
              disabled={clearMutation.isPending || localMessages.length === 0}
              onClick={() => clearMutation.mutate()}
              title="Clear chat history"
            >
              {clearMutation.isPending ? 'Clearing…' : 'Clear'}
            </Button>
          </div>
        </div>

        {/* ── Message area ──────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
          {/* History loading */}
          {historyLoading && (
            <div className="flex items-center justify-center py-8">
              <LoadingSpinner />
              <span className="ml-3 text-xs text-text-tertiary">Loading history…</span>
            </div>
          )}

          {/* History error */}
          {historyError && (
            <div className="flex justify-center">
              <p className="text-xs text-text-tertiary">Could not load chat history.</p>
            </div>
          )}

          {/* Empty state */}
          {!historyLoading && localMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent-blue/10 text-2xl">
                💬
              </div>
              <p className="text-base font-semibold text-text-primary">Start chatting with your data</p>
              <p className="mt-1.5 text-sm text-text-tertiary max-w-sm">
                Ask questions in plain English about <strong>{ds.name}</strong>.
                The AI will query, analyse, and explain the results.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {[
                  'Show me the top 10 rows',
                  'What are the most common values?',
                  'Summarise numeric columns',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setInput(suggestion)}
                    className="rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-xs text-text-secondary hover:border-white/[0.18] hover:text-text-primary transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {localMessages.map((msg) => (
            <ChatMessageBubble key={msg.id} message={msg} />
          ))}

          {/* Sending indicator */}
          {sendMutation.isPending && (
            <div className="flex items-center gap-2.5 pl-9">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-2 w-2 rounded-full bg-accent-purple/60 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
              <span className="text-xs text-text-tertiary">Analysing…</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Input area ────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-white/[0.07] px-4 py-3 space-y-2">
          {sendErrorMsg && (
            <div role="alert" className="rounded-md border border-accent-red/25 bg-accent-red/[0.07] px-3 py-1.5 text-xs text-accent-red">
              {sendErrorMsg}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <div className="relative flex-1">
              <textarea
                id="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about your dataset… (Enter to send, Shift+Enter for newline)"
                rows={2}
                disabled={sendMutation.isPending}
                className="w-full resize-none rounded-xl border border-white/[0.10] bg-white/[0.05] px-4 py-3 pr-14 text-sm text-text-primary placeholder-text-tertiary outline-none focus:border-accent-blue/40 focus:ring-1 focus:ring-accent-blue/20 disabled:opacity-60"
                aria-label="Message input"
              />
              {/* Character count */}
              {input.length > 800 && (
                <span className="absolute bottom-2 right-3 text-[10px] text-text-tertiary">
                  {input.length}/{MAX_MESSAGE_LENGTH}
                </span>
              )}
            </div>
            <Button
              id="btn-chat-send"
              onClick={handleSend}
              disabled={sendMutation.isPending || !input.trim() || input.trim().length > MAX_MESSAGE_LENGTH}
              className="shrink-0 h-[74px]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              <span className="sr-only">Send</span>
            </Button>
          </div>

          <p className="text-center text-[10px] text-text-tertiary">
            AI-generated responses — may contain errors. Rate limit: 30 messages/hour.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}

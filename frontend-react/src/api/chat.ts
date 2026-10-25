/**
 * Chat + AI Insights API modules.
 *
 * Confirmed endpoints from backend/api/chat.py and backend/api/insights.py:
 *
 * ── Chat ──────────────────────────────────────────────────────────────────────
 *
 *   POST /api/chat/message
 *     Body: { message: string, dataset_id: number }
 *     Auth: Required + rate-limited (30/hour)
 *     200: { message: ChatMessage }
 *     400: { error } — missing fields, dataset still processing
 *     404: { error } — dataset not found / not owned
 *     503: { error } — OpenAI key not configured
 *
 *   GET  /api/chat/history/:dataset_id?limit=100
 *     Auth: Required
 *     200: { messages: ChatMessage[], total: number, limited: boolean }
 *     limit clamped [1, 200] server-side; default 100
 *     Ownership enforced via user_id filter on Dataset first.
 *
 *   DELETE /api/chat/history/:dataset_id
 *     Auth: Required
 *     200: { message: "Chat history cleared" }
 *
 * ── AI Insights ───────────────────────────────────────────────────────────────
 *
 *   POST /api/insights/:id/generate
 *     Auth: Required + rate-limited (10/hour)
 *     Body: empty (no body required by backend)
 *     200: { insights: AiInsight[], dataset_id, dataset_name }
 *     503: { error } — OpenAI not configured
 *     500: { error } — generation failed
 *
 * ── ChatMessage shape (ChatMessage.to_dict()) ─────────────────────────────────
 *   id, role, content, chart_config, query_generated, data_result, created_at
 *
 * ── Chart config shape (from _CHART_SYSTEM_PROMPT in ai_engine.py) ────────────
 *   { chartType, xColumn, yColumn, title, reasoning }
 *   chartType: "bar" | "line" | "pie" | "doughnut" | "scatter" | "polarArea"
 *
 * ── AI Insight shape (from _AUTO_INSIGHTS_PROMPT in ai_engine.py) ─────────────
 *   { title, description, type, importance, relatedColumns }
 *   Same shape as rule-based DatasetInsight — backend uses the same structure.
 *
 * ── Chart suggestions ─────────────────────────────────────────────────────────
 *   chart_config is embedded in the chat message response — NOT a separate endpoint.
 *   The backend calls suggest_chart() internally in send_message().
 *   There is NO standalone /api/chart/suggest endpoint.
 */

import { request } from './client';
import type {
  ChatMessage,
  ChatSendRequest,
  ChatSendResponse,
  ChatHistoryResponse,
  ChatClearResponse,
  AiInsightsResponse,
} from '@/types';

export const chatApi = {
  /** POST /api/chat/message */
  sendMessage(payload: ChatSendRequest): Promise<ChatSendResponse> {
    return request<ChatSendResponse>('/api/chat/message', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** GET /api/chat/history/:dataset_id?limit= */
  getHistory(datasetId: number, limit = 100): Promise<ChatHistoryResponse> {
    const clamped = Math.min(Math.max(limit, 1), 200);
    return request<ChatHistoryResponse>(
      `/api/chat/history/${datasetId}?limit=${clamped}`,
    );
  },

  /** DELETE /api/chat/history/:dataset_id */
  clearHistory(datasetId: number): Promise<ChatClearResponse> {
    return request<ChatClearResponse>(`/api/chat/history/${datasetId}`, {
      method: 'DELETE',
    });
  },
};

export const aiInsightsApi = {
  /**
   * POST /api/insights/:id/generate
   * Requires OpenAI key server-side. Backend returns 503 when key is absent.
   * Body is empty — backend reads nothing from request body.
   */
  generateInsights(datasetId: number): Promise<AiInsightsResponse> {
    return request<AiInsightsResponse>(`/api/insights/${datasetId}/generate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
};

export type { ChatMessage };

/**
 * Webhooks API — confirmed from backend/api/webhooks.py
 *
 * All endpoints require authentication.
 * Ownership enforced via user_id filter.
 *
 * SECURITY NOTE:
 *   - The backend's Webhook.to_dict() does NOT include the secret field.
 *     The secret is only sent by the backend at creation time in the raw
 *     webhook object (before to_dict is applied). After creation the secret
 *     is never returned to the frontend.
 *   - The frontend must show the secret ONCE at creation and then discard it.
 *   - Do NOT log webhook URLs, secrets, or headers.
 *
 * Endpoints:
 *   GET    /api/webhooks/       → { webhooks: Webhook[], total }
 *   POST   /api/webhooks/       → { message, webhook: WebhookWithSecret }
 *     body: { url: string, secret?: string, events?: string[] }
 *     Returns WebhookWithSecret on creation (secret may be present once).
 *   DELETE /api/webhooks/:id    → { message }
 *   POST   /api/webhooks/:id/test → { message, status_code, success }
 *
 * events default: ["scan_complete"]
 * Wildcard event: "*"
 *
 * Known events from pipeline: scan_complete (inferred from fire_webhooks callers)
 */

import { request } from './client';
import type {
  Webhook,
  WebhookWithSecret,
  WebhookListResponse,
  WebhookCreateRequest,
  WebhookCreateResponse,
  WebhookTestResponse,
  GenericMessageResponse,
} from '@/types';

export const webhooksApi = {
  list(): Promise<WebhookListResponse> {
    return request<WebhookListResponse>('/api/webhooks/');
  },

  create(body: WebhookCreateRequest): Promise<WebhookCreateResponse> {
    return request<WebhookCreateResponse>('/api/webhooks/', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  delete(id: number): Promise<GenericMessageResponse> {
    return request<GenericMessageResponse>(`/api/webhooks/${id}`, {
      method: 'DELETE',
    });
  },

  test(id: number): Promise<WebhookTestResponse> {
    return request<WebhookTestResponse>(`/api/webhooks/${id}/test`, {
      method: 'POST',
    });
  },
};

export type { Webhook, WebhookWithSecret };

/**
 * Dataset API module.
 *
 * Endpoints confirmed from backend/api/dataset.py and backend/api/insights.py:
 *
 *   POST /api/dataset/upload
 *     Body: FormData { file, name?, description? }
 *     Auth: Required (rate-limited)
 *     201: { message, dataset: DatasetDetail }
 *     400: { error } — extension, size, column count, row count, quota, etc.
 *     422: { error } — parse failure
 *
 *   GET /api/dataset/list
 *     Auth: Required
 *     200: { datasets: DatasetListItem[], total: number }
 *
 *   GET /api/dataset/:id
 *     Auth: Required (user_id filter = ownership)
 *     200: { dataset: DatasetDetail }  ← includes columns[] and summary{}
 *     404: { error }
 *
 *   GET /api/dataset/:id/data?page=1&page_size=50
 *     Auth: Required
 *     200: { data: Row[], total, page, page_size, total_pages }
 *     page_size clamped [1,200] server-side
 *
 *   DELETE /api/dataset/:id
 *     Auth: Required
 *     200: { message }
 *     404: { error }
 *
 *   GET /api/insights/:id/summary
 *     Auth: Required
 *     200: { summary, columns, insights[], dataset_id }
 *     (works WITHOUT an OpenAI key — rule-based only)
 *
 * Accepted upload formats: .csv, .xlsx, .xls
 * Max size: MAX_UPLOAD_SIZE_MB (default 16 MB)
 * Max rows: MAX_DATASET_ROWS (default 10 000)
 * Max cols: MAX_DATASET_COLUMNS (default 500)
 * Max desc len: MAX_DATASET_DESCRIPTION_LENGTH (default 1 000)
 * Max datasets: MAX_DATASETS_PER_USER (default 20)
 */

import { request, requestFormData } from './client';
import type {
  DatasetListItem,
  DatasetListResponse,
  DatasetDetail,
  DatasetDetailResponse,
  DatasetDataResponse,
  DatasetDeleteResponse,
  DatasetSummaryResponse,
  DatasetUploadResponse,
} from '@/types';

export const datasetsApi = {
  /** GET /api/dataset/list — lightweight card data */
  list(): Promise<DatasetListResponse> {
    return request<DatasetListResponse>('/api/dataset/list');
  },

  /** GET /api/dataset/:id — full detail with columns[] and summary{} */
  get(id: number): Promise<DatasetDetailResponse> {
    return request<DatasetDetailResponse>(`/api/dataset/${id}`);
  },

  /**
   * GET /api/dataset/:id/data — paginated rows.
   * page_size max 200, clamped server-side.
   */
  getData(id: number, page = 1, pageSize = 50): Promise<DatasetDataResponse> {
    return request<DatasetDataResponse>(
      `/api/dataset/${id}/data?page=${page}&page_size=${pageSize}`,
    );
  },

  /** DELETE /api/dataset/:id */
  delete(id: number): Promise<DatasetDeleteResponse> {
    return request<DatasetDeleteResponse>(`/api/dataset/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * POST /api/dataset/upload — multipart/form-data.
   * Uses requestFormData so no Content-Type header is manually set
   * (the browser sets the correct boundary automatically).
   */
  upload(file: File, name?: string, description?: string): Promise<DatasetUploadResponse> {
    const fd = new FormData();
    fd.append('file', file);
    if (name?.trim()) fd.append('name', name.trim());
    if (description?.trim()) fd.append('description', description.trim());
    return requestFormData<DatasetUploadResponse>('/api/dataset/upload', fd);
  },

  /**
   * GET /api/insights/:id/summary — rule-based stats and insights.
   * Does NOT require an OpenAI key (separate from AI Insights in Phase 3H).
   */
  getSummary(id: number): Promise<DatasetSummaryResponse> {
    return request<DatasetSummaryResponse>(`/api/insights/${id}/summary`);
  },
};

// Re-export types used by components so they don't need two imports
export type { DatasetListItem, DatasetDetail };

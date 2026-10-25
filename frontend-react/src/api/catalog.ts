/**
 * Catalog API — confirmed from backend/api/catalog.py
 *
 * GET /api/catalog/platforms
 *   Auth: required
 *   → { catalog: { platforms: PlatformEntry[] }, summary: CatalogSummary, storage_label: string }
 *
 * PUT /api/catalog/platforms
 *   Auth: required + @require_admin (admin/analyst role only)
 *   Body: { catalog: { platforms: PlatformEntry[] } }
 *   → { message, catalog: { platforms: PlatformEntry[] }, summary: CatalogSummary, storage_label: string }
 *   400: { error } — validation failure (duplicate name, missing url_template, bad match type, etc.)
 *
 * PlatformEntry fields (from validate_platform_catalog in platform_catalog.py):
 *   name, url_template, category, match, dork_site, enumerate, search_priority, confidence
 *
 * CatalogSummary fields (from get_platform_catalog_summary):
 *   total_platforms, enumerated_platforms, search_priority_platforms, categories
 */

import { request } from './client';
import type {
  PlatformEntry,
  CatalogSummary,
  CatalogResponse,
  CatalogUpdateResponse,
} from '@/types';

export const catalogApi = {
  get(): Promise<CatalogResponse> {
    return request<CatalogResponse>('/api/catalog/platforms');
  },

  update(platforms: PlatformEntry[]): Promise<CatalogUpdateResponse> {
    return request<CatalogUpdateResponse>('/api/catalog/platforms', {
      method: 'PUT',
      body: JSON.stringify({ catalog: { platforms } }),
    });
  },
};

export type { PlatformEntry, CatalogSummary };

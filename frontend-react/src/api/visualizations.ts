/**
 * Visualization API modules.
 *
 * Graph:    GET /api/results/:id/graph   → { scan, graph: { nodes, edges } }
 * Geo:      GET /api/geo/:id/data        → GeoJSON FeatureCollection
 * Timeline: GET /api/timeline/:id/events → { events[], total, type_counts, scan_id }
 * Heatmap:  GET /api/heatmap/:id/matrix  → { labels, matrix, node_types, edge_info, ... }
 *
 * All endpoints require authentication (JWT httpOnly cookie).
 * All respect scan ownership via get_owned_scan().
 */

import { request } from './client';
import type {
  GraphResponse,
  GeoFeatureCollection,
  TimelineResponse,
  HeatmapMatrixResponse,
} from '@/types';

export const graphApi = {
  /** GET /api/results/:id/graph — Cytoscape.js node+edge data */
  getGraph(scanId: number): Promise<GraphResponse> {
    return request<GraphResponse>(`/api/results/${scanId}/graph`);
  },
};

export const geoApi = {
  /** GET /api/geo/:id/data — GeoJSON FeatureCollection of geolocated IPs */
  getGeoData(scanId: number): Promise<GeoFeatureCollection> {
    return request<GeoFeatureCollection>(`/api/geo/${scanId}/data`);
  },
};

export const timelineApi = {
  /** GET /api/timeline/:id/events — sorted timeline event list */
  getTimelineEvents(scanId: number): Promise<TimelineResponse> {
    return request<TimelineResponse>(`/api/timeline/${scanId}/events`);
  },
};

export const heatmapApi = {
  /** GET /api/heatmap/:id/matrix — adjacency confidence matrix */
  getHeatmapMatrix(scanId: number): Promise<HeatmapMatrixResponse> {
    return request<HeatmapMatrixResponse>(`/api/heatmap/${scanId}/matrix`);
  },
};

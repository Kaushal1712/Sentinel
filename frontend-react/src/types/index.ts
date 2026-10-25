/**
 * Core TypeScript types for Sentinel.
 *
 * All shapes are derived directly from backend to_dict() methods and
 * route response bodies. No fields are invented.
 */

// ── User ──────────────────────────────────────────────────────────────────────

export type UserRole = 'user' | 'admin' | 'analyst' | 'viewer';

export interface UserCapabilities {
  manage_catalog: boolean;
}

/**
 * Shape from User.to_dict() — returned by /api/auth/me and /api/auth/login.
 * Note: `last_login` is NOT in the backend to_dict() — omitted intentionally.
 */
export interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  is_verified: boolean;
  aadhaar_last4: string | null;
  capabilities: UserCapabilities;
  created_at: string; // ISO 8601
}

// ── Authentication ────────────────────────────────────────────────────────────

export interface AuthResponse {
  message: string;
  user: User;
}

export interface MeResponse {
  user: User;
}

// ── Scan ──────────────────────────────────────────────────────────────────────

export type ScanMode = 'quick' | 'full';
export type ScanStatus = 'pending' | 'running' | 'completed' | 'failed';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Shape from Scan.to_dict() — confirmed from database.py.
 */
export interface Scan {
  id: number;
  target_name: string;
  target_email: string | null;
  target_username: string | null;
  target_phone: string | null;
  mode: ScanMode;
  status: ScanStatus;
  progress: number; // 0–100
  current_stage: string | null;
  risk_score: number | null; // 0–10
  platforms_found: number;
  entities_found: number;
  task_id: string | null;
  execution_backend: string | null;
  created_at: string; // ISO 8601
  completed_at: string | null;
}

// ── Scan Results ──────────────────────────────────────────────────────────────

export type ScanResultCategory = 'social' | 'dev' | 'developer' | 'professional' | 'forum' | 'other';

/**
 * Shape from ScanResult.to_dict() — confirmed from database.py.
 */
export interface ScanResult {
  id: number;
  platform: string;
  url: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  confidence: number;          // 0.0–1.0
  risk_level: RiskLevel;
  category: ScanResultCategory;
  match_score: number | null;  // 0.0–1.0
  match_reasons: string[];
  metadata: Record<string, unknown>;
  evidence_available: boolean;
  evidence_filename: string | null;
  emails_found: string[];
  phones_found: string[];
  last_seen_at: string | null; // ISO 8601
  discovered_at: string;       // ISO 8601
}

/**
 * Response from GET /api/scan/:id/results
 */
export interface ScanResultsResponse {
  scan: Scan;
  results: ScanResult[];
  total: number;
}

// ── Risk Report ───────────────────────────────────────────────────────────────

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface FindingDetail {
  detail: string;
  source: string;
}

export interface ReportFinding {
  type: string;
  title: string;
  severity: FindingSeverity;
  description: string;
  recommendation: string;
  occurrences: number;
  details: FindingDetail[];
}

export interface ReportRecommendation {
  priority: FindingSeverity;
  action: string;
  related_finding: string;
}

export interface ReportStatistics {
  node_types?: Record<string, number>;
  [key: string]: unknown;
}

export interface ExposurePoint {
  node_id?: string;
  label?: string;
  score?: number;
  [key: string]: unknown;
}

/**
 * Shape of report object inside GET /api/results/:id/report response.
 * Confirmed from core/reporter.py ReportGenerator.generate_report().
 */
export interface RiskReport {
  scan_id: number;
  target_name: string;
  generated_at: string;        // ISO 8601
  risk_score: number;          // 0–10
  risk_level: string;          // low | medium | high | critical
  summary: string;
  statistics: ReportStatistics;
  findings: ReportFinding[];
  top_exposure_points: ExposurePoint[];
  recommendations: ReportRecommendation[];
}

export interface ScanReportResponse {
  report: RiskReport;
}

// ── Evidence ──────────────────────────────────────────────────────────────────

/**
 * Single evidence file entry from GET /api/evidence/:id.
 * Confirmed from core/evidence.py list_evidence().
 */
export interface EvidenceFile {
  filename: string;
  size_bytes: number;
  created_at: string; // ISO 8601
}

export interface EvidenceListResponse {
  scan_id: number;
  count: number;
  evidence: EvidenceFile[];
}

/**
 * Raw JSON contents returned by GET /api/evidence/:id/:filename.
 * The schema is unstructured — it's whatever the scraper saved.
 * We type it as a loose record and render known fields defensively.
 */
export type EvidenceDetail = Record<string, unknown>;


/**
 * stats sub-object from GET /api/dashboard/stats.
 */
export interface DashboardStats {
  total_scans: number;
  completed_scans: number;
  running_scans: number;
  avg_risk_score: number;
  total_profiles_found: number;
  total_entities_found: number;
}

/**
 * Single point in the 14-day timeline array.
 */
export interface TimelinePoint {
  date: string; // "YYYY-MM-DD"
  scans: number;
  avg_risk: number;
}

/**
 * Top platform entry.
 */
export interface TopPlatform {
  platform: string;
  count: number;
}

/**
 * Full response shape for GET /api/dashboard/stats.
 * Confirmed from backend/api/dashboard.py.
 */
export interface DashboardResponse {
  stats: DashboardStats;
  recent_scans: Scan[];
  top_platforms: TopPlatform[];
  timeline: TimelinePoint[];
}

// ── API Error ─────────────────────────────────────────────────────────────────

export interface ApiError {
  status: number;
  error: string;
  [key: string]: unknown;
}

// ── Dataset Studio ─────────────────────────────────────────────────────────────
// Confirmed from backend/api/dataset.py and database.py Dataset model.

/** Lightweight card item from GET /api/dataset/list (_dataset_list_item). */
export interface DatasetListItem {
  id: number;
  name: string;
  original_filename: string;
  description: string | null;
  row_count: number;
  column_count: number;
  file_size_bytes: number;
  upload_status: 'ready' | 'processing' | string;
  created_at: string | null;  // ISO 8601
}

export interface DatasetListResponse {
  datasets: DatasetListItem[];
  total: number;
}

/**
 * Per-column profile from _generate_column_summary() in dataset.py.
 * Numeric fields (min/max/mean/median/std) are only present for integer/float columns.
 * top_values is only present for categorical columns.
 */
export interface DatasetColumnInfo {
  name: string;
  dtype: 'boolean' | 'integer' | 'float' | 'datetime' | 'categorical' | 'text';
  missing_count: number;
  missing_pct: number;     // 0–100
  unique_count: number;
  // numeric only
  min?: number | null;
  max?: number | null;
  mean?: number | null;
  median?: number | null;
  std?: number | null;
  // categorical only
  top_values?: Record<string, number>;
}

/** Correlation pair from _generate_summary_stats(). Present when ≥2 numeric cols. */
export interface CorrelationPair {
  col1: string;
  col2: string;
  value: number;  // -1.0 to 1.0
}

/**
 * Dataset-level summary from _generate_summary_stats() in dataset.py.
 * Stored in dataset.summary_json; deserialized by Dataset.to_dict().
 */
export interface DatasetSummaryStats {
  total_rows: number;
  total_columns: number;
  total_missing: number;
  total_duplicates: number;
  numeric_columns: number;
  categorical_columns: number;
  memory_usage_bytes: number;
  top_correlations?: CorrelationPair[];  // only when ≥2 numeric cols
}

/**
 * Full dataset detail from GET /api/dataset/:id (Dataset.to_dict()).
 * Includes columns[] and summary{} (no data_json — use /data endpoint for rows).
 */
export interface DatasetDetail {
  id: number;
  name: string;
  original_filename: string;
  description: string | null;
  row_count: number;
  column_count: number;
  columns: DatasetColumnInfo[];
  summary: DatasetSummaryStats;
  file_size_bytes: number;
  upload_status: 'ready' | 'processing' | string;
  created_at: string | null;
}

export interface DatasetDetailResponse {
  dataset: DatasetDetail;
}

export interface DatasetUploadResponse {
  message: string;
  dataset: DatasetDetail;
}

export interface DatasetDeleteResponse {
  message: string;
}

/**
 * Paginated data row response from GET /api/dataset/:id/data.
 * Each row is a dict of { column_name: value }.
 */
export type DatasetRow = Record<string, string | number | boolean | null>;

export interface DatasetDataResponse {
  data: DatasetRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * Rule-based (non-AI) insight from GET /api/insights/:id/summary.
 * Confirmed from insights.py get_dataset_summary().
 */
export type InsightType = 'summary' | 'outlier' | 'distribution' | 'correlation' | string;
export type InsightImportance = 'high' | 'medium' | 'low';

export interface DatasetInsight {
  title: string;
  description: string;
  type: InsightType;
  importance: InsightImportance;
  relatedColumns: string[];
}

/**
 * Response from GET /api/insights/:id/summary.
 * Works without an OpenAI key. Contains rule-based insights only.
 */
export interface DatasetSummaryResponse {
  summary: DatasetSummaryStats;
  columns: DatasetColumnInfo[];
  insights: DatasetInsight[];
  dataset_id: number;
}

// ── Chat-with-Dataset ──────────────────────────────────────────────────────────
// Confirmed from backend/api/chat.py and database.py ChatMessage model.

/**
 * Chart config shape from _CHART_SYSTEM_PROMPT in ai_engine.py.
 * Returned as chart_config in ChatMessage.
 * chartType values match the prompt allowlist exactly.
 */
export type ChartType = 'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'polarArea';

export interface ChartConfig {
  chartType: ChartType;
  xColumn: string;
  yColumn: string;
  title: string;
  reasoning: string;
}

/**
 * ChatMessage — from ChatMessage.to_dict() in database.py.
 * Role is either "user" or "assistant".
 * query_generated is a human-readable description (NOT executable code — Phase 2C-3 hardening).
 * data_result is capped at 200 KB by the backend before storage and response.
 * chart_config is present on assistant messages when AI suggests a chart.
 */
export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  query_generated: string | null;
  data_result: DatasetRow[] | null;  // bounded, 200 KB cap server-side
  chart_config: ChartConfig | null;
  created_at: string;  // ISO 8601
}

/** POST /api/chat/message request body */
export interface ChatSendRequest {
  message: string;
  dataset_id: number;
}

/** POST /api/chat/message success response */
export interface ChatSendResponse {
  message: ChatMessage;
}

/**
 * GET /api/chat/history/:dataset_id response.
 * messages: chronological order, most-recent `limit` messages (default 100, max 200).
 * limited: true when total > limit (older messages omitted).
 */
export interface ChatHistoryResponse {
  messages: ChatMessage[];
  total: number;
  limited: boolean;
}

/** DELETE /api/chat/history/:dataset_id response */
export interface ChatClearResponse {
  message: string;
}

// ── AI Insights ────────────────────────────────────────────────────────────────
// Confirmed from backend/api/insights.py generate_insights endpoint
// and _AUTO_INSIGHTS_PROMPT in ai_engine.py.
// AI insights have the same structure as rule-based DatasetInsight.
// They are distinguished in the UI by source, not by type shape.

/**
 * POST /api/insights/:id/generate response.
 * insights[] has same shape as DatasetInsight (title/description/type/importance/relatedColumns).
 * Backend returns 503 when OPENAI_API_KEY is absent.
 */
export interface AiInsightsResponse {
  insights: DatasetInsight[];
  dataset_id: number;
  dataset_name: string;
}

// and IdentityNode.to_dict() / IdentityEdge.to_dict() in database.py.
// NODE_COLORS and NODE_SHAPES are in graph_builder.py.

export type NodeType =
  | 'name'
  | 'email'
  | 'phone'
  | 'username'
  | 'platform'
  | 'url'
  | 'repository'
  | 'breach'
  | 'metadata'
  | 'document'
  | 'event'
  | string; // extensible

/** data field inside each Cytoscape node object */
export interface GraphNodeData {
  id: string;       // node_id
  type: NodeType;   // node_type
  label: string;
  risk_level: RiskLevel;
  // Metadata fields flattened by IdentityNode.to_dict()
  [key: string]: unknown;
}

/** data field inside each Cytoscape edge object */
export interface GraphEdgeData {
  source: string;       // source_id
  target: string;       // target_id
  relationship: string; // e.g. "found_on", "linked_to", "associated_with"
  confidence: number;   // 0.0–1.0
}

export interface CytoscapeNode { data: GraphNodeData }
export interface CytoscapeEdge { data: GraphEdgeData }

export interface CytoscapeGraph {
  nodes: CytoscapeNode[];
  edges: CytoscapeEdge[];
}

/**
 * Response from GET /api/results/:id/graph
 */
export interface GraphResponse {
  scan: Scan;
  graph: CytoscapeGraph;
}

// ── Geo / GeoJSON ──────────────────────────────────────────────────────────────
// Confirmed from backend/api/geo.py GET /api/geo/:id/data
// Returns a GeoJSON FeatureCollection.

export interface GeoFeatureProperties {
  ip: string;
  city: string;
  country: string;
  isp: string;
  organization: string;
  open_ports: number[];
  vulns: string[];
  risk_level: RiskLevel;
  platform: string;
}

export interface GeoFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: GeoFeatureProperties;
}

export interface GeoFeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
  total: number;
}

// ── Timeline ───────────────────────────────────────────────────────────────────
// Confirmed from backend/api/timeline.py GET /api/timeline/:id/events

export type TimelineEventType =
  | 'scan'
  | 'discovery'
  | 'activity'
  | 'profile_created'
  | 'archive'
  | 'breach'
  | 'darkweb'
  | 'paste_leak'
  | string;

export interface TimelineEvent {
  date: string;         // ISO 8601
  timestamp: number;    // Unix epoch seconds
  type: TimelineEventType;
  label: string;
  detail: string;
  risk_level: RiskLevel;
  url: string;
}

export interface TimelineResponse {
  events: TimelineEvent[];
  total: number;
  type_counts: Record<string, number>;
  scan_id: number;
}

// ── Heatmap ────────────────────────────────────────────────────────────────────
// Confirmed from backend/api/heatmap.py GET /api/heatmap/:id/matrix

export interface HeatmapEdgeInfo {
  relationship: string;
  confidence: number;
}

export interface HeatmapMatrixResponse {
  labels: string[];
  matrix: number[][];        // n×n confidence matrix (0.0–1.0)
  node_types: string[];      // parallel array to labels
  edge_info: Record<string, HeatmapEdgeInfo>; // key: "minIdx-maxIdx"
  total_nodes: number;
  total_edges: number;
}


// ── Phase 3I: Automation & Configuration ──────────────────────────────────────

export interface GenericMessageResponse { message: string; }

// Schedules — from backend/api/schedule.py + ScheduledScan.to_dict()
export type Frequency = 'daily' | 'weekly' | 'monthly';
export interface ScheduledScan {
  id: number; user_id: number; target_username: string;
  frequency: Frequency; last_run: string | null; next_run: string | null;
  notify_on_change: boolean; active: boolean; created_at: string;
}
export interface ScheduleListResponse { schedules: ScheduledScan[]; total: number; }
export interface ScheduleCreateRequest { target_username: string; frequency: Frequency; notify_on_change?: boolean; }
export interface ScheduleUpdateRequest { frequency?: Frequency; notify_on_change?: boolean; active?: boolean; }
export interface ScheduleMutationResponse { message: string; schedule: ScheduledScan; }

// Webhooks — from backend/api/webhooks.py + Webhook.to_dict()
// SECURITY: to_dict() omits secret; only returned once at creation.
export interface Webhook {
  id: number; url: string; events: string[]; active: boolean;
  last_triggered: string | null; last_status_code: number | null; created_at: string;
}
export interface WebhookWithSecret extends Webhook { secret?: string; }
export interface WebhookListResponse { webhooks: Webhook[]; total: number; }
export interface WebhookCreateRequest { url: string; secret?: string; events?: string[]; }
export interface WebhookCreateResponse { message: string; webhook: WebhookWithSecret; }
export interface WebhookTestResponse { message: string; status_code: number; success: boolean; }

// Audit Logs — from backend/api/audit.py + AuditLog.to_dict()
export interface AuditLogEntry {
  id: number; user_id: number | null; event_type: string; target: string | null;
  details: Record<string, unknown> | null; ip_address: string | null; created_at: string;
}
export interface AuditLogsResponse { logs: AuditLogEntry[]; total: number; page: number; pages: number; per_page: number; }
export interface AuditEventTypesResponse { event_types: string[]; }

// Platform Catalog — from backend/core/platform_catalog.py validate_platform_catalog()
export interface PlatformEntry {
  name: string; url_template: string; category: string;
  match: 'path' | 'query' | 'subdomain'; dork_site: string;
  enumerate: boolean; search_priority: boolean; confidence: number;
}
export interface CatalogSummary {
  total_platforms: number; enumerated_platforms: number;
  search_priority_platforms: number; categories: Record<string, number>;
}
export interface CatalogResponse { catalog: { platforms: PlatformEntry[] }; summary: CatalogSummary; storage_label: string; }
export interface CatalogUpdateResponse { message: string; catalog: { platforms: PlatformEntry[] }; summary: CatalogSummary; storage_label: string; }

// Admin — from backend/api/admin.py + User.to_dict()
// UserRole is defined at the top of this file (now includes 'viewer').
export interface AdminStats {
  total_users: number; total_scans: number; scans_this_week: number; scans_this_month: number;
  scans_by_status: { completed: number; failed: number; running: number; };
  average_risk_score: number;
  top_targets: Array<{ username: string; count: number }>;
  scans_per_user: Array<{ email: string; count: number }>;
}
export interface AdminUser {
  id: number; email: string; full_name: string; aadhaar_last4: string | null;
  is_verified: boolean; role: UserRole; capabilities: { manage_catalog: boolean };
  created_at: string; scan_count: number; max_scans_per_day: number | null; has_2fa: boolean;
}
export interface AdminUsersResponse { users: AdminUser[]; total: number; }
export interface AdminUserMutationResponse { message: string; user: User; }

// Settings — GAP: No profile update / 2FA setup endpoint exists in the backend.
// Settings page is READ-ONLY. Profile info comes from useAuth() / AuthContext.

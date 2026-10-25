"""Prometheus metric definitions for Sentinel.

All metric objects are module-level singletons.  Import and use them
directly — prometheus_client handles thread-safe updates.

LABEL CARDINALITY POLICY:
All labels in this module use bounded/low-cardinality values only.
No user_id, scan_id, email, username, URL, dataset name, task_id,
or other unbounded identifiers are ever used as metric labels.
"""

from prometheus_client import Counter, Gauge

# ---------------------------------------------------------------------------
# Scan metrics
# ---------------------------------------------------------------------------

# Incremented once per scan at its terminal state (completed or failed).
# Labels:  status ∈ {"completed", "failed"}
SCANS_TOTAL = Counter(
    "dfas_scans_total",
    "Total number of scans that have reached a terminal state.",
    ["status"],
)

# Current number of scans actively executing in the pipeline.
# Incremented when a scan transitions to "running".
# Decremented when a scan transitions to "completed" or "failed".
ACTIVE_SCANS = Gauge(
    "dfas_active_scans",
    "Number of scans currently in the running state.",
)

# ---------------------------------------------------------------------------
# HTTP request metrics
# ---------------------------------------------------------------------------

# Incremented after every HTTP response.
# Labels:
#   method   ∈ {"GET", "POST", "PUT", "DELETE", "PATCH", ...}
#   endpoint — Flask endpoint name (e.g. "scan.start_quick_scan"),
#              normalized to avoid path-parameter cardinality explosion.
#   status   — HTTP status code as a string (e.g. "200", "404", "500")
HTTP_REQUESTS_TOTAL = Counter(
    "dfas_http_requests_total",
    "Total HTTP requests handled by the application.",
    ["method", "endpoint", "status"],
)

# ---------------------------------------------------------------------------
# Celery task metrics
# ---------------------------------------------------------------------------

# Incremented once per task outcome at the task layer (tasks.py).
# Labels:  status ∈ {"completed", "failed", "timeout"}
#
# Double-counting prevention:
# - "completed" is recorded in tasks.py run_scan_task only on clean success.
# - "failed"    is recorded in tasks.py run_scan_task generic failure handler.
# - "timeout"   is recorded in tasks.py SoftTimeLimitExceeded handler.
# pipeline.py does NOT record task metrics — it records scan metrics only.
TASKS_TOTAL = Counter(
    "dfas_tasks_total",
    "Total number of Celery scan tasks that have reached a terminal state.",
    ["status"],
)

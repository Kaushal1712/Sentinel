"""Celery application configuration for background scan workers."""

import os

from celery import Celery
from config import Config


celery_app = Celery(
    "dfas",
    broker=Config.CELERY_BROKER_URL,
    backend=Config.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    # ── Serialization ──────────────────────────────────────────────────────
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    task_default_queue=Config.SCAN_QUEUE_NAME,
    imports=("tasks",),

    # ── Task acknowledgement ───────────────────────────────────────────────
    # Acknowledge tasks AFTER completion, not on delivery.
    # A worker crash/SIGKILL causes Celery to re-queue the task so that
    # another worker (or the same worker after restart) picks it up.
    # Without this, a crashed worker leaves the scan permanently in
    # 'running' state with no recovery path.
    task_acks_late=True,
    # Reject (and re-queue) the task if the worker process is killed
    # unexpectedly, complementing acks_late for SIGKILL/OOM scenarios.
    task_reject_on_worker_lost=True,

    # ── Worker prefetch ────────────────────────────────────────────────────
    # Hold only one task per worker at a time.  OSINT scans are long-running
    # (minutes); the default prefetch of 4 would hoard 4 scan slots on a
    # single worker, starving other users.
    worker_prefetch_multiplier=1,

    # ── Task time limits ──────────────────────────────────────────────────
    # Soft limit raises SoftTimeLimitExceeded (catchable) after N seconds.
    # Hard limit sends SIGKILL after an additional grace period.
    # A full OSINT scan + enrichment should complete within 20 minutes;
    # 30 min soft / 35 min hard provides a generous ceiling while preventing
    # permanent slot starvation from hung HTTP connections.
    # Override via CELERY_TASK_SOFT_TIME_LIMIT / CELERY_TASK_TIME_LIMIT env vars.
    task_soft_time_limit=int(os.getenv("CELERY_TASK_SOFT_TIME_LIMIT", str(30 * 60))),
    task_time_limit=int(os.getenv("CELERY_TASK_TIME_LIMIT", str(35 * 60))),

    # ── Result expiry ─────────────────────────────────────────────────────
    # Expire task results in Redis after 1 hour.  Scan results are stored in
    # PostgreSQL; Celery result-backend entries are only used for status checks.
    result_expires=3600,

    # ── Visibility ────────────────────────────────────────────────────────
    # Track started state so the API can distinguish 'queued' from 'running'.
    task_track_started=True,
)

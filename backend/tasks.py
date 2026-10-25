"""Background worker tasks."""

import logging
import uuid

from celery.exceptions import SoftTimeLimitExceeded

from app import create_app
from celery_app import celery_app
from core.pipeline import run_scan_pipeline


flask_app = create_app()
logger = logging.getLogger(__name__)


@celery_app.task(name="dfas.scan.run", bind=True)
def run_scan_task(self, scan_id: int):
    """Run a scan inside a Celery worker.

    The pipeline sets scan.status to 'running' at the start and 'completed'
    or 'failed' at the end.  The SoftTimeLimitExceeded handler below ensures
    that a task killed by the Celery soft time limit also transitions the scan
    to 'failed' rather than being left permanently in 'running'.

    Task metric counting is done here (task layer); scan metric counting is
    done in pipeline.py (scan layer).  The two counters measure different
    things and do not double-count the same event.
    """
    try:
        with flask_app.app_context():
            run_scan_pipeline(
                scan_id,
                execution_backend="celery",
                task_id=self.request.id,
            )
        # Task completed without raising — record success.
        try:
            from metrics import TASKS_TOTAL
            TASKS_TOTAL.labels(status="completed").inc()
        except Exception:  # noqa: BLE001
            pass
    except SoftTimeLimitExceeded:
        # The configured CELERY_TASK_SOFT_TIME_LIMIT was exceeded.
        # Mark the scan as failed so it does not stay permanently in 'running'.
        logger.error(
            "Scan task soft time limit exceeded for scan %s — marking as failed",
            scan_id,
        )
        # Record timeout at the task layer before re-raising.
        try:
            from metrics import TASKS_TOTAL
            TASKS_TOTAL.labels(status="timeout").inc()
        except Exception:  # noqa: BLE001
            pass
        try:
            with flask_app.app_context():
                from database import Scan, db
                scan = db.session.get(Scan, scan_id)
                if scan and scan.status not in ("completed", "failed"):
                    scan.status = "failed"
                    scan.current_stage = "Scan timed out"
                    db.session.commit()
        except Exception:
            logger.exception(
                "Could not update scan status to failed after timeout (scan %s)", scan_id
            )
        raise  # Re-raise so Celery records the task as FAILURE
    except Exception:
        # Unexpected task-level failure (not a pipeline exception, which is
        # caught inside run_scan_pipeline).  Record at the task layer.
        logger.exception("run_scan_task raised unexpectedly for scan %s", scan_id)
        try:
            from metrics import TASKS_TOTAL
            TASKS_TOTAL.labels(status="failed").inc()
        except Exception:  # noqa: BLE001
            pass
        raise


@celery_app.task(name="dfas.schedules.process")
def process_schedules():
    """Evaluate and trigger due scheduled scans.

    Each due schedule is processed independently.  A failure in one schedule
    (e.g. a DB flush error or task dispatch error) is caught and logged so
    that the remaining due schedules are still processed.

    The overall transaction is committed once per schedule iteration rather
    than in a single batch at the end, ensuring that successfully dispatched
    scans are persisted even if a later iteration fails.

    Overlap safety: two executions of this task can overlap (e.g. stale beat
    ticks queued behind long scans all start together once a worker slot
    frees up).  The due list below is only a snapshot, so each schedule must
    be *claimed* before a scan is created.  The claim is a conditional UPDATE
    that re-checks "active and due" in the WHERE clause and advances
    ``next_run`` in the same statement; only the execution whose UPDATE
    affects exactly one row proceeds.  A concurrent execution that already
    claimed the schedule makes the UPDATE affect zero rows, and the schedule
    is skipped.  On PostgreSQL the second UPDATE blocks on the row lock until
    the first transaction commits, then re-evaluates the WHERE clause against
    the new ``next_run``.  The claim and the Scan insert share one
    transaction, so a failed insert rolls the claim back.  This uses plain
    UPDATE semantics only (no SELECT ... FOR UPDATE / SKIP LOCKED), so it
    behaves the same on SQLite and PostgreSQL.
    """
    from database import db, ScheduledScan, Scan
    from datetime import datetime, timezone

    with flask_app.app_context():
        now = datetime.now(timezone.utc)
        # Plain tuples (not ORM objects) so that nothing needs a reload after a
        # rollback and the error log below can never raise.
        due_schedules = (
            db.session.query(
                ScheduledScan.id,
                ScheduledScan.user_id,
                ScheduledScan.target_username,
                ScheduledScan.frequency,
            )
            .filter(
                ScheduledScan.active == True,
                (ScheduledScan.next_run <= now) | (ScheduledScan.next_run == None)
            )
            .all()
        )

        for sched_id, user_id, target_username, frequency in due_schedules:
            try:
                # Compute the next run BEFORE dispatching so that if delay()
                # raises, the schedule has still been advanced and does not
                # fire again at the very next beat tick.
                from api.schedule import _compute_next_run
                next_run = _compute_next_run(frequency)

                # Atomically claim this occurrence.  The WHERE clause repeats
                # the due condition so a schedule already claimed by another
                # execution (next_run now in the future) matches no row.
                claimed = (
                    db.session.query(ScheduledScan)
                    .filter(
                        ScheduledScan.id == sched_id,
                        ScheduledScan.active == True,
                        (ScheduledScan.next_run <= now) | (ScheduledScan.next_run == None),
                    )
                    .update(
                        {"last_run": now, "next_run": next_run},
                        synchronize_session=False,
                    )
                )
                if claimed != 1:
                    db.session.rollback()
                    logger.info(
                        "Schedule %s already claimed by another execution (or no "
                        "longer due) — skipping", sched_id,
                    )
                    continue

                # The Celery task id is generated up front and stored with the
                # scan, so every publish attempt (this one and any recovery
                # retry) uses the same id.  dispatch_state starts 'pending';
                # dispatch_attempted_at starts the lease so the recovery task
                # does not take over a scan that is being published right now.
                task_id = str(uuid.uuid4())
                new_scan = Scan(
                    user_id=user_id,
                    target_name=target_username,
                    target_username=target_username,
                    mode="quick",
                    execution_backend="celery",
                    status="queued",
                    task_id=task_id,
                    dispatch_state="pending",
                    dispatch_attempted_at=_utcnow_naive(),
                )
                db.session.add(new_scan)
                db.session.flush()
                new_scan_id = new_scan.id

                # Commit claim + scan atomically before dispatch.  If the scan
                # insert fails, the rollback in the except block also undoes the
                # claim.  If dispatch fails after the commit the scan row stays
                # status='queued', dispatch_state='pending' and is retried by
                # recover_orphaned_scans using the same task id.
                db.session.commit()

                # Dispatch after commit so the scan row is visible to the worker.
                # Publication errors are handled inside the helper and leave
                # the scan pending; they never undo the committed claim.
                if _publish_scan_task(new_scan_id, task_id):
                    logger.info(
                        "Scheduled scan dispatched for user %s / target %s (scan_id=%s)",
                        user_id, target_username, new_scan_id,
                    )

            except Exception:
                # Roll back this iteration only (including the schedule claim);
                # other schedules are unaffected.
                logger.exception(
                    "Failed to process schedule %s (user %s / target %s) — skipping",
                    sched_id, user_id, target_username,
                )
                try:
                    db.session.rollback()
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Scheduled-scan dispatch recovery
# ---------------------------------------------------------------------------
#
# A scheduled scan is committed (status='queued', dispatch_state='pending',
# stable task_id) BEFORE its Celery message is published.  If the process dies
# or publishing raises, the scan is left pending and recover_orphaned_scans
# re-publishes it with the SAME task id once the lease has expired.
#
# Delivery guarantee is AT-LEAST-ONCE.  Residual cases that can produce a
# duplicate message for one scan:
#   * the message was published but the process crashed (or the confirming
#     UPDATE failed) before dispatch_state became 'published';
#   * publishing raised although the broker had accepted the message.
# Celery/Redis does not deduplicate by task id, and run_scan_pipeline
# deliberately lets a message for a 'running' scan proceed (acks_late
# redelivery), so a duplicate message can execute the scan twice.  This is a
# known limitation; pipeline-level queued->running control is out of scope.
# A scan that is already 'published' is never re-published, however old it
# is, because it may legitimately be waiting in the broker queue.

# How long a publish attempt/claim is honoured before another recovery pass may
# retry.  Longer than a broker round trip, so a fresh claim is not taken over.
DISPATCH_LEASE_SECONDS = 600
# Pending scans older than this are logged (never failed automatically).
DISPATCH_PENDING_WARN_SECONDS = 3600


def _utcnow_naive():
    """Current UTC time as a naive datetime (matches the DateTime columns)."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _mark_published(scan_id):
    """Conditionally flip dispatch_state pending -> published.

    Returns the affected-row count.  Only a 'pending' row is changed.
    """
    from database import db, Scan
    updated = (
        db.session.query(Scan)
        .filter(Scan.id == scan_id, Scan.dispatch_state == "pending")
        .update({"dispatch_state": "published"}, synchronize_session=False)
    )
    db.session.commit()
    return updated


def _publish_scan_task(scan_id, task_id):
    """Publish run_scan_task with the stored task id, then confirm it.

    Returns True only if both the publish and the confirmation succeeded.
    On any error the scan is deliberately left 'pending' with its task id
    intact: a publish error does not prove the message never reached the
    broker, so nothing is cleared or marked failed.
    """
    from database import db
    try:
        run_scan_task.apply_async(args=[scan_id], task_id=task_id)
    except Exception:
        logger.exception(
            "Publishing scan %s (task_id=%s) raised — leaving dispatch_state="
            "'pending' for lease-based retry (the broker may or may not have "
            "accepted the message)", scan_id, task_id,
        )
        return False

    try:
        _mark_published(scan_id)
    except Exception:
        logger.exception(
            "Scan %s (task_id=%s) was published but dispatch_state could not "
            "be confirmed — it stays 'pending' and may be re-published with "
            "the same task id (at-least-once)", scan_id, task_id,
        )
        try:
            db.session.rollback()
        except Exception:
            pass
        return False
    return True


def _claim_dispatch(scan_id, now, lease_cutoff):
    """Atomically take the dispatch lease for one orphan candidate.

    A conditional UPDATE: it matches only a still-eligible row (queued,
    celery, pending) whose lease is absent or expired, and sets
    dispatch_attempted_at=now.  Returns the affected-row count; exactly 1
    means this execution owns the lease.  A fresh lease, or one taken by a
    competing recovery worker, yields 0.  Plain UPDATE semantics only, so it
    behaves the same on SQLite and PostgreSQL.
    """
    from database import db, Scan
    claimed = (
        db.session.query(Scan)
        .filter(
            Scan.id == scan_id,
            Scan.status == "queued",
            Scan.execution_backend == "celery",
            Scan.dispatch_state == "pending",
            (Scan.dispatch_attempted_at == None) | (Scan.dispatch_attempted_at < lease_cutoff),
        )
        .update({"dispatch_attempted_at": now}, synchronize_session=False)
    )
    db.session.commit()
    return claimed


@celery_app.task(name="dfas.scans.recover")
def recover_orphaned_scans():
    """Re-publish scheduled scans whose dispatch was never confirmed.

    Only scans with status='queued', execution_backend='celery' and
    dispatch_state='pending' are considered; rows with NULL dispatch_state
    (manual and pre-existing scans) and any running/completed/failed scan are
    never touched.  Each candidate is claimed with a conditional UPDATE on
    dispatch_attempted_at (a lease) and published only if exactly one row was
    affected.  Publication reuses the stored task id.  On error the scan stays
    pending and is retried after the lease expires.  Scans are never failed
    for being old; prolonged pending scans are only logged.  See the module
    notes above for the at-least-once caveat.
    """
    from datetime import timedelta
    from database import db, Scan

    with flask_app.app_context():
        now = _utcnow_naive()
        lease_cutoff = now - timedelta(seconds=DISPATCH_LEASE_SECONDS)

        # Plain tuples so nothing needs a reload after a rollback.
        candidates = (
            db.session.query(Scan.id, Scan.task_id, Scan.created_at)
            .filter(
                Scan.status == "queued",
                Scan.execution_backend == "celery",
                Scan.dispatch_state == "pending",
                (Scan.dispatch_attempted_at == None) | (Scan.dispatch_attempted_at < lease_cutoff),
            )
            .order_by(Scan.id)
            .all()
        )
        # End the read transaction before claiming.
        db.session.rollback()

        for scan_id, task_id, created_at in candidates:
            try:
                if not task_id:
                    # Never invent a new id: pending scans are always created
                    # with one.  Surface the anomaly instead.
                    logger.error(
                        "Pending scan %s has no stored task id — cannot "
                        "recover it automatically", scan_id,
                    )
                    continue

                if _claim_dispatch(scan_id, now, lease_cutoff) != 1:
                    db.session.rollback()
                    logger.info(
                        "Scan %s dispatch already claimed by another "
                        "execution — skipping", scan_id,
                    )
                    continue

                if created_at is not None:
                    pending_for = (now - created_at.replace(tzinfo=None)).total_seconds()
                    if pending_for > DISPATCH_PENDING_WARN_SECONDS:
                        logger.warning(
                            "Scan %s has been pending dispatch for %d seconds",
                            scan_id, int(pending_for),
                        )

                if _publish_scan_task(scan_id, task_id):
                    logger.info(
                        "Recovered orphaned scan %s (task_id=%s)", scan_id, task_id,
                    )
            except Exception:
                logger.exception("Failed to recover scan %s — skipping", scan_id)
                try:
                    db.session.rollback()
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Celery Beat schedule
# ---------------------------------------------------------------------------

celery_app.conf.beat_schedule = {
    "process-scheduled-scans": {
        "task": "dfas.schedules.process",
        "schedule": 300.0,  # Run every 5 minutes
        # Drop a tick that has waited in the queue longer than one interval
        # (e.g. behind long scans) so stale ticks cannot pile up and run
        # together.  Deduplication itself is the atomic claim in
        # process_schedules; this only limits the backlog.
        "options": {"expires": 300},
    },
    "recover-orphaned-scans": {
        "task": "dfas.scans.recover",
        "schedule": 300.0,  # Run every 5 minutes
        # A stale recovery tick is useless: the next one will run anyway.
        "options": {"expires": 300},
    },
}

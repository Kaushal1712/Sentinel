"""Scan API routes — Initiate and monitor scans."""

import logging
import threading
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, g, current_app
from database import db, Scan
from auth.middleware import get_owned_scan, require_auth
from limiter import limiter
import core.pipeline as core_pipeline

scan_bp = Blueprint("scan", __name__, url_prefix="/api/scan")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Private helpers — identity normalisation and validation
# ---------------------------------------------------------------------------

def _normalize_name(value):
    return " ".join((value or "").strip().lower().split())


def _normalize_email(value):
    return (value or "").strip().lower()


def _is_placeholder_email(value):
    """DigiLocker users are provisioned with synthetic @digilocker.gov.in
    addresses that carry no real contact information and must not be used
    as scan targets.  DO NOT remove this guard until DigiLocker support is
    formally retired in a later phase."""
    return _normalize_email(value).endswith("@digilocker.gov.in")


def _as_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _prepare_scan_identity(user, payload):
    """Prepare a scan payload while enforcing self-scan-only restrictions."""
    if not isinstance(payload, dict):
        return None, ("Request body required", 400)

    trusted_name = (user.full_name or "").strip()
    trusted_email = _normalize_email(user.email)
    target_username = (payload.get("username") or "").strip() or None
    target_phone = (payload.get("phone") or "").strip() or None

    if not trusted_name:
        return None, ("Your account profile is missing a full name. Update your account before scanning.", 400)

    if current_app.config.get("SELF_SCAN_ONLY", True):
        if not _as_bool(payload.get("self_attested")):
            return None, (
                "Self-scan confirmation is required. You cannot scan another person's data.",
                400,
            )

        supplied_name = payload.get("name")
        supplied_email = payload.get("email")

        if supplied_name and _normalize_name(supplied_name) != _normalize_name(trusted_name):
            logger.warning("Blocked non-self scan attempt for user %s due to name mismatch", user.id)
            return None, (
                "You cannot scan another person's identity. Scans are limited to your signed-in profile.",
                403,
            )

        if supplied_email and _normalize_email(supplied_email) != trusted_email:
            logger.warning("Blocked non-self scan attempt for user %s due to email mismatch", user.id)
            return None, (
                "You cannot scan another person's email. Use the email on your signed-in account only.",
                403,
            )

        target_name = trusted_name
        target_email = None if _is_placeholder_email(trusted_email) else trusted_email or None
    else:
        target_name = (payload.get("name") or "").strip()
        target_email = _normalize_email(payload.get("email")) or None
        if not target_name:
            return None, ("Target name is required", 400)

    return {
        "target_name": target_name,
        "target_email": target_email,
        "target_username": target_username,
        "target_phone": target_phone,
    }, None


# ---------------------------------------------------------------------------
# Thread execution wrapper
# ---------------------------------------------------------------------------

def _run_pipeline_in_thread(app, scan_id):
    """Execute the canonical scan pipeline inside a Flask application context.

    This wrapper is the bridge between the thread-based execution path and
    ``core.pipeline.run_scan_pipeline``.  It is intentionally kept simple:
    it does nothing except acquire the app context and delegate to the single
    canonical pipeline implementation.  All pipeline logic lives in
    ``core.pipeline``.
    """
    with app.app_context():
        core_pipeline.run_scan_pipeline(
            scan_id,
            execution_backend="thread",
        )


# ---------------------------------------------------------------------------
# Scan creation helper
# ---------------------------------------------------------------------------

def _check_daily_quota(user):
    """Enforce the per-user max_scans_per_day quota.

    Counts ALL scans created by the user since UTC midnight today, regardless
    of scan mode (quick/full) or status (pending/running/completed/failed).
    This prevents quota bypass by mode-switching or by rapid fire that leaves
    scans in a pending/running state.

    Returns (None) if the request may proceed, or a Flask response tuple if
    the quota is exceeded.
    """
    limit = user.max_scans_per_day
    if limit is None:
        # No per-user quota configured — allow.
        return None

    today_utc = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    scans_today = (
        Scan.query
        .filter(Scan.user_id == user.id)
        .filter(Scan.created_at >= today_utc)
        .count()
    )

    if scans_today >= limit:
        return (
            jsonify({
                "error": "daily_quota_exceeded",
                "message": "Daily scan quota reached. Please try again tomorrow.",
            }),
            429,
        )
    return None


def _start_scan(mode):
    """Create a scan record and queue its background pipeline."""
    # Quota check must happen before identity validation and before any DB work.
    quota_response = _check_daily_quota(g.current_user)
    if quota_response is not None:
        return quota_response

    data = request.get_json(silent=True)
    scan_identity, error = _prepare_scan_identity(g.current_user, data)
    if error:
        message, status_code = error
        return jsonify({"error": message}), status_code

    scan = Scan(
        user_id=g.current_user.id,
        target_name=scan_identity["target_name"],
        target_email=scan_identity["target_email"],
        target_username=scan_identity["target_username"],
        target_phone=scan_identity["target_phone"],
        mode=mode,
        status="pending",
    )
    db.session.add(scan)
    db.session.commit()

    # Obtain a concrete reference to the current app object that is safe to
    # pass across thread boundaries (avoids LocalProxy pitfalls).
    app = current_app._get_current_object()
    thread = threading.Thread(
        target=_run_pipeline_in_thread,
        args=(app, scan.id),
        daemon=True,
    )
    thread.start()

    return scan


# ---------------------------------------------------------------------------
# Public API routes
# ---------------------------------------------------------------------------

@scan_bp.route("/quick", methods=["POST"])
@require_auth
@limiter.limit("10 per minute", key_func=lambda: str(getattr(g, 'current_user', None) and g.current_user.id or ''))
def start_quick_scan():
    """Start a Quick Mode scan."""
    scan = _start_scan("quick")
    if not isinstance(scan, Scan):
        return scan
    return jsonify({"message": "Quick scan started", "scan": scan.to_dict()}), 201


@scan_bp.route("/full", methods=["POST"])
@require_auth
@limiter.limit("10 per minute", key_func=lambda: str(getattr(g, 'current_user', None) and g.current_user.id or ''))
def start_full_scan():
    """Start a Full Mode scan (includes scraping)."""
    scan = _start_scan("full")
    if not isinstance(scan, Scan):
        return scan
    return jsonify({"message": "Full scan started", "scan": scan.to_dict()}), 201


@scan_bp.route("/<int:scan_id>/status", methods=["GET"])
@require_auth
def get_scan_status(scan_id):
    """Get the current status of a scan."""
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404
    return jsonify({"scan": scan.to_dict()}), 200


@scan_bp.route("/<int:scan_id>/results", methods=["GET"])
@require_auth
def get_scan_results(scan_id):
    """Get full results of a completed scan."""
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404

    results = [r.to_dict() for r in scan.results.all()]
    return jsonify({
        "scan": scan.to_dict(),
        "results": results,
        "total": len(results),
    }), 200

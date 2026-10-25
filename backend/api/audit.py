"""Audit log API — surfaces system audit trail."""

import csv
import io
import logging
from datetime import datetime, timezone

from flask import Blueprint, Response, g, jsonify, request

from auth.middleware import require_admin, require_auth
from database import AuditLog, db

audit_bp = Blueprint("audit", __name__, url_prefix="/api/audit")
logger = logging.getLogger(__name__)


def log_event(user_id: int | None, event_type: str, target: str = "",
              details: dict | None = None, ip_address: str = "",
              user_agent: str = ""):
    """Record an audit event (call from anywhere in the app)."""
    import json
    try:
        entry = AuditLog(
            user_id=user_id,
            event_type=event_type,
            target=target,
            details_json=json.dumps(details) if details else None,
            ip_address=ip_address,
            user_agent=user_agent[:500] if user_agent else "",
        )
        db.session.add(entry)
        db.session.commit()
    except Exception as e:
        logger.warning(f"Failed to write audit log: {e}")


@audit_bp.route("/logs", methods=["GET"])
@require_auth
def get_audit_logs():
    """Get paginated audit logs. Admins see all; users see their own."""
    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 50, type=int), 200)
    event_type = request.args.get("event_type")

    query = AuditLog.query

    # Admin sees all, regular users see own
    if g.current_user.role not in {"admin", "analyst"}:
        query = query.filter_by(user_id=g.current_user.id)

    if event_type:
        query = query.filter_by(event_type=event_type)

    query = query.order_by(AuditLog.created_at.desc())
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    return jsonify({
        "logs": [log.to_dict() for log in paginated.items],
        "total": paginated.total,
        "page": page,
        "pages": paginated.pages,
        "per_page": per_page,
    })


@audit_bp.route("/logs/export", methods=["GET"])
@require_auth
def export_audit_logs():
    """Export audit logs as CSV."""
    query = AuditLog.query

    if g.current_user.role not in {"admin", "analyst"}:
        query = query.filter_by(user_id=g.current_user.id)

    logs = query.order_by(AuditLog.created_at.desc()).limit(5000).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Timestamp", "Event Type", "User ID", "Target", "Details", "IP Address"])

    for log in logs:
        writer.writerow([
            log.created_at.isoformat() if log.created_at else "",
            log.event_type,
            log.user_id,
            log.target or "",
            log.details_json or "",
            log.ip_address or "",
        ])

    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=dfas_audit_log.csv"},
    )


@audit_bp.route("/event-types", methods=["GET"])
@require_auth
def get_event_types():
    """Return distinct event types for the filter dropdown."""
    import sqlalchemy as sa
    types = db.session.query(sa.distinct(AuditLog.event_type)).all()
    return jsonify({"event_types": [t[0] for t in types if t[0]]})

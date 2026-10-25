"""Admin dashboard API — system stats and user management."""

import json
import logging
from datetime import datetime, timedelta, timezone

from flask import Blueprint, g, jsonify, request

from auth.middleware import require_admin, require_auth
from database import AuditLog, Scan, User, db

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")
logger = logging.getLogger(__name__)


@admin_bp.route("/stats", methods=["GET"])
@require_auth
@require_admin
def get_system_stats():
    """Return system-wide statistics for the admin dashboard."""
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    total_users = User.query.count()
    total_scans = Scan.query.count()
    scans_this_week = Scan.query.filter(Scan.created_at >= week_ago).count()
    scans_this_month = Scan.query.filter(Scan.created_at >= month_ago).count()

    # Scans by status
    completed = Scan.query.filter_by(status="completed").count()
    failed = Scan.query.filter_by(status="failed").count()
    running = Scan.query.filter_by(status="running").count()

    # Average risk score
    from sqlalchemy import func
    avg_risk = db.session.query(func.avg(Scan.risk_score)).filter(
        Scan.risk_score.isnot(None)
    ).scalar() or 0

    # Top scanned targets
    top_targets = (
        db.session.query(Scan.target_username, func.count(Scan.id).label("count"))
        .filter(Scan.target_username.isnot(None))
        .group_by(Scan.target_username)
        .order_by(func.count(Scan.id).desc())
        .limit(10)
        .all()
    )

    # Scans per user
    scans_per_user = (
        db.session.query(User.email, func.count(Scan.id).label("count"))
        .join(Scan, User.id == Scan.user_id)
        .group_by(User.email)
        .order_by(func.count(Scan.id).desc())
        .limit(20)
        .all()
    )

    return jsonify({
        "total_users": total_users,
        "total_scans": total_scans,
        "scans_this_week": scans_this_week,
        "scans_this_month": scans_this_month,
        "scans_by_status": {
            "completed": completed,
            "failed": failed,
            "running": running,
        },
        "average_risk_score": round(avg_risk, 2),
        "top_targets": [
            {"username": t[0], "count": t[1]} for t in top_targets
        ],
        "scans_per_user": [
            {"email": s[0], "count": s[1]} for s in scans_per_user
        ],
    })


@admin_bp.route("/users", methods=["GET"])
@require_auth
@require_admin
def list_users():
    """List all users with their roles and scan counts."""
    from sqlalchemy import func

    users = (
        db.session.query(
            User,
            func.count(Scan.id).label("scan_count"),
        )
        .outerjoin(Scan, User.id == Scan.user_id)
        .group_by(User.id)
        .all()
    )

    return jsonify({
        "users": [
            {
                **u.to_dict(),
                "scan_count": count,
                "max_scans_per_day": u.max_scans_per_day,
                "has_2fa": bool(u.totp_secret),
            }
            for u, count in users
        ],
        "total": len(users),
    })


@admin_bp.route("/users/<int:user_id>/role", methods=["PUT"])
@require_auth
@require_admin
def update_user_role(user_id):
    """Change a user's role."""
    data = request.get_json(silent=True) or {}
    new_role = (data.get("role") or "").strip().lower()

    if new_role not in {"admin", "analyst", "user", "viewer"}:
        return jsonify({"error": "Invalid role"}), 400

    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    user.role = new_role
    db.session.commit()

    return jsonify({"message": f"Role updated to {new_role}", "user": user.to_dict()})


@admin_bp.route("/users/<int:user_id>/quota", methods=["PUT"])
@require_auth
@require_admin
def update_user_quota(user_id):
    """Set the max scans per day quota for a user."""
    data = request.get_json(silent=True) or {}
    quota = data.get("max_scans_per_day")

    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    user.max_scans_per_day = int(quota) if quota is not None else None
    db.session.commit()

    return jsonify({"message": "Quota updated", "user": user.to_dict()})

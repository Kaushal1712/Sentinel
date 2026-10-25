"""Risk history API — serves trend data for dashboard charts."""

import logging

from flask import Blueprint, g, jsonify

from auth.middleware import require_auth
from database import Scan, ScanRiskHistory, db

history_bp = Blueprint("history", __name__, url_prefix="/api/history")
logger = logging.getLogger(__name__)


@history_bp.route("/<username>/trend", methods=["GET"])
@require_auth
def get_risk_trend(username):
    """Return risk score history for a given username (last 50 entries).

    Results are restricted to scans owned by the authenticated user so that
    one user cannot read another user's scan risk trend by guessing a target
    username.
    """
    entries = (
        ScanRiskHistory.query
        .join(Scan, Scan.id == ScanRiskHistory.scan_id)
        .filter(
            ScanRiskHistory.target_username == username,
            Scan.user_id == g.current_user.id,
        )
        .order_by(ScanRiskHistory.timestamp.desc())
        .limit(50)
        .all()
    )

    # Reverse to chronological order
    entries.reverse()

    return jsonify({
        "username": username,
        "trend": [e.to_dict() for e in entries],
        "total": len(entries),
    })


@history_bp.route("/recent", methods=["GET"])
@require_auth
def get_recent_history():
    """Return the most recent risk history entries for the authenticated user.

    Results are restricted to scans owned by the authenticated user so that
    one user cannot read another user's recent scan risk history.
    """
    entries = (
        ScanRiskHistory.query
        .join(Scan, Scan.id == ScanRiskHistory.scan_id)
        .filter(Scan.user_id == g.current_user.id)
        .order_by(ScanRiskHistory.timestamp.desc())
        .limit(20)
        .all()
    )

    return jsonify({
        "entries": [e.to_dict() for e in entries],
        "total": len(entries),
    })

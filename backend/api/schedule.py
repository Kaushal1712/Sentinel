"""Scan scheduling API — CRUD for recurring scan schedules."""

import logging
from datetime import datetime, timedelta, timezone

from flask import Blueprint, g, jsonify, request

from auth.middleware import require_auth
from database import ScheduledScan, db

schedule_bp = Blueprint("schedule", __name__, url_prefix="/api/schedule")
logger = logging.getLogger(__name__)

FREQUENCY_DELTAS = {
    "daily": timedelta(days=1),
    "weekly": timedelta(weeks=1),
    "monthly": timedelta(days=30),
}


def _compute_next_run(frequency: str) -> datetime:
    """Compute the next run time based on frequency."""
    delta = FREQUENCY_DELTAS.get(frequency, timedelta(days=1))
    return datetime.now(timezone.utc) + delta


@schedule_bp.route("/", methods=["GET"])
@require_auth
def list_schedules():
    """List all scheduled scans for the current user."""
    schedules = ScheduledScan.query.filter_by(user_id=g.current_user.id).all()
    return jsonify({
        "schedules": [s.to_dict() for s in schedules],
        "total": len(schedules),
    })


@schedule_bp.route("/", methods=["POST"])
@require_auth
def create_schedule():
    """Create a new scheduled scan."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body required"}), 400

    target_username = (data.get("target_username") or "").strip()
    frequency = (data.get("frequency") or "weekly").strip().lower()

    if not target_username:
        return jsonify({"error": "target_username is required"}), 400
    if frequency not in FREQUENCY_DELTAS:
        return jsonify({"error": f"Invalid frequency. Use: {', '.join(FREQUENCY_DELTAS)}"}), 400

    schedule = ScheduledScan(
        user_id=g.current_user.id,
        target_username=target_username,
        frequency=frequency,
        next_run=_compute_next_run(frequency),
        notify_on_change=data.get("notify_on_change", True),
        active=True,
    )
    db.session.add(schedule)
    db.session.commit()

    return jsonify({"message": "Schedule created", "schedule": schedule.to_dict()}), 201


@schedule_bp.route("/<int:schedule_id>", methods=["PUT"])
@require_auth
def update_schedule(schedule_id):
    """Update a scheduled scan."""
    schedule = ScheduledScan.query.filter_by(
        id=schedule_id, user_id=g.current_user.id
    ).first()
    if not schedule:
        return jsonify({"error": "Schedule not found"}), 404

    data = request.get_json(silent=True) or {}

    if "frequency" in data:
        freq = data["frequency"].strip().lower()
        if freq in FREQUENCY_DELTAS:
            schedule.frequency = freq
            schedule.next_run = _compute_next_run(freq)

    if "notify_on_change" in data:
        schedule.notify_on_change = bool(data["notify_on_change"])

    if "active" in data:
        schedule.active = bool(data["active"])

    db.session.commit()
    return jsonify({"message": "Schedule updated", "schedule": schedule.to_dict()})


@schedule_bp.route("/<int:schedule_id>", methods=["DELETE"])
@require_auth
def delete_schedule(schedule_id):
    """Delete a scheduled scan."""
    schedule = ScheduledScan.query.filter_by(
        id=schedule_id, user_id=g.current_user.id
    ).first()
    if not schedule:
        return jsonify({"error": "Schedule not found"}), 404

    db.session.delete(schedule)
    db.session.commit()
    return jsonify({"message": "Schedule deleted"})


@schedule_bp.route("/<int:schedule_id>/toggle", methods=["POST"])
@require_auth
def toggle_schedule(schedule_id):
    """Toggle a scheduled scan active/inactive."""
    schedule = ScheduledScan.query.filter_by(
        id=schedule_id, user_id=g.current_user.id
    ).first()
    if not schedule:
        return jsonify({"error": "Schedule not found"}), 404

    schedule.active = not schedule.active
    if schedule.active:
        schedule.next_run = _compute_next_run(schedule.frequency)
    db.session.commit()

    return jsonify({
        "message": f"Schedule {'activated' if schedule.active else 'deactivated'}",
        "schedule": schedule.to_dict(),
    })

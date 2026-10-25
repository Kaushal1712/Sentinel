"""Timeline API — aggregates all timestamped findings into a chronological feed."""

import json
import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify

from auth.middleware import get_owned_scan, require_auth

timeline_bp = Blueprint("timeline", __name__, url_prefix="/api/timeline")
logger = logging.getLogger(__name__)


def _parse_iso(value):
    """Try to parse an ISO date string."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        cleaned = str(value).replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned)
    except (ValueError, TypeError):
        return None


def _make_event(date, event_type, label, detail="", risk_level="low", url=""):
    """Create a timeline event dict."""
    parsed = _parse_iso(date)
    if not parsed:
        return None
    return {
        "date": parsed.isoformat(),
        "timestamp": parsed.timestamp(),
        "type": event_type,
        "label": label,
        "detail": detail,
        "risk_level": risk_level,
        "url": url,
    }


@timeline_bp.route("/<int:scan_id>/events", methods=["GET"])
@require_auth
def get_timeline_events(scan_id):
    """Aggregate all timestamped findings for a scan into a sorted timeline."""
    scan = get_owned_scan(scan_id)
    if not scan:
        return jsonify({"error": "Scan not found"}), 404

    events = []

    # Scan creation and completion
    if scan.created_at:
        events.append(_make_event(
            scan.created_at, "scan", "Scan Started",
            f"{scan.mode.upper()} mode scan initiated", "low"
        ))
    if scan.completed_at:
        events.append(_make_event(
            scan.completed_at, "scan", "Scan Completed",
            f"Risk score: {scan.risk_score or 0:.1f}/10", "low"
        ))

    results = scan.results.all()

    for result in results:
        # Discovery timestamp
        if result.discovered_at:
            events.append(_make_event(
                result.discovered_at, "discovery",
                f"Found on {result.platform}",
                result.url, result.risk_level or "low", result.url
            ))

        # Last activity timestamp
        if result.last_seen_at:
            events.append(_make_event(
                result.last_seen_at, "activity",
                f"Active on {result.platform}",
                f"Last seen activity on {result.platform}", "medium", result.url
            ))

        # Parse metadata for additional timestamps
        metadata = {}
        if result.metadata_json:
            try:
                metadata = json.loads(result.metadata_json)
            except (json.JSONDecodeError, TypeError):
                pass

        # Rich data timestamps (profile creation, etc.)
        rich_data = metadata.get("rich_data", {})
        if rich_data.get("created_at"):
            events.append(_make_event(
                rich_data["created_at"], "profile_created",
                f"Account created on {result.platform}",
                f"Profile registered on {result.platform}", "low", result.url
            ))

        # Wayback timestamps
        enrichment = metadata.get("enrichment", {})
        wayback = enrichment.get("wayback", {})
        if wayback.get("first_seen"):
            events.append(_make_event(
                wayback["first_seen"], "archive",
                f"First archived: {result.platform}",
                f"First Wayback snapshot of {result.url}",
                "low", wayback.get("oldest_snapshot_url", "")
            ))

        # Breach dates
        if rich_data.get("breaches"):
            for breach in rich_data["breaches"]:
                breach_date = breach.get("date")
                if breach_date:
                    events.append(_make_event(
                        breach_date + "T00:00:00+00:00" if "T" not in str(breach_date) else breach_date,
                        "breach",
                        f"Breach: {breach.get('name', 'Unknown')}",
                        f"Domain: {breach.get('domain', '')}",
                        "critical"
                    ))

        # Dark web mentions
        threat_intel = metadata.get("threat_intel", {})
        darkweb = threat_intel.get("darkweb", {})
        for mention in darkweb.get("dark_web_mentions", []):
            if mention.get("date"):
                events.append(_make_event(
                    mention["date"], "darkweb",
                    f"Dark web mention",
                    mention.get("name", ""), "critical"
                ))

        # Paste leak dates
        paste_data = threat_intel.get("pastebin", {})
        for paste in paste_data.get("paste_leaks", []):
            events.append(_make_event(
                datetime.now(timezone.utc).isoformat(),
                "paste_leak",
                f"Paste leak detected",
                paste.get("title", ""), "high", paste.get("url", "")
            ))

    # Filter None events and sort by timestamp
    events = [e for e in events if e is not None]
    events.sort(key=lambda x: x.get("timestamp", 0))

    # Summary stats
    type_counts = {}
    for e in events:
        t = e["type"]
        type_counts[t] = type_counts.get(t, 0) + 1

    return jsonify({
        "events": events,
        "total": len(events),
        "type_counts": type_counts,
        "scan_id": scan_id,
    })

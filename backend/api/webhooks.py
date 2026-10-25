"""Webhook management API — CRUD plus HMAC-signed delivery."""

import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timezone

import httpx
from flask import Blueprint, g, jsonify, request

from auth.middleware import require_auth
from database import Webhook, db

webhook_bp = Blueprint("webhooks", __name__, url_prefix="/api/webhooks")
logger = logging.getLogger(__name__)

# Bounded retry configuration for production deliveries
MAX_DELIVERY_ATTEMPTS = 3  # Initial attempt + up to 2 retries
INITIAL_RETRY_BACKOFF_SEC = 0.5  # Short exponential backoff (0.5s, 1.0s)


def _sign_payload(payload_bytes: bytes | str | dict, secret: str) -> str:
    """Sign raw JSON payload bytes with HMAC-SHA256."""
    if isinstance(payload_bytes, dict):
        body_bytes = json.dumps(payload_bytes).encode("utf-8")
    elif isinstance(payload_bytes, str):
        body_bytes = payload_bytes.encode("utf-8")
    else:
        body_bytes = payload_bytes
    return hmac.new((secret or "").encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()


def fire_webhooks(event_type: str, payload: dict, user_id: int):
    """Dispatch webhooks for a given event type (called from pipeline)."""
    webhooks = Webhook.query.filter_by(user_id=user_id, active=True).all()

    for wh in webhooks:
        try:
            events = json.loads(wh.events_json) if wh.events_json else []
            if event_type not in events and "*" not in events:
                continue

            delivery = {
                "event": event_type,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data": payload,
            }

            body_bytes = json.dumps(delivery).encode("utf-8")
            signature = _sign_payload(body_bytes, wh.secret or "")
            headers = {
                "Content-Type": "application/json",
                "X-DFAS-Signature": f"sha256={signature}",
                "X-DFAS-Event": event_type,
            }

            for attempt in range(MAX_DELIVERY_ATTEMPTS):
                if attempt > 0:
                    time.sleep(INITIAL_RETRY_BACKOFF_SEC * (2 ** (attempt - 1)))

                try:
                    resp = httpx.post(
                        wh.url,
                        content=body_bytes,
                        headers=headers,
                        timeout=10.0,
                    )
                    wh.last_triggered = datetime.now(timezone.utc)
                    wh.last_status_code = resp.status_code

                    if 200 <= resp.status_code < 300:
                        break

                    logger.warning(
                        "Webhook delivery returned non-2xx status for webhook %s (attempt %s/%s): HTTP %s",
                        wh.id,
                        attempt + 1,
                        MAX_DELIVERY_ATTEMPTS,
                        resp.status_code,
                    )

                    # Only retry 5xx server errors; do not retry 4xx client errors
                    if not (500 <= resp.status_code < 600):
                        break

                except Exception as e:
                    wh.last_status_code = 0
                    logger.warning(
                        "Webhook delivery failed for webhook %s (attempt %s/%s): %s",
                        wh.id,
                        attempt + 1,
                        MAX_DELIVERY_ATTEMPTS,
                        type(e).__name__,
                    )
                    if attempt == MAX_DELIVERY_ATTEMPTS - 1:
                        break

        except Exception as e:
            logger.warning(
                "Error processing webhook %s: %s",
                getattr(wh, "id", "unknown"),
                type(e).__name__,
            )

    db.session.commit()


@webhook_bp.route("/", methods=["GET"])
@require_auth
def list_webhooks():
    """List all webhooks for the current user."""
    webhooks = Webhook.query.filter_by(user_id=g.current_user.id).all()
    return jsonify({
        "webhooks": [w.to_dict() for w in webhooks],
        "total": len(webhooks),
    })


@webhook_bp.route("/", methods=["POST"])
@require_auth
def create_webhook():
    """Register a new webhook endpoint."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Request body required"}), 400

    url = (data.get("url") or "").strip()
    if not url or not url.startswith("http"):
        return jsonify({"error": "A valid URL is required"}), 400

    import secrets
    webhook = Webhook(
        user_id=g.current_user.id,
        url=url,
        secret=data.get("secret") or secrets.token_hex(32),
        events_json=json.dumps(data.get("events", ["scan_complete"])),
        active=True,
    )
    db.session.add(webhook)
    db.session.commit()

    # Return the secret in this one-time creation response so the user can
    # record it for HMAC payload verification.  Subsequent list/delete/test
    # responses use to_dict() which intentionally omits the secret.
    webhook_data = {**webhook.to_dict(), "secret": webhook.secret}
    return jsonify({"message": "Webhook created", "webhook": webhook_data}), 201


@webhook_bp.route("/<int:webhook_id>", methods=["DELETE"])
@require_auth
def delete_webhook(webhook_id):
    """Delete a webhook."""
    webhook = Webhook.query.filter_by(
        id=webhook_id, user_id=g.current_user.id
    ).first()
    if not webhook:
        return jsonify({"error": "Webhook not found"}), 404

    db.session.delete(webhook)
    db.session.commit()
    return jsonify({"message": "Webhook deleted"})


@webhook_bp.route("/<int:webhook_id>/test", methods=["POST"])
@require_auth
def test_webhook(webhook_id):
    """Fire a test event to a webhook."""
    webhook = Webhook.query.filter_by(
        id=webhook_id, user_id=g.current_user.id
    ).first()
    if not webhook:
        return jsonify({"error": "Webhook not found"}), 404

    test_payload = {
        "event": "test",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": {
            "message": "This is a test webhook from Sentinel",
            "scan_id": 0,
            "target_username": "test_user",
            "risk_score": 5.0,
        },
    }

    body_bytes = json.dumps(test_payload).encode("utf-8")
    signature = _sign_payload(body_bytes, webhook.secret or "")

    try:
        resp = httpx.post(
            webhook.url,
            content=body_bytes,
            headers={
                "Content-Type": "application/json",
                "X-DFAS-Signature": f"sha256={signature}",
                "X-DFAS-Event": "test",
            },
            timeout=10.0,
        )
        webhook.last_triggered = datetime.now(timezone.utc)
        webhook.last_status_code = resp.status_code
        db.session.commit()

        return jsonify({
            "message": "Test webhook sent",
            "status_code": resp.status_code,
            "success": 200 <= resp.status_code < 300,
        })
    except Exception:
        logger.warning("Test webhook delivery failed for webhook %s", webhook_id, exc_info=True)
        webhook.last_status_code = 0
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
        return jsonify({"error": "Webhook delivery failed. Check the target URL and try again."}), 502

"""JWT authentication and authorization helpers."""

from functools import wraps

from flask import g, jsonify
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request

from database import Scan, User, db


ADMIN_ROLES = {"admin", "analyst"}


def get_owned_scan(scan_id):
    """Fetch a scan owned by the current user."""
    if not hasattr(g, "current_user"):
        return None
    return Scan.query.filter_by(id=scan_id, user_id=g.current_user.id).first()


def require_auth(f):
    """Decorator to require JWT authentication on a route.

    In addition to verifying the JWT signature and expiry, this validates the
    ``ver`` claim embedded at login against the user's current
    ``token_version`` in the database.  Logout increments ``token_version``,
    so any previously issued token is rejected on the next request even if it
    has not yet expired — closing the stolen-token replay window.
    """

    @wraps(f)
    def decorated(*args, **kwargs):
        verify_jwt_in_request()
        user_id = get_jwt_identity()

        try:
            user = db.session.get(User, int(user_id))
        except (TypeError, ValueError):
            return jsonify({"error": "Authentication required"}), 401

        if not user:
            return jsonify({"error": "User not found"}), 401

        # F-02 fix: validate the 'ver' claim to enforce logout revocation.
        # get_jwt() returns the full decoded payload; no extra DB query needed.
        claims = get_jwt()
        token_ver = claims.get("ver")
        if token_ver is None or token_ver != user.token_version:
            return jsonify({"error": "Authentication required"}), 401

        g.current_user = user
        return f(*args, **kwargs)

    return decorated



def require_role(role):
    """Decorator to require a specific user role."""

    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if not hasattr(g, "current_user") or g.current_user.role != role:
                return jsonify({"error": "Insufficient permissions"}), 403
            return f(*args, **kwargs)

        return decorated

    return decorator


def require_admin(f):
    """Decorator to require elevated admin/editor access."""

    @wraps(f)
    def decorated(*args, **kwargs):
        if not hasattr(g, "current_user") or g.current_user.role not in ADMIN_ROLES:
            return jsonify({"error": "Insufficient permissions"}), 403
        return f(*args, **kwargs)

    return decorated

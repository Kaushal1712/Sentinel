"""Sentinel — Flask Application Entry Point."""

import hmac
import os

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_jwt_extended.exceptions import CSRFError

from config import Config, validate_secrets
from database import User, db
from flask_migrate import Migrate
from limiter import limiter

migrate = Migrate()


def create_app(config_overrides=None):
    """Create and configure the Flask application."""
    app = Flask(__name__, static_folder=None)
    app.config.from_object(Config)
    if config_overrides:
        app.config.update(config_overrides)

    # Fail fast in production if insecure default secrets are detected.
    validate_secrets(app.config)

    # Initialize extensions
    CORS(
        app,
        resources={r"/api/*": {"origins": app.config.get("CORS_ORIGINS") or []}},
        supports_credentials=True,
    )
    jwt = JWTManager(app)
    db.init_app(app)
    migrate.init_app(app, db, directory="migrations", render_as_batch=True)
    limiter.init_app(app)

    @jwt.token_in_blocklist_loader
    def is_token_revoked(_jwt_header, jwt_payload):
        user_id = jwt_payload.get("sub")
        token_version = jwt_payload.get("ver", 0)

        try:
            user = db.session.get(User, int(user_id))
        except (TypeError, ValueError):
            return True

        return not user or user.token_version != token_version

    @jwt.unauthorized_loader
    def handle_missing_token(reason):
        return jsonify({"error": "Authentication required", "detail": reason}), 401

    @jwt.invalid_token_loader
    def handle_invalid_token(reason):
        return jsonify({"error": "Invalid session", "detail": reason}), 401

    @jwt.expired_token_loader
    def handle_expired_token(_jwt_header, _jwt_payload):
        return jsonify({"error": "Session expired"}), 401

    @jwt.revoked_token_loader
    def handle_revoked_token(_jwt_header, _jwt_payload):
        return jsonify({"error": "Session has been revoked"}), 401

    @app.errorhandler(CSRFError)
    def handle_csrf_error(error):
        return jsonify({"error": "Security token missing or invalid", "detail": str(error)}), 403

    @app.errorhandler(429)
    def handle_rate_limit(e):
        return jsonify({
            "error": "rate_limit_exceeded",
            "message": "Too many requests. Please try again later.",
        }), 429

    @app.after_request
    def apply_security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=()",
        )

        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"

        return response

    @app.after_request
    def record_http_metrics(response):
        """Increment the HTTP request counter after every response.

        Uses Flask's request.endpoint (the registered view function name) as
        the 'endpoint' label rather than the raw URL path.  Endpoint names are
        bounded in cardinality and never contain dynamic path parameters such
        as scan_id or user_id.

        Skips: the /metrics route itself, OPTIONS preflight requests, and
        requests that did not match any Flask endpoint (endpoint is None).
        """
        endpoint = request.endpoint or "unknown"
        # Do not instrument the metrics scrape endpoint — it would create a
        # trivial self-referential counter that adds no useful signal.
        if endpoint in ("metrics", "static") or request.method == "OPTIONS":
            return response
        try:
            from metrics import HTTP_REQUESTS_TOTAL
            HTTP_REQUESTS_TOTAL.labels(
                method=request.method,
                endpoint=endpoint,
                status=str(response.status_code),
            ).inc()
        except Exception:  # noqa: BLE001 — never let metrics raise
            pass
        return response

    # Create database tables.
    # Schema management is now handled exclusively by Alembic/Flask-Migrate.
    # Run `flask db upgrade` before starting the application.
    # (db.create_all and ensure_runtime_migrations have been retired — Phase 2B.2)

    # Ensure upload folder exists
    import os as _os
    _os.makedirs(app.config.get("UPLOAD_FOLDER", "uploads"), exist_ok=True)
    app.config["MAX_CONTENT_LENGTH"] = app.config.get("MAX_UPLOAD_SIZE_MB", 16) * 1024 * 1024

    # Register blueprints
    from auth.routes import auth_bp
    from api.catalog import catalog_bp
    from api.chat import chat_bp
    from api.dashboard import dashboard_bp
    from api.dataset import dataset_bp
    from api.evidence import evidence_bp
    from api.export import export_bp
    from api.insights import insights_bp
    from api.results import results_bp
    from api.scan import scan_bp
    from api.geo import geo_bp
    from api.timeline import timeline_bp
    from api.heatmap import heatmap_bp
    from api.schedule import schedule_bp
    from api.webhooks import webhook_bp
    from api.history import history_bp
    from api.audit import audit_bp
    from api.admin import admin_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(scan_bp)
    app.register_blueprint(results_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(catalog_bp)
    app.register_blueprint(export_bp)
    app.register_blueprint(evidence_bp)
    app.register_blueprint(dataset_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(insights_bp)
    app.register_blueprint(geo_bp)
    app.register_blueprint(timeline_bp)
    app.register_blueprint(heatmap_bp)
    app.register_blueprint(schedule_bp)
    app.register_blueprint(webhook_bp)
    app.register_blueprint(history_bp)
    app.register_blueprint(audit_bp)
    app.register_blueprint(admin_bp)

    # ── Static frontend serving ──────────────────────────────────────────────
    # The production frontend is the Vite/React build output in
    # frontend-react/dist/.  In the Docker image the Dockerfile builds this
    # directory before copying it into the image at /app/frontend-react/dist.
    # For local development, run `npm run build` inside frontend-react/ first,
    # or use `npm run dev` (port 5173) which proxies /api to Flask on port 5000.
    import sys
    if getattr(sys, 'frozen', False):
        # PyInstaller bundle — kept for back-compat, unlikely to be used.
        base_dir = sys._MEIPASS
        frontend_dir = os.path.join(base_dir, "frontend-react", "dist")
    else:
        frontend_dir = os.path.abspath(
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "..", "frontend-react", "dist",
            )
        )

    @app.route("/")
    def serve_index():
        return send_from_directory(frontend_dir, "index.html")

    @app.route("/favicon.svg")
    def serve_favicon():
        return send_from_directory(frontend_dir, "favicon.svg")

    @app.route("/assets/<path:filename>")
    def serve_assets(filename):
        return send_from_directory(os.path.join(frontend_dir, "assets"), filename)

    # SPA catch-all: any GET that is not an /api/* or /metrics path and does
    # not match a static-asset route above is served as index.html so that
    # React Router can handle client-side navigation (direct URL access,
    # browser refresh on /dashboard, /scan, etc.).
    # Exception: paths that start with "api/" but were not matched by any
    # blueprint are unknown API endpoints — return 404 JSON rather than HTML
    # so that callers receive a machine-readable error response.
    @app.route("/<path:path>")
    def serve_spa(path):  # noqa: ARG001
        if path.startswith("api/"):
            return jsonify({"error": "Not found"}), 404
        return send_from_directory(frontend_dir, "index.html")

    @app.route("/metrics")
    def metrics():
        """Prometheus metrics scrape endpoint.

        Protected by a static bearer token.  If METRICS_TOKEN is not
        configured, this endpoint returns 404 to prevent accidental public
        exposure.  Prometheus must supply:

            Authorization: Bearer <METRICS_TOKEN>
        """
        from flask import Response
        from prometheus_client import generate_latest, CONTENT_TYPE_LATEST

        configured_token = app.config.get("METRICS_TOKEN", "")

        # If no token is configured, disable the endpoint entirely.
        if not configured_token:
            return jsonify({"error": "Not found"}), 404

        # Extract bearer token from the Authorization header.
        auth_header = request.headers.get("Authorization", "")
        provided_token = ""
        if auth_header.startswith("Bearer "):
            provided_token = auth_header[len("Bearer "):]

        # Constant-time comparison prevents timing-oracle attacks.
        # Both operands are encoded to bytes as required by hmac.compare_digest.
        token_valid = bool(provided_token) and hmac.compare_digest(
            configured_token.encode("utf-8"),
            provided_token.encode("utf-8"),
        )

        if not token_valid:
            return jsonify({"error": "Unauthorized"}), 401

        return Response(generate_latest(), mimetype=CONTENT_TYPE_LATEST)


    @app.route("/api/health")
    def health():
        """Lightweight liveness probe — checks only that the process is alive."""
        return {"status": "ok", "service": "Sentinel"}

    @app.route("/api/ready")
    def ready():
        """Readiness probe — verifies that the database is reachable.

        Returns HTTP 200 when the application can serve DB-backed requests.
        Returns HTTP 503 when the database is unavailable.
        No exception detail is included in the response body.
        """
        try:
            db.session.execute(db.text("SELECT 1"))
            return jsonify({"status": "ready", "db": True}), 200
        except Exception:  # noqa: BLE001
            return jsonify({"status": "degraded", "db": False}), 503

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, host="0.0.0.0", port=5000)

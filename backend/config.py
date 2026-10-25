import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

_CONFIG_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _CONFIG_DIR.parent

# The local setup stores `.env` at the repo root, but we also support a
# backend-local `.env` for flexibility. Explicit paths make loading reliable
# no matter which directory the app is started from.
load_dotenv(_PROJECT_ROOT / ".env")
load_dotenv(_CONFIG_DIR / ".env")


def _env_bool(name, default="false"):
    return os.getenv(name, default).strip().lower() == "true"


def _env_list(name, default=""):
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


class Config:
    """Application configuration."""

    SECRET_KEY = os.getenv("SECRET_KEY", "osint-footprint-secret-key-change-in-production")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "jwt-super-secret-key-change-in-production")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=24)
    JWT_TOKEN_LOCATION = ["headers", "cookies"]
    JWT_COOKIE_CSRF_PROTECT = True
    JWT_CSRF_CHECK_FORM = False
    JWT_ACCESS_CSRF_HEADER_NAME = "X-CSRF-TOKEN"
    JWT_COOKIE_SECURE = _env_bool("JWT_COOKIE_SECURE")
    JWT_COOKIE_SAMESITE = os.getenv("JWT_COOKIE_SAMESITE", "Strict")
    SESSION_COOKIE_SECURE = JWT_COOKIE_SECURE
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = JWT_COOKIE_SAMESITE

    # Database
    BASE_DIR = str(_CONFIG_DIR)
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{os.path.join(BASE_DIR, 'footprint.db')}",
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Browser access control
    CORS_ORIGINS = _env_list(
        "CORS_ORIGINS",
        "http://localhost:5000,http://127.0.0.1:5000",
    )

    # SearxNG
    SEARXNG_URL = os.getenv("SEARXNG_URL", "http://localhost:8888/search")
    SEARXNG_ENABLED = os.getenv("SEARXNG_ENABLED", "false").lower() == "true"
    SEARXNG_TIME_RANGE = os.getenv("SEARXNG_TIME_RANGE", "month")

    # Task queue / workers
    TASK_QUEUE_ENABLED = os.getenv("TASK_QUEUE_ENABLED", "false").lower() == "true"
    CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
    CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")
    SCAN_QUEUE_NAME = os.getenv("SCAN_QUEUE_NAME", "scan-jobs")

    # DigiLocker OAuth2
    DIGILOCKER_CLIENT_ID = os.getenv("DIGILOCKER_CLIENT_ID", "")
    DIGILOCKER_CLIENT_SECRET = os.getenv("DIGILOCKER_CLIENT_SECRET", "")
    DIGILOCKER_REDIRECT_URI = os.getenv(
        "DIGILOCKER_REDIRECT_URI",
        "http://localhost:5000/api/auth/digilocker/callback",
    )
    DIGILOCKER_AUTH_URL = "https://digilocker.meripehchaan.gov.in/public/oauth2/1/authorize"
    DIGILOCKER_TOKEN_URL = "https://digilocker.meripehchaan.gov.in/public/oauth2/1/token"
    DIGILOCKER_USERINFO_URL = "https://digilocker.meripehchaan.gov.in/public/oauth2/1/user"

    # Google OAuth2 / OpenID Connect
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_REDIRECT_URI = os.getenv(
        "GOOGLE_REDIRECT_URI",
        "http://localhost:5000/api/auth/google/callback",
    )
    GOOGLE_DISCOVERY_URL = os.getenv(
        "GOOGLE_DISCOVERY_URL",
        "https://accounts.google.com/.well-known/openid-configuration",
    )

    # Authentication hardening
    AUTH_LOCKOUT_THRESHOLD = int(os.getenv("AUTH_LOCKOUT_THRESHOLD", "5"))
    AUTH_LOCKOUT_MINUTES = int(os.getenv("AUTH_LOCKOUT_MINUTES", "15"))
    PASSWORD_MIN_LENGTH = int(os.getenv("PASSWORD_MIN_LENGTH", "10"))
    SELF_SCAN_ONLY = _env_bool("SELF_SCAN_ONLY", "true")

    # Scan limits
    MAX_QUICK_SCAN_SITES = 100
    MAX_FULL_SCAN_URLS = 20
    REQUEST_TIMEOUT = 10
    REQUEST_JITTER_MIN = 0.1
    REQUEST_JITTER_MAX = 0.5

    # AI features — powered by OpenAI
    # Gemini/GEMINI_API_KEY was removed in the Sentinel migration; use OPENAI_API_KEY instead.
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # OSINT Plugin API Keys (all optional — plugins skip gracefully if empty)
    SHODAN_API_KEY = os.getenv("SHODAN_API_KEY", "")
    NUMVERIFY_API_KEY = os.getenv("NUMVERIFY_API_KEY", "")
    HUNTER_API_KEY = os.getenv("HUNTER_API_KEY", "")
    CLEARBIT_API_KEY = os.getenv("CLEARBIT_API_KEY", "")
    INTELX_API_KEY = os.getenv("INTELX_API_KEY", "")
    GOOGLE_VISION_KEY = os.getenv("GOOGLE_VISION_KEY", "")
    PIMEYES_API_KEY = os.getenv("PIMEYES_API_KEY", "")
    HIBP_API_KEY = os.getenv("HIBP_API_KEY", "")

    # Nitter instances for Twitter/X scraping
    NITTER_INSTANCES = _env_list("NITTER_INSTANCES", "nitter.net,nitter.poast.org")

    # Dataset upload
    MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "16"))
    MAX_DATASET_ROWS = int(os.getenv("MAX_DATASET_ROWS", "10000"))
    # Maximum number of columns permitted in an uploaded dataset.
    # Uploads wider than this are rejected before any downstream processing.
    MAX_DATASET_COLUMNS = int(os.getenv("MAX_DATASET_COLUMNS", "500"))
    # Maximum number of datasets a single user may hold at one time.
    # Enforced at upload time via a COUNT query; no schema change required.
    MAX_DATASETS_PER_USER = int(os.getenv("MAX_DATASETS_PER_USER", "20"))
    # Maximum length (characters) of the user-supplied dataset description.
    MAX_DATASET_DESCRIPTION_LENGTH = int(os.getenv("MAX_DATASET_DESCRIPTION_LENGTH", "1000"))
    UPLOAD_FOLDER = os.path.join(BASE_DIR, "uploads")

    # Rate limiting
    # Default: in-process memory storage — safe for local development, resets on
    # every restart, and does not share counters across Gunicorn workers.
    # Production MUST override this via the environment variable:
    #   RATELIMIT_STORAGE_URI=redis://redis:6379/1
    # validate_secrets() rejects memory:// when APP_ENV=production so that a
    # misconfigured deployment fails clearly rather than silently using per-process
    # storage across multiple workers.  This is already set correctly in
    # docker-compose.yaml for dfas-web.
    RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")

    # Per-user rate limits for expensive dataset endpoints.
    # Values use Flask-Limiter's string format, e.g. "10 per hour".
    # Key is authenticated user ID (see limiter.user_rate_limit_key).
    DATASET_UPLOAD_RATE_LIMIT = os.getenv("DATASET_UPLOAD_RATE_LIMIT", "10 per hour")
    DATASET_CHAT_RATE_LIMIT = os.getenv("DATASET_CHAT_RATE_LIMIT", "30 per hour")
    DATASET_INSIGHTS_RATE_LIMIT = os.getenv("DATASET_INSIGHTS_RATE_LIMIT", "10 per hour")

    # Application environment — controls production-safety enforcement.
    # Set APP_ENV=production in any environment that is not local development.
    # Anything other than "production" is treated as non-enforcing.
    APP_ENV = os.getenv("APP_ENV", "development").strip().lower()

    # Prometheus /metrics access token.
    # If set, GET /metrics requires:  Authorization: Bearer <METRICS_TOKEN>
    # If empty (default), /metrics returns 404 to prevent accidental public exposure.
    # In Docker deployments, set this to a strong random value and configure
    # Prometheus scrape_configs with bearer_token accordingly.
    METRICS_TOKEN = os.getenv("METRICS_TOKEN", "")


# ── Insecure-default values that are rejected when APP_ENV=production ─────────
_INSECURE_SECRET_DEFAULTS = {
    "osint-footprint-secret-key-change-in-production",
    "jwt-super-secret-key-change-in-production",
    # Also reject .env.example placeholder strings
    "change-this-in-production",
    "change-this-jwt-key-in-production",
    "",
}


def validate_secrets(app_config: dict) -> None:
    """Raise RuntimeError if insecure or unsafe configuration is detected in production.

    Production mode is signalled explicitly by setting ``APP_ENV=production``
    in the environment.  Any other value (including the default "development")
    is treated as non-enforcing so that local development continues to work
    without real secrets configured.

    This explicit signal is preferred over DB-URI heuristics because a
    developer could intentionally use PostgreSQL locally, and inferring
    production from the database type would produce false positives.

    This function is called from ``create_app()`` immediately after config
    loading so that misconfigured deployments fail fast with a clear message
    rather than silently operating with known credentials.

    Checks performed when APP_ENV=production:
    - SECRET_KEY must be set and not use a known placeholder.
    - JWT_SECRET_KEY must be set and not use a known placeholder.
    - RATELIMIT_STORAGE_URI must not be ``memory://``.  Using in-process memory
      storage across multiple Gunicorn workers means each worker maintains an
      independent counter, rendering rate limits ineffective.  Set
      ``RATELIMIT_STORAGE_URI=redis://redis:6379/1`` (already done in
      docker-compose.yaml) or another shared backend.

    The actual secret values are NEVER printed or included in the error message.
    """
    if app_config.get("APP_ENV", "development") != "production":
        # Not production — skip enforcement.
        return

    errors = []

    secret_key = app_config.get("SECRET_KEY", "")
    if not secret_key or secret_key in _INSECURE_SECRET_DEFAULTS:
        errors.append(
            "SECRET_KEY is not set or uses the insecure default value. "
            "Set a strong random SECRET_KEY in your environment."
        )

    jwt_secret_key = app_config.get("JWT_SECRET_KEY", "")
    if not jwt_secret_key or jwt_secret_key in _INSECURE_SECRET_DEFAULTS:
        errors.append(
            "JWT_SECRET_KEY is not set or uses the insecure default value. "
            "Set a strong random JWT_SECRET_KEY in your environment."
        )

    ratelimit_uri = app_config.get("RATELIMIT_STORAGE_URI", "memory://")
    if not ratelimit_uri or ratelimit_uri.startswith("memory://"):
        errors.append(
            "RATELIMIT_STORAGE_URI is set to 'memory://' in a production environment. "
            "Each Gunicorn worker maintains an independent in-process counter, making "
            "rate limits ineffective across workers. "
            "Set RATELIMIT_STORAGE_URI=redis://redis:6379/1 (or another shared backend)."
        )

    if errors:
        raise RuntimeError(
            "Application startup aborted — insecure configuration detected:\n"
            + "\n".join(f"  • {e}" for e in errors)
        )

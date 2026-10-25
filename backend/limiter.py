"""Rate limiter — shared singleton instance.

Flask-Limiter requires that the same ``Limiter`` object is imported by every
blueprint that needs ``@limiter.limit()``.  The standard pattern is to create
the instance in a dedicated module and import it wherever needed, then call
``limiter.init_app(app)`` inside the application factory.

Storage backend is controlled by ``RATELIMIT_STORAGE_URI`` in Config:

- **Local development / test:** ``memory://`` (default) — no Redis required,
  counters reset on restart, not shared across processes.
- **Production:** ``redis://redis:6379/1`` — shared across all Gunicorn workers
  so that rate limits are correctly enforced regardless of which worker handles
  a request.  ``validate_secrets()`` rejects ``memory://`` when
  ``APP_ENV=production`` so that a misconfigured deployment fails fast rather
  than silently providing per-process (ineffective) rate limiting.
"""

from flask import g
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    # Default limits apply to every route unless overridden by a decorator.
    # Set conservatively: most authenticated API traffic is exempt because we
    # only decorate specific endpoints below.  Routes that should be completely
    # unrestricted must not have a @limiter.limit() decorator.
    default_limits=[],
    # Storage URI will be set from app.config["RATELIMIT_STORAGE_URI"] during
    # init_app().  An explicit storage_uri here would override the config, so
    # we leave it absent and rely on the Flask-Limiter config key instead.
)


def user_rate_limit_key() -> str:
    """Rate-limit key function that identifies requests by authenticated user ID.

    Must be used together with ``@require_auth`` placed **above**
    ``@limiter.limit(...)`` in the decorator stack so that ``g.current_user``
    is guaranteed to be set when this function runs.

    Falls back to an empty string for unauthenticated requests so that the
    limiter never raises an uncaught AttributeError.  In practice the three
    dataset endpoints already require authentication, so an unauthenticated
    request will be rejected by ``@require_auth`` before the route body (and
    the limiter) execute.

    Using the authenticated user ID rather than the request IP ensures that:
    - Different users behind the same NAT/proxy are counted independently.
    - A single user cannot exhaust the quota of others.
    """
    current_user = getattr(g, "current_user", None)
    if current_user is None:
        return ""
    return str(current_user.id)

"""Phase 7C regression tests — Redis rate-limit storage default (F7-OPS-01).

These tests are entirely static: they call validate_secrets() directly and
inspect config.py source code.  No running Redis, HTTP server, or database
is required.

Coverage:
  F7-OPS-01-A: Production + memory:// → RuntimeError (fail-fast).
  F7-OPS-01-B: Production + valid Redis URI → accepted.
  F7-OPS-01-C: Production + empty RATELIMIT_STORAGE_URI → RuntimeError.
  F7-OPS-01-D: Production + memory://localhost variant → RuntimeError.
  F7-OPS-01-E: Development + memory:// → accepted (no enforcement).
  F7-OPS-01-F: Testing env + memory:// → accepted (no enforcement).
  F7-OPS-01-G: Production + rediss:// (TLS) URI → accepted.
  F7-OPS-01-H: Existing SECRET_KEY / JWT_SECRET_KEY checks still raise.
  F7-OPS-01-I: All three errors accumulate in one RuntimeError.
  F7-OPS-01-J: Error message mentions RATELIMIT_STORAGE_URI explicitly.
  F7-OPS-01-K: Default in Config class is memory:// (safe for local dev).
  F7-OPS-01-L: config.py comment documents the production requirement.
  F7-OPS-01-M: limiter.py documents fail-fast behaviour.
  F7-OPS-01-N: RATELIMIT_STORAGE_URI configurable via environment variable.
"""

import os
import sys
import unittest

# ── helpers ───────────────────────────────────────────────────────────────────

_STRONG_SECRET   = "a-very-strong-production-secret-key-32c!"
_STRONG_JWT      = "a-very-strong-production-jwt-key-32char!"
_REDIS_URI       = "redis://redis:6379/1"
_REDISS_URI      = "rediss://redis:6380/1"

_GOOD_PROD = {
    "APP_ENV": "production",
    "SECRET_KEY": _STRONG_SECRET,
    "JWT_SECRET_KEY": _STRONG_JWT,
    "RATELIMIT_STORAGE_URI": _REDIS_URI,
}


def _validate(**overrides):
    """Call validate_secrets with a valid base production config, applying overrides."""
    from config import validate_secrets
    cfg = dict(_GOOD_PROD)
    cfg.update(overrides)
    validate_secrets(cfg)


# ── test class ────────────────────────────────────────────────────────────────

class TestPhase7CRatelimitStorage(unittest.TestCase):
    """F7-OPS-01: Production must use shared Redis-backed rate-limit storage."""

    # ── A: memory:// in production ────────────────────────────────────────────

    def test_a_production_memory_raises(self):
        """F7-OPS-01-A: Production + memory:// triggers RuntimeError."""
        from config import validate_secrets
        with self.assertRaises(RuntimeError):
            _validate(RATELIMIT_STORAGE_URI="memory://")

    # ── B: valid Redis URIs accepted in production ────────────────────────────

    def test_b_production_redis_accepted(self):
        """F7-OPS-01-B: Production + redis://... is accepted without error."""
        try:
            _validate(RATELIMIT_STORAGE_URI="redis://redis:6379/1")
        except RuntimeError as e:
            self.fail(f"redis:// should be accepted in production, got: {e}")

    def test_b2_production_redis_db0_accepted(self):
        """F7-OPS-01-B: redis:// on DB 0 is accepted (not all deployments use DB 1)."""
        try:
            _validate(RATELIMIT_STORAGE_URI="redis://redis:6379/0")
        except RuntimeError as e:
            self.fail(f"redis://...0 should be accepted: {e}")

    def test_b3_production_redis_with_password_accepted(self):
        """F7-OPS-01-B: redis:// with credentials accepted."""
        try:
            _validate(RATELIMIT_STORAGE_URI="redis://:password@redis:6379/1")
        except RuntimeError as e:
            self.fail(f"redis:// with password should be accepted: {e}")

    # ── C: empty RATELIMIT_STORAGE_URI in production ──────────────────────────

    def test_c_production_empty_raises(self):
        """F7-OPS-01-C: Production + empty RATELIMIT_STORAGE_URI triggers RuntimeError."""
        from config import validate_secrets
        with self.assertRaises(RuntimeError):
            _validate(RATELIMIT_STORAGE_URI="")

    # ── D: memory://localhost variant rejected ────────────────────────────────

    def test_d_production_memory_localhost_raises(self):
        """F7-OPS-01-D: memory://localhost is caught by the startswith guard."""
        from config import validate_secrets
        with self.assertRaises(RuntimeError):
            _validate(RATELIMIT_STORAGE_URI="memory://localhost")

    # ── E: development + memory:// passes ────────────────────────────────────

    def test_e_development_memory_accepted(self):
        """F7-OPS-01-E: Development + memory:// must not raise (local dev default)."""
        from config import validate_secrets
        try:
            validate_secrets({
                "APP_ENV": "development",
                "SECRET_KEY": "change-this-in-production",
                "JWT_SECRET_KEY": "change-this-jwt-key-in-production",
                "RATELIMIT_STORAGE_URI": "memory://",
            })
        except RuntimeError as e:
            self.fail(f"development mode must not enforce rate-limit storage: {e}")

    # ── F: testing env + memory:// passes ────────────────────────────────────

    def test_f_testing_memory_accepted(self):
        """F7-OPS-01-F: APP_ENV=testing with memory:// must not raise."""
        from config import validate_secrets
        try:
            validate_secrets({
                "APP_ENV": "testing",
                "RATELIMIT_STORAGE_URI": "memory://",
            })
        except RuntimeError as e:
            self.fail(f"testing env must not enforce rate-limit storage: {e}")

    # ── G: rediss:// (TLS) URI accepted ──────────────────────────────────────

    def test_g_production_rediss_tls_accepted(self):
        """F7-OPS-01-G: rediss:// (TLS-encrypted Redis) is accepted in production."""
        try:
            _validate(RATELIMIT_STORAGE_URI="rediss://redis:6380/1")
        except RuntimeError as e:
            self.fail(f"rediss:// (TLS) should be accepted in production: {e}")

    # ── H: existing SECRET_KEY / JWT_SECRET_KEY checks still raise ───────────

    def test_h_existing_secret_key_check_unchanged(self):
        """F7-OPS-01-H: SECRET_KEY placeholder still rejected (existing behaviour)."""
        from config import validate_secrets
        with self.assertRaises(RuntimeError):
            validate_secrets({
                "APP_ENV": "production",
                "SECRET_KEY": "change-this-in-production",
                "JWT_SECRET_KEY": _STRONG_JWT,
                "RATELIMIT_STORAGE_URI": _REDIS_URI,
            })

    def test_h2_existing_jwt_key_check_unchanged(self):
        """F7-OPS-01-H: JWT_SECRET_KEY placeholder still rejected (existing behaviour)."""
        from config import validate_secrets
        with self.assertRaises(RuntimeError):
            validate_secrets({
                "APP_ENV": "production",
                "SECRET_KEY": _STRONG_SECRET,
                "JWT_SECRET_KEY": "change-this-jwt-key-in-production",
                "RATELIMIT_STORAGE_URI": _REDIS_URI,
            })

    # ── I: errors accumulate – all three bad → one RuntimeError ──────────────

    def test_i_all_three_errors_accumulate(self):
        """F7-OPS-01-I: When all three fields are misconfigured, one RuntimeError
        contains all three error messages (fail-fast is not first-error-only)."""
        from config import validate_secrets
        try:
            validate_secrets({
                "APP_ENV": "production",
                "SECRET_KEY": "change-this-in-production",
                "JWT_SECRET_KEY": "change-this-jwt-key-in-production",
                "RATELIMIT_STORAGE_URI": "memory://",
            })
            self.fail("Should have raised RuntimeError")
        except RuntimeError as e:
            msg = str(e)
            self.assertIn("SECRET_KEY", msg,
                          "RuntimeError must mention SECRET_KEY misconfiguration")
            self.assertIn("JWT_SECRET_KEY", msg,
                          "RuntimeError must mention JWT_SECRET_KEY misconfiguration")
            self.assertIn("RATELIMIT_STORAGE_URI", msg,
                          "RuntimeError must mention RATELIMIT_STORAGE_URI misconfiguration")

    # ── J: error message content ──────────────────────────────────────────────

    def test_j_error_message_mentions_ratelimit_uri(self):
        """F7-OPS-01-J: The RuntimeError message explicitly names RATELIMIT_STORAGE_URI."""
        from config import validate_secrets
        try:
            _validate(RATELIMIT_STORAGE_URI="memory://")
            self.fail("Should have raised")
        except RuntimeError as e:
            self.assertIn("RATELIMIT_STORAGE_URI", str(e),
                          "Error message must name the misconfigured variable")

    def test_j2_error_message_does_not_include_secret_values(self):
        """F7-OPS-01-J: The RuntimeError message must not reveal actual URI value."""
        from config import validate_secrets
        sentinel_value = "memory://super-secret-token@localhost"
        try:
            _validate(RATELIMIT_STORAGE_URI=sentinel_value)
            self.fail("Should have raised")
        except RuntimeError as e:
            self.assertNotIn(
                "super-secret-token", str(e),
                "Error message must not include the actual RATELIMIT_STORAGE_URI value",
            )

    # ── K: Config default is memory:// ───────────────────────────────────────

    def test_k_config_class_default_is_memory(self):
        """F7-OPS-01-K: Config.RATELIMIT_STORAGE_URI defaults to memory:// when
        the env variable is absent (safe for local development without Redis)."""
        saved = os.environ.pop("RATELIMIT_STORAGE_URI", None)
        try:
            # Re-import Config with env var absent — requires importlib.reload
            import importlib
            import config as cfg_module
            importlib.reload(cfg_module)
            self.assertEqual(
                cfg_module.Config.RATELIMIT_STORAGE_URI, "memory://",
                "Config.RATELIMIT_STORAGE_URI must default to 'memory://' when "
                "RATELIMIT_STORAGE_URI env var is not set",
            )
        finally:
            if saved is not None:
                os.environ["RATELIMIT_STORAGE_URI"] = saved
            # Reload to restore normal state for subsequent tests
            import importlib
            import config as cfg_module
            importlib.reload(cfg_module)

    # ── L: config.py documents production requirement ────────────────────────

    def test_l_config_py_documents_production_requirement(self):
        """F7-OPS-01-L: config.py must document that production requires Redis."""
        with open("config.py") as f:
            src = f.read()
        self.assertIn(
            "validate_secrets()", src,
            "config.py RATELIMIT_STORAGE_URI comment must reference validate_secrets()",
        )
        self.assertIn(
            "redis://redis:6379/1", src,
            "config.py must show the canonical Redis URI example",
        )

    # ── M: limiter.py documents fail-fast behaviour ───────────────────────────

    def test_m_limiter_py_documents_fail_fast(self):
        """F7-OPS-01-M: limiter.py docstring must mention validate_secrets() enforcement."""
        with open("limiter.py") as f:
            src = f.read()
        self.assertIn(
            "validate_secrets()", src,
            "limiter.py docstring must mention the production validation mechanism",
        )
        self.assertIn(
            "memory://", src,
            "limiter.py must mention memory:// as the local dev default",
        )

    # ── N: RATELIMIT_STORAGE_URI env var is honoured ─────────────────────────

    def test_n_env_var_overrides_default(self):
        """F7-OPS-01-N: RATELIMIT_STORAGE_URI env variable overrides the default."""
        import importlib
        import config as cfg_module

        saved = os.environ.get("RATELIMIT_STORAGE_URI")
        os.environ["RATELIMIT_STORAGE_URI"] = "redis://myredis:6379/2"
        try:
            importlib.reload(cfg_module)
            self.assertEqual(
                cfg_module.Config.RATELIMIT_STORAGE_URI, "redis://myredis:6379/2",
                "Config.RATELIMIT_STORAGE_URI must reflect the RATELIMIT_STORAGE_URI env var",
            )
        finally:
            if saved is None:
                os.environ.pop("RATELIMIT_STORAGE_URI", None)
            else:
                os.environ["RATELIMIT_STORAGE_URI"] = saved
            importlib.reload(cfg_module)


if __name__ == "__main__":
    unittest.main(verbosity=2)

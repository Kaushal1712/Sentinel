"""Regression tests for _utc_isoformat() and Scan.to_dict() timestamp serialization.

Root cause context
------------------
SQLite DATETIME columns are stored without timezone markers.
SQLAlchemy returns them as naive datetime objects (tzinfo=None).
Python's isoformat() on a naive datetime omits the timezone suffix.
JavaScript's new Date() treats such strings as *local* time, not UTC —
on IST (UTC+5:30) this inflates elapsed-time displays by exactly 330 minutes.

These tests verify:
- _utc_isoformat() appends 'Z' to naive datetimes.
- _utc_isoformat() does NOT append 'Z' to already timezone-aware datetimes.
- _utc_isoformat() does not produce double suffixes (no 'Z+00:00' etc.).
- Scan.to_dict() returns created_at and completed_at with a UTC marker.
- The JS-parseable strings produce the correct epoch when parsed as UTC.
"""

import sys, os, unittest
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(__file__))

from database import _utc_isoformat


class TestUtcIsoformat(unittest.TestCase):

    # ------------------------------------------------------------------ naive
    def test_naive_datetime_gets_Z_suffix(self):
        dt = datetime(2026, 10, 19, 9, 48, 16, 63731)
        result = _utc_isoformat(dt)
        self.assertTrue(result.endswith("Z"),
            f"Expected trailing 'Z', got: {result!r}")

    def test_naive_datetime_correct_value(self):
        dt = datetime(2026, 10, 19, 9, 48, 16, 63731)
        self.assertEqual(_utc_isoformat(dt), "2026-10-19T09:48:16.063731Z")

    def test_naive_datetime_no_existing_offset(self):
        """Naive datetime must not produce a double-marker like 'Z+00:00'."""
        dt = datetime(2026, 1, 1, 0, 0, 0)
        result = _utc_isoformat(dt)
        self.assertNotIn("+", result)
        self.assertEqual(result.count("Z"), 1)

    def test_naive_midnight_zero_microseconds(self):
        dt = datetime(2026, 1, 1, 0, 0, 0)
        self.assertEqual(_utc_isoformat(dt), "2026-01-01T00:00:00Z")

    # ------------------------------------------- already timezone-aware (UTC)
    def test_utc_aware_datetime_no_extra_Z(self):
        dt = datetime(2026, 10, 19, 9, 48, 16, 63731, tzinfo=timezone.utc)
        result = _utc_isoformat(dt)
        # isoformat() on a UTC-aware datetime returns '+00:00', not 'Z'
        self.assertIn("+00:00", result)
        self.assertNotIn("Z+", result)   # no double marker
        self.assertFalse(result.endswith("ZZ"))

    def test_utc_aware_no_double_suffix(self):
        dt = datetime(2026, 10, 19, 9, 48, 16, tzinfo=timezone.utc)
        result = _utc_isoformat(dt)
        # Must contain exactly one timezone indicator
        has_z = result.endswith("Z")
        has_offset = "+00:00" in result
        self.assertTrue(has_z or has_offset,
            f"No UTC marker in result: {result!r}")
        self.assertFalse(has_z and has_offset,
            f"Double timezone marker in result: {result!r}")

    # --------------------------------------------- non-UTC aware (e.g. +05:30)
    def test_ist_aware_datetime_passthrough(self):
        ist = timezone(timedelta(hours=5, minutes=30))
        dt = datetime(2026, 10, 19, 15, 18, 16, tzinfo=ist)
        result = _utc_isoformat(dt)
        self.assertIn("+05:30", result)
        self.assertNotIn("Z", result)

    # ------------------------------------------------- JS epoch correctness
    def test_naive_serialized_string_encodes_correct_utc_epoch(self):
        """The produced string, parsed by a JS-compatible ISO parser, must
        yield the same UTC epoch as the original naive datetime (treated as UTC).

        We cannot run JS here, so verify via Python's own parser that the
        string round-trips to the same UTC epoch.
        """
        from datetime import datetime, timezone
        original_naive = datetime(2026, 10, 19, 9, 48, 16, 63731)
        serialized = _utc_isoformat(original_naive)    # → "2026-10-19T09:48:16.063731Z"

        # Parse back — the 'Z' should be interpreted as UTC
        # Python 3.11+ fromisoformat handles Z; use replace for broad compat
        parsed = datetime.fromisoformat(serialized.replace("Z", "+00:00"))
        self.assertEqual(parsed.utctimetuple(), original_naive.utctimetuple())
        self.assertIsNotNone(parsed.tzinfo, "Parsed datetime must be UTC-aware")


class TestScanToDictTimestamps(unittest.TestCase):
    """Verify Scan.to_dict() returns timestamps with explicit UTC markers.

    Uses a disposable in-memory SQLite database — does NOT touch footprint.db.
    """

    def setUp(self):
        import os
        os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
        os.environ.setdefault("APP_ENV", "development")
        # RATELIMIT_ENABLED=False prevents Flask-Limiter memory storage
        # conflicts in a test process (Python 3.13+ compatibility).
        from app import create_app
        from database import db, User, Scan
        self.app = create_app({
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "RATELIMIT_ENABLED": False,
        })
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()

        u = User(email="ts@test.local", role="analyst", full_name="TS")
        u.set_password("testpass123")
        db.session.add(u)
        db.session.commit()

        scan = Scan(
            user_id=u.id,
            target_name="Test Target",
            target_username="ttest",
            status="completed",
        )
        db.session.add(scan)
        db.session.commit()
        # Force a naive completed_at (simulates SQLite read-back)
        scan.completed_at = datetime(2026, 10, 19, 10, 0, 31, 213699)
        db.session.commit()
        self.scan = scan
        self.db = db

    def tearDown(self):
        self.db.session.remove()
        self.db.drop_all()
        self.ctx.pop()

    def test_created_at_has_utc_marker(self):
        d = self.scan.to_dict()
        ca = d["created_at"]
        self.assertIsNotNone(ca)
        has_marker = ca.endswith("Z") or ca.endswith("+00:00")
        self.assertTrue(has_marker,
            f"created_at missing UTC marker: {ca!r}")

    def test_completed_at_has_utc_marker(self):
        d = self.scan.to_dict()
        ca = d["completed_at"]
        self.assertIsNotNone(ca)
        has_marker = ca.endswith("Z") or ca.endswith("+00:00")
        self.assertTrue(has_marker,
            f"completed_at missing UTC marker: {ca!r}")

    def test_created_at_no_double_suffix(self):
        ca = self.scan.to_dict()["created_at"]
        self.assertNotIn("Z+", ca)
        self.assertNotIn("+00:00Z", ca)

    def test_completed_at_value_preserved(self):
        """The timestamp value must not be shifted by the serialisation fix."""
        ca = self.scan.to_dict()["completed_at"]
        # Should encode 10:00:31 UTC — check the time portion survives intact
        self.assertIn("10:00:31", ca)

    def test_null_completed_at_returns_none(self):
        from database import Scan, db, User
        scan2 = Scan(
            user_id=self.scan.user_id,
            target_name="Pending",
            target_username="ptest",
            status="pending",
        )
        db.session.add(scan2)
        db.session.commit()
        d = scan2.to_dict()
        self.assertIsNone(d["completed_at"])


if __name__ == "__main__":
    unittest.main()

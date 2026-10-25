"""Regression tests for ScheduledScan.to_dict() timestamp serialization.

Uses unsaved model instances only — no database, Flask app, or network.
"""

import unittest
from datetime import datetime, timezone

from database import ScheduledScan


def _sched(**kw):
    return ScheduledScan(id=1, user_id=1, target_username="u", frequency="weekly", **kw)


class TestScheduledScanToDict(unittest.TestCase):
    def test_naive_utc_timestamps_end_with_z(self):
        s = _sched(
            created_at=datetime(2026, 10, 23, 9, 57, 1),
            next_run=datetime(2026, 10, 30, 9, 57, 1),
            last_run=datetime(2026, 10, 16, 9, 57, 1),
        )
        d = s.to_dict()
        self.assertEqual(d["created_at"], "2026-10-23T09:57:01Z")
        self.assertEqual(d["next_run"], "2026-10-30T09:57:01Z")
        self.assertEqual(d["last_run"], "2026-10-16T09:57:01Z")

    def test_none_values_stay_none(self):
        d = _sched(created_at=None, next_run=None, last_run=None).to_dict()
        self.assertIsNone(d["created_at"])
        self.assertIsNone(d["next_run"])
        self.assertIsNone(d["last_run"])

    def test_aware_datetime_not_double_suffixed(self):
        d = _sched(next_run=datetime(2026, 10, 30, 9, 57, tzinfo=timezone.utc)).to_dict()
        self.assertEqual(d["next_run"], "2026-10-30T09:57:00+00:00")
        self.assertNotIn("Z", d["next_run"])


if __name__ == "__main__":
    unittest.main()

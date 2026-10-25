"""Regression tests: HIBP plugin must not produce simulated breach data.

These tests verify that:
- When HIBP_API_KEY is absent, analyze_email() returns {} (empty dict, no breaches).
- The check_breaches() caller correctly treats an empty dict as "no result" and
  produces an empty list (no category="breach" discovery item).
- The graph builder therefore emits zero breach_found risk events and the
  risk score contains no spurious breach contribution.

All external HTTP calls are mocked. No real HIBP API is contacted.
No database, Flask context, or network access is required.
"""

import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.dirname(__file__))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _FakeClient:
    """Minimal async HTTP client stub — must never be reached when key is absent."""
    async def get(self, *args, **kwargs):
        raise AssertionError("HTTP client should not be called when HIBP_API_KEY is absent")


def _no_key_patch():
    """Context manager: patch current_app so no key is returned from Flask config."""
    return patch(
        "core.plugins.hibp.current_app",
        MagicMock(**{"config.get.return_value": None}),
    )


# ---------------------------------------------------------------------------
# Test: analyze_email with no API key
# ---------------------------------------------------------------------------

class TestAnalyzeEmailNoKey(unittest.TestCase):
    """analyze_email() must return {} when HIBP_API_KEY is not set."""

    def setUp(self):
        os.environ.pop("HIBP_API_KEY", None)

    def test_returns_empty_dict_without_api_key(self):
        """analyze_email() must return {} (not a dict with breaches) when no key."""
        from core.plugins.hibp import analyze_email
        with _no_key_patch():
            result = asyncio.run(analyze_email("test@example.com", _FakeClient()))
        self.assertEqual(result, {}, f"Expected empty dict, got: {result!r}")

    def test_no_breaches_key_in_result(self):
        """Result must not contain a 'breaches' key that callers would process."""
        from core.plugins.hibp import analyze_email
        with _no_key_patch():
            result = asyncio.run(analyze_email("test@example.com", _FakeClient()))
        self.assertNotIn("breaches", result)

    def test_no_simulated_breach_name(self):
        """The Simulated_DataTracker_Breach placeholder must not appear."""
        from core.plugins.hibp import analyze_email
        with _no_key_patch():
            result = asyncio.run(analyze_email("test@example.com", _FakeClient()))
        result_str = str(result)
        self.assertNotIn("Simulated_DataTracker_Breach", result_str)
        self.assertNotIn("datatracker.example.com", result_str)

    def test_empty_email_returns_empty_dict(self):
        """Empty email short-circuits before any key check — no client call."""
        from core.plugins.hibp import analyze_email
        with _no_key_patch():
            result = asyncio.run(analyze_email("", _FakeClient()))
        self.assertEqual(result, {})

    def test_warning_logged_not_error(self):
        """Missing key must emit a WARNING mentioning HIBP_API_KEY, not raise."""
        import logging
        from core.plugins.hibp import analyze_email
        with _no_key_patch():
            with self.assertLogs("core.plugins.hibp", level=logging.WARNING) as log_ctx:
                asyncio.run(analyze_email("test@example.com", _FakeClient()))
        messages = "\n".join(log_ctx.output)
        self.assertIn("HIBP_API_KEY", messages)
        self.assertNotIn("simulated", messages.lower())


# ---------------------------------------------------------------------------
# Test: check_breaches() caller behaviour
# ---------------------------------------------------------------------------

class TestCheckBreachesNoKey(unittest.TestCase):
    """check_breaches() must return [] when analyze_email() returns {}."""

    def setUp(self):
        os.environ.pop("HIBP_API_KEY", None)

    def _run_check(self, email):
        """Inline reimplementation of check_breaches() logic for isolation."""
        from core.plugins.hibp import analyze_email

        async def _inner():
            with _no_key_patch():
                rich_data = await analyze_email(email, _FakeClient())
            if rich_data and rich_data.get("breaches"):
                return [{"platform": "HaveIBeenPwned", "category": "breach",
                         "confidence": 1.0, "rich_data": rich_data}]
            return []

        return asyncio.run(_inner())

    def test_check_breaches_returns_empty_list_without_key(self):
        """No breach discovery item must be produced when HIBP key is absent."""
        result = self._run_check("user@example.com")
        self.assertEqual(result, [], f"Expected empty list, got: {result!r}")

    def test_no_breach_category_item_without_key(self):
        """No item with category='breach' must appear in the result list."""
        results = self._run_check("user@example.com")
        categories = [r.get("category") for r in results]
        self.assertNotIn("breach", categories)


# ---------------------------------------------------------------------------
# Test: risk score is not inflated by a missing HIBP key
# ---------------------------------------------------------------------------

class TestRiskScoreNoHibpKey(unittest.TestCase):
    """breach_found must not appear in risk_events when HIBP returns no data."""

    def setUp(self):
        os.environ.pop("HIBP_API_KEY", None)

    def test_no_breach_found_event_when_rich_data_empty(self):
        """graph_builder emits zero breach_found events when rich_data={}."""
        from core.graph_builder import IdentityGraphBuilder

        gb = IdentityGraphBuilder()
        results = [
            {"platform": "GitHub", "url": "https://github.com/user", "username": "user",
             "category": "developer", "confidence": 0.9, "rich_data": {}},
            {"platform": "Reddit", "url": "https://reddit.com/u/user", "username": "user",
             "category": "social", "confidence": 0.8, "rich_data": {}},
        ]
        gb.build_from_scan_results("Test User", "", "user", results, [])

        breach_events = [e for e in gb.risk_events if e[0] == "breach_found"]
        self.assertEqual(breach_events, [],
                         f"Unexpected breach_found events: {breach_events}")

    def test_risk_score_without_breach_stays_below_critical(self):
        """2 profiles and no breach must not reach CRITICAL (>=8.0)."""
        from core.graph_builder import IdentityGraphBuilder

        gb = IdentityGraphBuilder()
        results = [
            {"platform": "GitHub", "url": "https://github.com/user", "username": "user",
             "category": "developer", "confidence": 0.9, "rich_data": {}},
            {"platform": "Reddit", "url": "https://reddit.com/u/user", "username": "user",
             "category": "social", "confidence": 0.8, "rich_data": {}},
        ]
        gb.build_from_scan_results("Test User", "", "user", results, [])
        score = gb.calculate_risk_score()

        self.assertLess(score, 8.0,
                        f"Score {score} reached CRITICAL without a real breach")
        self.assertIn(gb.get_risk_level(score), ("low", "medium"))

    def test_analyze_email_returns_empty_dict_without_key(self):
        """After the fix, analyze_email returns {} when no API key → no breach data."""
        from core.plugins.hibp import analyze_email
        with _no_key_patch():
            result = asyncio.run(analyze_email("user@example.com", _FakeClient()))
        has_breaches = bool(result and result.get("breaches"))
        self.assertFalse(has_breaches,
                         "analyze_email must not return breaches without a real API key")


# ---------------------------------------------------------------------------
# Test: real HIBP API path preserved (key present, HTTP mocked)
# ---------------------------------------------------------------------------

class TestAnalyzeEmailWithKey(unittest.TestCase):
    """When HIBP_API_KEY is set, analyze_email() must call the real API."""

    def setUp(self):
        os.environ["HIBP_API_KEY"] = "test-key-12345"
        self._app_patcher = patch(
            "core.plugins.hibp.current_app",
            MagicMock(**{"config.get.return_value": "test-key-12345"}),
        )
        self._app_patcher.start()

    def tearDown(self):
        os.environ.pop("HIBP_API_KEY", None)
        self._app_patcher.stop()

    def test_real_breach_returned_when_api_200(self):
        """A mocked 200 response from HIBP produces a populated breaches list."""
        from core.plugins.hibp import analyze_email

        fake_response = MagicMock()
        fake_response.status_code = 200
        fake_response.json.return_value = [{
            "Name": "TestBreachDB",
            "Domain": "testbreach.com",
            "BreachDate": "2022-01-01",
            "DataClasses": ["Passwords", "Usernames"],
        }]

        class _RealKeyClient:
            async def get(self, *args, **kwargs):
                return fake_response

        async def _run():
            with patch("asyncio.sleep", new=AsyncMock()):
                return await analyze_email("user@example.com", _RealKeyClient())

        result = asyncio.run(_run())
        self.assertIn("breaches", result)
        self.assertEqual(len(result["breaches"]), 1)
        self.assertEqual(result["breaches"][0]["name"], "TestBreachDB")

    def test_no_breach_on_404(self):
        """HIBP 404 (account not found) must produce {} — no breach data."""
        from core.plugins.hibp import analyze_email

        fake_response = MagicMock()
        fake_response.status_code = 404

        class _NotFoundClient:
            async def get(self, *args, **kwargs):
                return fake_response

        async def _run():
            with patch("asyncio.sleep", new=AsyncMock()):
                return await analyze_email("clean@example.com", _NotFoundClient())

        result = asyncio.run(_run())
        self.assertEqual(result, {})


if __name__ == "__main__":
    unittest.main()

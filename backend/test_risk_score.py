"""Regression tests for the two-component risk-scoring formula in IdentityGraphBuilder.

Formula recap
-------------
score = min(10.0, exposure + breadth)

  exposure = sum of EXPOSURE_WEIGHTS[event] for each exposure event
             (breach_found, phone_public, email_public, real_name_linked)

  breadth  = min(BREADTH_MAX, BREADTH_SCALE * log2(1 + n_breadth_events))
             for events in BREADTH_CATEGORIES
             (social_profile_found, dev_profile_found, name_mention,
              username_multiple_platforms)

  Unknown event types are deliberately ignored (contribute 0.0).

These tests require no database, Flask context, or network access.
"""

import math
import unittest

# Pure-Python import — no app context needed.
from core.graph_builder import (
    IdentityGraphBuilder,
    EXPOSURE_WEIGHTS,
    BREADTH_CATEGORIES,
    BREADTH_SCALE,
    BREADTH_MAX,
)


def _builder_with_events(*event_types):
    """Return an IdentityGraphBuilder pre-populated with the given risk event types."""
    gb = IdentityGraphBuilder()
    for et in event_types:
        # (event_type, detail, source) — detail and source are not used by scoring
        gb.risk_events.append((et, "detail", "http://example.com"))
    return gb


def _expected_score(*event_types):
    """Reference implementation of the proposed formula for test assertions."""
    exposure = 0.0
    n_breadth = 0
    for et in event_types:
        if et in EXPOSURE_WEIGHTS:
            exposure += EXPOSURE_WEIGHTS[et]
        elif et in BREADTH_CATEGORIES:
            n_breadth += 1
    breadth = (
        min(BREADTH_MAX, BREADTH_SCALE * math.log2(1 + n_breadth))
        if n_breadth else 0.0
    )
    return round(min(10.0, exposure + breadth), 1)


class TestRiskScoreFormula(unittest.TestCase):
    """Six mandated regression scenarios, each with score and level assertions."""

    # ── Scenario 1: Empty scan ───────────────────────────────────────────────
    def test_empty_scan_score_is_zero(self):
        """No events → score 0.0, level LOW."""
        gb = _builder_with_events()
        score = gb.calculate_risk_score()
        self.assertEqual(score, 0.0)
        self.assertEqual(gb.get_risk_level(score), "low")

    # ── Scenario 2: Five social profiles, no entities ───────────────────────
    def test_five_social_profiles_not_critical(self):
        """5 social_profile_found → score MEDIUM (<= 5.0), not CRITICAL.

        Under the old formula this saturated at 10.0/CRITICAL.
        """
        gb = _builder_with_events(*["social_profile_found"] * 5)
        score = gb.calculate_risk_score()
        expected = _expected_score(*["social_profile_found"] * 5)
        self.assertEqual(score, expected)
        self.assertLess(score, 6.0, "5 social profiles must not reach HIGH")
        self.assertEqual(gb.get_risk_level(score), "medium")

    # ── Scenario 3: 81 social profiles, no entities (Scan #3 scenario) ──────
    def test_81_social_profiles_capped_at_medium(self):
        """81 social_profile_found (Scan #3 real-world case) -> MEDIUM, not CRITICAL.

        Breadth component is capped at BREADTH_MAX (5.0 < 6.0 HIGH threshold).
        """
        gb = _builder_with_events(*["social_profile_found"] * 81)
        score = gb.calculate_risk_score()
        self.assertEqual(score, BREADTH_MAX)  # exactly at the cap
        self.assertLess(score, 6.0, "Profile count alone must not reach HIGH")
        self.assertEqual(gb.get_risk_level(score), "medium")

    # ── Scenario 4: One confirmed breach ─────────────────────────────────────
    def test_single_breach_not_critical(self):
        """1 breach_found -> MEDIUM (4.0), not immediately CRITICAL.

        Under the old formula a single breach weight of 10.0 saturated the
        normalization to 10.0/CRITICAL.
        """
        gb = _builder_with_events("breach_found")
        score = gb.calculate_risk_score()
        self.assertEqual(score, EXPOSURE_WEIGHTS["breach_found"])  # 4.0
        self.assertLess(score, 8.0, "One breach must not reach CRITICAL")
        self.assertEqual(gb.get_risk_level(score), "medium")

    # ── Scenario 5: Two confirmed breaches → CRITICAL ─────────────────────
    def test_two_breaches_critical(self):
        """2 breach_found -> CRITICAL (8.0).

        Two independently confirmed breaches represent verified data exposure
        severe enough to warrant the highest alert level.
        """
        gb = _builder_with_events("breach_found", "breach_found")
        score = gb.calculate_risk_score()
        expected = round(EXPOSURE_WEIGHTS["breach_found"] * 2, 1)  # 8.0
        self.assertEqual(score, expected)
        self.assertGreaterEqual(score, 8.0)
        self.assertEqual(gb.get_risk_level(score), "critical")

    # ── Scenario 6: Realistic mixed (many profiles + email + breach) ─────────
    def test_mixed_realistic_scan_critical(self):
        """20 social profiles + email_public + breach_found -> CRITICAL (10.0).

        This represents a real-world high-exposure subject: wide profile
        footprint, confirmed breach, and a public email address.
        """
        events = (
            ["social_profile_found"] * 20
            + ["email_public", "breach_found"]
        )
        gb = _builder_with_events(*events)
        score = gb.calculate_risk_score()
        expected = _expected_score(*events)
        self.assertEqual(score, expected)
        self.assertEqual(score, 10.0)
        self.assertEqual(gb.get_risk_level(score), "critical")


class TestRiskScoreBoundaries(unittest.TestCase):
    """Additional boundary and contract tests."""

    def test_breadth_caps_at_breadth_max(self):
        """Arbitrarily large profile counts must not exceed BREADTH_MAX."""
        for n in (10, 50, 500, 10_000):
            gb = _builder_with_events(*["social_profile_found"] * n)
            score = gb.calculate_risk_score()
            self.assertLessEqual(
                score, BREADTH_MAX,
                f"Breadth exceeded BREADTH_MAX with n={n} social profiles",
            )

    def test_exposure_accumulates_across_multiple_events(self):
        """Multiple different exposure events add up correctly."""
        gb = _builder_with_events("email_public", "phone_public")
        score = gb.calculate_risk_score()
        expected = round(
            EXPOSURE_WEIGHTS["email_public"] + EXPOSURE_WEIGHTS["phone_public"], 1
        )  # 2.5 + 3.0 = 5.5
        self.assertEqual(score, expected)
        self.assertEqual(gb.get_risk_level(score), "medium")

    def test_score_is_capped_at_ten(self):
        """Combined exposure + breadth must never exceed 10.0."""
        events = (
            ["breach_found"] * 5           # 5 * 4.0 = 20 exposure
            + ["social_profile_found"] * 100  # 5.0 breadth
        )
        gb = _builder_with_events(*events)
        score = gb.calculate_risk_score()
        self.assertEqual(score, 10.0)
        self.assertEqual(gb.get_risk_level(score), "critical")

    def test_dev_profile_counts_as_breadth(self):
        """dev_profile_found is a breadth event, not an exposure event."""
        gb = _builder_with_events("dev_profile_found")
        score = gb.calculate_risk_score()
        expected = _expected_score("dev_profile_found")
        self.assertEqual(score, expected)
        # 1 breadth event -> 2.0 * log2(2) = 2.0 -> LOW
        self.assertEqual(gb.get_risk_level(score), "low")

    def test_unknown_event_type_contributes_zero(self):
        """An unrecognised event type must not affect the score.

        Design choice: unknown events are silently ignored rather than being
        assigned a default weight, because an unvalidated contribution could
        inflate scores in an uncontrolled way when new event producers are added.
        """
        gb_baseline = _builder_with_events()
        gb_unknown = _builder_with_events("future_event_type_xyz", "another_unknown")
        self.assertEqual(
            gb_baseline.calculate_risk_score(),
            gb_unknown.calculate_risk_score(),
            "Unknown events must not change the score",
        )

    def test_real_name_linked_is_exposure_event(self):
        """real_name_linked contributes to exposure, not breadth."""
        gb = _builder_with_events("real_name_linked")
        score = gb.calculate_risk_score()
        self.assertEqual(score, EXPOSURE_WEIGHTS["real_name_linked"])  # 1.5

    def test_get_risk_level_thresholds_unchanged(self):
        """get_risk_level() boundaries remain at 3.0 / 6.0 / 8.0."""
        gb = IdentityGraphBuilder()
        self.assertEqual(gb.get_risk_level(0.0),  "low")
        self.assertEqual(gb.get_risk_level(2.9),  "low")
        self.assertEqual(gb.get_risk_level(3.0),  "medium")
        self.assertEqual(gb.get_risk_level(5.9),  "medium")
        self.assertEqual(gb.get_risk_level(6.0),  "high")
        self.assertEqual(gb.get_risk_level(7.9),  "high")
        self.assertEqual(gb.get_risk_level(8.0),  "critical")
        self.assertEqual(gb.get_risk_level(10.0), "critical")

    def test_risk_weights_alias_is_empty_dict(self):
        """RISK_WEIGHTS is preserved as an empty dict for backward compatibility."""
        from core.graph_builder import RISK_WEIGHTS
        self.assertIsInstance(RISK_WEIGHTS, dict)
        self.assertEqual(len(RISK_WEIGHTS), 0)


if __name__ == "__main__":
    unittest.main()

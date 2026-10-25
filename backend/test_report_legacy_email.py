"""Regression tests: legacy scans (input-email node stored without ``source``)
must not report the input email as publicly discovered. No DB/network needed."""

import unittest

from api.results import _reconstruct_node_metadata
from core.graph_builder import IdentityGraphBuilder
from core.reporter import ReportGenerator

TARGET = "Jane@Example.com"


def _rebuild(nodes, risk_events=()):
    """Mimic get_scan_report's reconstruction from stored (id, type, label, metadata)."""
    gb = IdentityGraphBuilder()
    for node_id, node_type, label, metadata in nodes:
        meta = _reconstruct_node_metadata(node_id, node_type, metadata, TARGET)
        gb.add_identity_node(node_id, node_type, label, **meta)
    gb.risk_events.extend(risk_events)
    return ReportGenerator.generate_report(gb, {"scan_id": 2, "target_name": "Jane"})


class TestLegacyInputEmail(unittest.TestCase):
    def test_helper_tags_legacy_input_node(self):
        meta = _reconstruct_node_metadata("email:jane@example.com", "email", {}, TARGET)
        self.assertEqual(meta["source"], "input")

    def test_helper_preserves_explicit_source(self):
        meta = _reconstruct_node_metadata("email:jane@example.com", "email", {"source": "breach"}, TARGET)
        self.assertEqual(meta["source"], "breach")

    def test_helper_does_not_tag_other_emails_or_types(self):
        self.assertNotIn("source", _reconstruct_node_metadata("email:other@example.com", "email", {}, TARGET))
        self.assertNotIn("source", _reconstruct_node_metadata("username:jane@example.com", "username", {}, TARGET))
        self.assertNotIn("source", _reconstruct_node_metadata("email:jane@example.com", "email", {}, None))

    def test_helper_does_not_mutate_input(self):
        stored = {}
        _reconstruct_node_metadata("email:jane@example.com", "email", stored, TARGET)
        self.assertEqual(stored, {})

    def test_legacy_input_email_makes_no_public_claim(self):
        report = _rebuild([("email:jane@example.com", "email", TARGET, {})])
        self.assertNotIn("email address(es)", report["summary"])

    def test_genuinely_discovered_email_counted(self):
        report = _rebuild(
            [
                ("email:jane@example.com", "email", TARGET, {}),
                ("email:found@example.org", "email", "found@example.org", {}),
            ],
            [("email_public", "found@example.org", "http://example.org")],
        )
        self.assertIn("1 email address(es) were found publicly accessible.", report["summary"])

    def test_breach_linked_email_counted(self):
        report = _rebuild([("email:leak@example.org", "email", "leak@example.org", {})])
        self.assertIn("1 email address(es)", report["summary"])


if __name__ == "__main__":
    unittest.main()

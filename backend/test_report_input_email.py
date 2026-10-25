"""Regression tests: the Risk Report must not claim a user-supplied (input) email
was "found publicly accessible". No database, Flask context, or network needed."""

import unittest

from core.graph_builder import IdentityGraphBuilder
from core.reporter import ReportGenerator

CLAIM = "found publicly accessible"


def _report(target_email, entities_list):
    gb = IdentityGraphBuilder()
    gb.build_from_scan_results("Jane Doe", target_email, None, [], entities_list)
    return gb, ReportGenerator.generate_report(gb, {"scan_id": 1, "target_name": "Jane Doe"})


class TestInputEmailSummary(unittest.TestCase):
    def test_input_node_is_marked(self):
        gb, _ = _report("jane@example.com", [])
        self.assertEqual(gb.graph.nodes["email:jane@example.com"]["source"], "input")

    def test_input_email_alone_makes_no_public_claim(self):
        _, report = _report("jane@example.com", [])
        self.assertNotIn(CLAIM, report["summary"])
        self.assertNotIn("email address(es)", report["summary"])

    def test_discovered_email_is_counted(self):
        entities = [{"url": "http://example.org/p", "emails": ["other@example.org"]}]
        _, report = _report("jane@example.com", entities)
        self.assertIn("1 email address(es) were found publicly accessible.", report["summary"])

    def test_input_email_also_found_publicly_is_counted(self):
        entities = [{"url": "http://example.org/p", "emails": ["jane@example.com"]}]
        _, report = _report("jane@example.com", entities)
        self.assertIn("1 email address(es) were found publicly accessible.", report["summary"])

    def test_breach_linked_email_is_counted(self):
        gb = IdentityGraphBuilder()
        gb.build_from_scan_results("Jane Doe", None, None, [], [])
        gb.add_identity_node("email:leak@example.com", "email", "leak@example.com")
        report = ReportGenerator.generate_report(gb, {"scan_id": 1, "target_name": "Jane Doe"})
        self.assertIn("1 email address(es)", report["summary"])


if __name__ == "__main__":
    unittest.main()

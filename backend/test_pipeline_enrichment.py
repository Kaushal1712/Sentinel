"""Regression tests for the EntitySet.ips AttributeError in pipeline enrichment.

Covers:
- EntitySet has an `ips` attribute (regression guard).
- extract_ips() extracts public IPv4 and filters private/loopback/reserved ranges.
- extract_entities() populates EntitySet.ips from full-page text.
- extract_from_snippet() initialises EntitySet.ips to an empty set.
- The entity-collection loop in _run_enrichment_and_intel() does not raise
  AttributeError when iterating EntitySet objects.
"""

import sys
import os
import unittest

sys.path.insert(0, os.path.dirname(__file__))


class TestEntitySetHasIpsField(unittest.TestCase):
    def setUp(self):
        from core.extractor import EntitySet
        self.EntitySet = EntitySet

    def test_ips_attribute_exists(self):
        """Regression: EntitySet must have an `ips` attribute."""
        es = self.EntitySet()
        self.assertTrue(hasattr(es, "ips"),
            "EntitySet missing 'ips' — pipeline enrichment will crash.")

    def test_ips_is_a_set(self):
        self.assertIsInstance(self.EntitySet().ips, set)

    def test_ips_initially_empty(self):
        self.assertEqual(self.EntitySet().ips, set())

    def test_existing_fields_still_present(self):
        es = self.EntitySet()
        for f in ("emails", "phones", "handles", "linked_urls", "platform_usernames"):
            self.assertTrue(hasattr(es, f), f"EntitySet missing '{f}'")


class TestExtractIps(unittest.TestCase):
    def setUp(self):
        from core.extractor import extract_ips
        self.extract_ips = extract_ips

    def test_public_ip_extracted(self):
        self.assertIn("8.8.4.4", self.extract_ips("Server at 8.8.4.4."))

    def test_multiple_public_ips(self):
        r = self.extract_ips("Hosts: 1.0.0.1 and 9.9.9.9")
        self.assertIn("1.0.0.1", r)
        self.assertIn("9.9.9.9", r)

    def test_loopback_filtered(self):
        self.assertNotIn("127.0.0.1", self.extract_ips("loop 127.0.0.1"))

    def test_rfc1918_10_filtered(self):
        self.assertNotIn("10.0.0.1", self.extract_ips("10.0.0.1"))

    def test_rfc1918_192_168_filtered(self):
        self.assertNotIn("192.168.1.1", self.extract_ips("gw 192.168.1.1"))

    def test_rfc1918_172_16_filtered(self):
        self.assertNotIn("172.16.0.1", self.extract_ips("172.16.0.1"))

    def test_rfc1918_172_31_filtered(self):
        self.assertNotIn("172.31.255.254", self.extract_ips("172.31.255.254"))

    def test_link_local_filtered(self):
        self.assertNotIn("169.254.1.1", self.extract_ips("169.254.1.1"))

    # --- RFC 5737 TEST-NET documentation ranges (previously missing) ---

    def test_testnet1_filtered(self):
        """192.0.2.0/24 — TEST-NET-1 (RFC 5737) must not pass to Shodan."""
        self.assertNotIn("192.0.2.1", self.extract_ips("192.0.2.1"))

    def test_testnet2_filtered(self):
        """198.51.100.0/24 — TEST-NET-2 (RFC 5737) must not pass to Shodan."""
        self.assertNotIn("198.51.100.1", self.extract_ips("198.51.100.1"))

    def test_testnet3_filtered(self):
        """203.0.113.0/24 — TEST-NET-3 (RFC 5737) must not pass to Shodan."""
        self.assertNotIn("203.0.113.1", self.extract_ips("203.0.113.1"))

    # --- Other IANA special-purpose ranges (previously missing) ---

    def test_cgn_shared_filtered(self):
        """100.64.0.0/10 — carrier-grade NAT shared space (RFC 6598)."""
        self.assertNotIn("100.64.0.1", self.extract_ips("100.64.0.1"))

    def test_ietf_protocol_assignments_filtered(self):
        """192.0.0.0/24 — IETF Protocol Assignments (RFC 6890)."""
        self.assertNotIn("192.0.0.1", self.extract_ips("192.0.0.1"))

    def test_benchmarking_filtered(self):
        """198.18.0.0/15 — benchmarking range (RFC 2544)."""
        self.assertNotIn("198.18.0.1", self.extract_ips("198.18.0.1"))

    def test_empty_text(self):
        self.assertEqual(self.extract_ips(""), set())

    def test_no_ips(self):
        self.assertEqual(self.extract_ips("no addresses"), set())

    def test_mixed_public_and_private(self):
        r = self.extract_ips("Public: 8.8.8.8, Private: 192.168.0.1, Also: 1.1.1.1")
        self.assertIn("8.8.8.8", r)
        self.assertIn("1.1.1.1", r)
        self.assertNotIn("192.168.0.1", r)


class TestExtractEntitiesPopulatesIps(unittest.TestCase):
    def setUp(self):
        from core.extractor import extract_entities
        self.extract_entities = extract_entities

    def test_public_ip_extracted_from_page(self):
        es = self.extract_entities("CDN: 104.21.0.1. Contact: admin@x.com", url="https://x.com")
        self.assertIn("104.21.0.1", es.ips)

    def test_private_ip_not_extracted(self):
        es = self.extract_entities("Internal: 10.0.0.5", url="https://x.com")
        self.assertNotIn("10.0.0.5", es.ips)

    def test_no_ips_plain_text(self):
        es = self.extract_entities("Nothing here.")
        self.assertEqual(es.ips, set())


class TestExtractFromSnippetHasEmptyIps(unittest.TestCase):
    def test_ips_is_empty_set(self):
        from core.extractor import extract_from_snippet
        es = extract_from_snippet("Server 8.8.8.8 mentioned", url="https://x.com")
        self.assertIsInstance(es.ips, set)
        self.assertEqual(es.ips, set())


class TestEnrichmentLoopDoesNotCrash(unittest.TestCase):
    """Reproduce the exact crash: ips.update(entities.ips) on an EntitySet."""

    def _make_entity_set(self, emails=(), phones=(), ips=()):
        from core.extractor import EntitySet
        es = EntitySet()
        es.emails = set(emails)
        es.phones = set(phones)
        es.ips = set(ips)
        return es

    def test_collection_loop_no_crash(self):
        all_entities = [
            self._make_entity_set(),
            self._make_entity_set(emails=["a@b.com"], phones=["555-0100"]),
        ]
        emails, phones, ips = set(), set(), set()
        for entities in all_entities:
            emails.update(entities.emails)
            phones.update(entities.phones)
            ips.update(entities.ips)      # <- the previously crashing line
        self.assertIn("a@b.com", emails)
        self.assertIn("555-0100", phones)
        self.assertEqual(ips, set())

    def test_collection_loop_collects_public_ips(self):
        all_entities = [
            self._make_entity_set(ips=["8.8.8.8"]),
            self._make_entity_set(ips=["1.1.1.1", "8.8.8.8"]),
        ]
        ips = set()
        for entities in all_entities:
            ips.update(entities.ips)
        self.assertEqual(ips, {"8.8.8.8", "1.1.1.1"})

    def test_attribute_error_is_gone(self):
        """Direct guard: accessing .ips must not raise AttributeError."""
        from core.extractor import EntitySet
        es = EntitySet()
        try:
            _ = es.ips
        except AttributeError as exc:
            self.fail(f"EntitySet.ips still missing: {exc}")


if __name__ == "__main__":
    unittest.main()

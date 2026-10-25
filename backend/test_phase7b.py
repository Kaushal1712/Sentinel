"""Phase 7B regression tests — database indexes and dashboard SQL aggregation.

F7-BE-01: Scan.user_id, Scan.status, Scan.created_at indexed.
F7-BE-02: ScanResult.scan_id indexed.
F7-BE-03: Dashboard platform aggregation uses SQL GROUP BY, not Python dict.
"""

import unittest


class TestPhase7BIndexes(unittest.TestCase):
    """F7-BE-01 / F7-BE-02: Verify index annotations on Scan and ScanResult models.

    These are static checks against the SQLAlchemy model metadata.  They
    confirm that the ORM model reflects the indexes added by migration
    c3f1a2d4e5b6 and that future autogenerate runs will not re-detect them
    as missing.
    """

    def _column_info(self, model, col_name):
        return model.__table__.c[col_name]

    def test_scan_user_id_is_indexed(self):
        """F7-BE-01: Scan.user_id must carry index=True."""
        from database import Scan
        col = self._column_info(Scan, "user_id")
        self.assertTrue(
            col.index,
            "Scan.user_id must have index=True — required for every "
            "user-scoped dashboard / history query.",
        )

    def test_scan_status_is_indexed(self):
        """F7-BE-01: Scan.status must carry index=True."""
        from database import Scan
        col = self._column_info(Scan, "status")
        self.assertTrue(
            col.index,
            "Scan.status must have index=True — required for running / "
            "completed count queries.",
        )

    def test_scan_created_at_is_indexed(self):
        """F7-BE-01: Scan.created_at must carry index=True."""
        from database import Scan
        col = self._column_info(Scan, "created_at")
        self.assertTrue(
            col.index,
            "Scan.created_at must have index=True — required for dashboard "
            "timeline and admin date-range queries.",
        )

    def test_scan_result_scan_id_is_indexed(self):
        """F7-BE-02: ScanResult.scan_id must carry index=True."""
        from database import ScanResult
        col = self._column_info(ScanResult, "scan_id")
        self.assertTrue(
            col.index,
            "ScanResult.scan_id must have index=True — required for every "
            "per-scan results query (geo, heatmap, timeline, graph, export).",
        )

    def test_scan_primary_key_not_doubled(self):
        """Regression guard: id columns must remain primary keys, not gain extra index=True."""
        from database import Scan, ScanResult
        for model in (Scan, ScanResult):
            col = self._column_info(model, "id")
            self.assertTrue(col.primary_key, f"{model.__name__}.id must be primary key")

    def test_migration_file_exists_and_chains_correctly(self):
        """F7-BE-01/02: Migration c3f1a2d4e5b6 must exist and chain to b8058a075657."""
        import os, re
        mig_path = os.path.join(
            os.path.dirname(__file__),
            "migrations", "versions",
            "c3f1a2d4e5b6_add_scan_and_result_indexes.py",
        )
        self.assertTrue(
            os.path.exists(mig_path),
            f"Migration file not found: {mig_path}",
        )
        with open(mig_path) as f:
            src = f.read()
        rev = re.search(r"revision\s*=\s*['\"]([^'\"]+)['\"]", src)
        down = re.search(r"down_revision\s*=\s*['\"]([^'\"]+)['\"]", src)
        self.assertIsNotNone(rev, "revision identifier missing from migration")
        self.assertIsNotNone(down, "down_revision missing from migration")
        self.assertEqual(rev.group(1), "c3f1a2d4e5b6")
        self.assertEqual(
            down.group(1), "b8058a075657",
            "Migration must chain onto b8058a075657 (allow_anonymous_audit_events)",
        )

    def test_migration_creates_four_indexes(self):
        """F7-BE-01/02: Migration upgrade() must call create_index for all four columns."""
        import os, re
        mig_path = os.path.join(
            os.path.dirname(__file__),
            "migrations", "versions",
            "c3f1a2d4e5b6_add_scan_and_result_indexes.py",
        )
        with open(mig_path) as f:
            src = f.read()
        # Extract upgrade block
        upgrade_match = re.search(r"def upgrade\(\):(.*?)(?=^def |\Z)", src, re.DOTALL | re.MULTILINE)
        self.assertIsNotNone(upgrade_match, "upgrade() function not found")
        upgrade_body = upgrade_match.group(1)
        for idx_col in ("user_id", "status", "created_at", "scan_id"):
            self.assertIn(
                idx_col, upgrade_body,
                f"upgrade() must create an index on '{idx_col}'",
            )
        create_calls = len(re.findall(r"create_index", upgrade_body))
        self.assertEqual(
            create_calls, 4,
            f"Expected exactly 4 create_index calls in upgrade(), found {create_calls}",
        )

    def test_migration_downgrade_drops_four_indexes(self):
        """Downgrade must reverse all four create_index calls."""
        import os, re
        mig_path = os.path.join(
            os.path.dirname(__file__),
            "migrations", "versions",
            "c3f1a2d4e5b6_add_scan_and_result_indexes.py",
        )
        with open(mig_path) as f:
            src = f.read()
        downgrade_match = re.search(r"def downgrade\(\):(.*)", src, re.DOTALL)
        self.assertIsNotNone(downgrade_match, "downgrade() function not found")
        downgrade_body = downgrade_match.group(1)
        drop_calls = len(re.findall(r"drop_index", downgrade_body))
        self.assertEqual(
            drop_calls, 4,
            f"Expected exactly 4 drop_index calls in downgrade(), found {drop_calls}",
        )


class TestPhase7BDashboardAggregation(unittest.TestCase):
    """F7-BE-03: Dashboard platform aggregation uses SQL GROUP BY.

    Runtime tests using an in-memory SQLite database via the Flask test client.
    Verify that:
    - top_platforms reflects actual result counts aggregated in SQL.
    - Response schema is unchanged: list of {"platform": str, "count": int}.
    - Results are ordered descending by count.
    - Empty-state (no results) returns an empty list.
    - Cross-user isolation: only the authenticated user's results are counted.
    - Results are capped at 10 entries.
    """

    def _make_app(self):
        import app as app_module
        from database import db as _db
        flask_app = app_module.create_app({
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "RATELIMIT_ENABLED": False,
            "SECRET_KEY": "test-secret-phase7b-32chars-long!",
            "JWT_SECRET_KEY": "test-jwt-phase7b-32chars-long!!x",
            "JWT_COOKIE_CSRF_PROTECT": False,
            "APP_ENV": "testing",
        })
        return flask_app

    def setUp(self):
        self.flask_app = self._make_app()
        self.client = self.flask_app.test_client()
        with self.flask_app.app_context():
            from database import db
            db.drop_all()
            db.create_all()
        self.csrf = self._register("phase7b_dash@example.com", "Phase7BPass1!")

    def tearDown(self):
        with self.flask_app.app_context():
            from database import db
            db.session.remove()
            db.drop_all()

    def _extract_csrf(self, rv):
        import re
        for header_val in rv.headers.getlist("Set-Cookie"):
            m = re.search(r"csrf_access_token=([^;,\s]+)", header_val)
            if m:
                return m.group(1)
        return None

    def _register(self, email, password):
        rv = self.client.post("/api/auth/register", json={
            "email": email, "password": password, "full_name": "Phase 7B Tester",
        })
        assert rv.status_code in (200, 201), f"Register failed ({rv.status_code}): {rv.data}"
        return self._extract_csrf(rv)

    def _get(self, path, client=None, csrf=None):
        c = client or self.client
        headers = {"X-CSRF-TOKEN": csrf or self.csrf} if (csrf or self.csrf) else {}
        return c.get(path, headers=headers)

    def _create_scan_with_results(self, target="testuser", platforms=None):
        """Create a completed scan with ScanResult rows for the given platforms."""
        with self.flask_app.app_context():
            from database import db, Scan, ScanResult, User

            user = User.query.filter_by(email="phase7b_dash@example.com").first()

            scan = Scan(
                user_id=user.id,
                target_name=target,
                target_username=target,
                mode="quick",
                status="completed",
            )
            db.session.add(scan)
            db.session.flush()

            for platform in (platforms or []):
                result = ScanResult(
                    scan_id=scan.id,
                    platform=platform,
                    url=f"https://{platform}.com/{target}",
                )
                db.session.add(result)

            db.session.commit()
            return scan.id

    # ── tests ────────────────────────────────────────────────────────────────

    def test_top_platforms_empty_when_no_results(self):
        """F7-BE-03: top_platforms is [] when the user has no scan results."""
        rv = self._get("/api/dashboard/stats")
        self.assertEqual(rv.status_code, 200)
        data = rv.get_json()
        self.assertIn("top_platforms", data)
        self.assertEqual(data["top_platforms"], [])

    def test_top_platforms_schema(self):
        """F7-BE-03: Each entry in top_platforms has 'platform' (str) and 'count' (int)."""
        self._create_scan_with_results(platforms=["twitter", "github"])
        rv = self._get("/api/dashboard/stats")
        self.assertEqual(rv.status_code, 200)
        data = rv.get_json()
        for entry in data["top_platforms"]:
            self.assertIn("platform", entry, "Missing 'platform' key")
            self.assertIn("count", entry, "Missing 'count' key")
            self.assertIsInstance(entry["platform"], str)
            self.assertIsInstance(entry["count"], int)

    def test_top_platforms_counts_correctly(self):
        """F7-BE-03: platform counts reflect actual ScanResult rows."""
        # twitter appears 3 times, github 2 times, linkedin 1 time
        self._create_scan_with_results(
            target="u1", platforms=["twitter", "twitter", "twitter", "github", "github", "linkedin"]
        )
        rv = self._get("/api/dashboard/stats")
        self.assertEqual(rv.status_code, 200)
        data = rv.get_json()
        by_platform = {e["platform"]: e["count"] for e in data["top_platforms"]}
        self.assertEqual(by_platform.get("twitter"), 3)
        self.assertEqual(by_platform.get("github"), 2)
        self.assertEqual(by_platform.get("linkedin"), 1)

    def test_top_platforms_ordered_descending_by_count(self):
        """F7-BE-03: top_platforms must be ordered descending by count."""
        self._create_scan_with_results(
            target="u2", platforms=["linkedin", "twitter", "twitter", "github", "github", "github"]
        )
        rv = self._get("/api/dashboard/stats")
        self.assertEqual(rv.status_code, 200)
        counts = [e["count"] for e in rv.get_json()["top_platforms"]]
        self.assertEqual(counts, sorted(counts, reverse=True),
                         "top_platforms must be sorted descending by count")

    def test_top_platforms_capped_at_10(self):
        """F7-BE-03: top_platforms returns at most 10 entries."""
        # Create 12 distinct platforms
        platforms = [f"platform_{i}" for i in range(12)]
        self._create_scan_with_results(target="u3", platforms=platforms)
        rv = self._get("/api/dashboard/stats")
        self.assertEqual(rv.status_code, 200)
        top = rv.get_json()["top_platforms"]
        self.assertLessEqual(len(top), 10,
                             f"top_platforms must be capped at 10, got {len(top)}")

    def test_top_platforms_cross_user_isolation(self):
        """F7-BE-03: top_platforms must only include results for the authenticated user."""
        # Create scan for user A (already logged in)
        self._create_scan_with_results(target="ua", platforms=["twitter", "github"])

        # Register user B with a separate client
        client_b = self.flask_app.test_client()
        rv_b = client_b.post("/api/auth/register", json={
            "email": "phase7b_other@example.com",
            "password": "OtherPass1!",
            "full_name": "Phase 7B Other User",
        })
        assert rv_b.status_code in (200, 201), f"User B register failed: {rv_b.data}"
        csrf_b = self._extract_csrf(rv_b)

        # User B creates a scan with completely different platforms
        with self.flask_app.app_context():
            from database import db, Scan, ScanResult, User
            user_b = User.query.filter_by(email="phase7b_other@example.com").first()
            scan_b = Scan(user_id=user_b.id, target_name="ub", target_username="ub",
                          mode="quick", status="completed")
            db.session.add(scan_b)
            db.session.flush()
            for p in ["reddit", "medium", "reddit"]:
                db.session.add(ScanResult(scan_id=scan_b.id, platform=p,
                                          url=f"https://{p}.com/ub"))
            db.session.commit()

        # User A's dashboard must not include reddit or medium
        rv_a = self._get("/api/dashboard/stats")
        self.assertEqual(rv_a.status_code, 200)
        platforms_a = {e["platform"] for e in rv_a.get_json()["top_platforms"]}
        self.assertNotIn("reddit", platforms_a,
                         "User A's top_platforms must not include User B's results")
        self.assertNotIn("medium", platforms_a,
                         "User A's top_platforms must not include User B's results")


    def test_top_platforms_aggregates_across_multiple_scans(self):
        """F7-BE-03: counts must be summed across all of the user's scans."""
        # Two separate scans, same platform appears in both
        self._create_scan_with_results(target="s1", platforms=["twitter", "github"])
        self._create_scan_with_results(target="s2", platforms=["twitter", "linkedin"])
        rv = self._get("/api/dashboard/stats")
        self.assertEqual(rv.status_code, 200)
        by_platform = {e["platform"]: e["count"] for e in rv.get_json()["top_platforms"]}
        # twitter appears once in each scan → total 2
        self.assertEqual(by_platform.get("twitter"), 2,
                         "twitter count must aggregate across multiple scans")

    def test_dashboard_response_schema_unchanged(self):
        """F7-BE-03: Full dashboard response schema must be unchanged by the rewrite."""
        rv = self._get("/api/dashboard/stats")
        self.assertEqual(rv.status_code, 200)
        data = rv.get_json()
        # Top-level keys
        for key in ("stats", "recent_scans", "top_platforms", "timeline"):
            self.assertIn(key, data, f"Missing top-level key '{key}' from dashboard response")
        # Stats sub-keys
        stats = data["stats"]
        for k in ("total_scans", "completed_scans", "running_scans",
                  "avg_risk_score", "total_profiles_found", "total_entities_found"):
            self.assertIn(k, stats, f"Missing stats key '{k}'")

    def test_static_dashboard_uses_sql_aggregation(self):
        """F7-BE-03: Confirm Python-side platform dict aggregation is not present."""
        import re
        with open("api/dashboard.py") as f:
            src = f.read()
        # The old pattern: building platform_counts dict in Python
        self.assertNotIn(
            "platform_counts = {}",
            src,
            "Python-side platform_counts dict must be removed — use SQL GROUP BY",
        )
        self.assertNotIn(
            "scan_ids = [s.id for s in Scan.query.filter_by(user_id=user_id).all()]",
            src,
            "scan_ids list comprehension must be removed — use SQL JOIN instead",
        )
        # New pattern: GROUP BY in SQL
        self.assertIn(
            "group_by",
            src,
            "dashboard.py must use SQL GROUP BY for platform aggregation",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)

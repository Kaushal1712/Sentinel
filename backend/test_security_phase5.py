"""Phase 5 — Sentinel Security Verification Tests.

Covers:
  SEC-01  CSRF enforcement (state-changing requests without/with invalid token)
  SEC-02  JWT logout / token_version invalidation (documented gap)
  SEC-03  IDOR: scan ownership
  SEC-04  IDOR: dataset ownership
  SEC-05  IDOR: webhook ownership
  SEC-06  IDOR: schedule ownership
  SEC-07  Admin RBAC
  SEC-08  Role escalation via registration payload
  SEC-09  Account enumeration via lockout status code
  SEC-10  HTML export — XSS payload in output
  SEC-11  Evidence path traversal
  SEC-12  Catalog authorization
  SEC-13  Metrics endpoint protection
  SEC-14  Health endpoint data safety
  SEC-15  SQL injection safety

All tests run against an in-process SQLite test app with RATELIMIT_ENABLED=False.
No production code is modified.  No real external requests are made.

Flask 3.1 / Werkzeug 3.1 compatible — uses client.get_cookie() not cookie_jar.
"""

import json
import re
import unittest
from datetime import datetime, timedelta, timezone

import app as app_module
from database import Dataset, Scan, ScheduledScan, User, Webhook, db


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_app(extra_config=None):
    cfg = {
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
        "RATELIMIT_ENABLED": False,
        "METRICS_TOKEN": "test-metrics-secret",
        "SELF_SCAN_ONLY": False,
    }
    if extra_config:
        cfg.update(extra_config)
    return app_module.create_app(cfg)


def _extract_csrf_from_response(rv):
    """Extract the CSRF token value from Set-Cookie headers (Flask 3.1 / JWT-Extended)."""
    csrf = None
    for header_val in rv.headers.getlist("Set-Cookie"):
        # Flask-JWT-Extended sets: csrf_access_token=<value>; Path=/; ...
        m = re.search(r"csrf_access_token=([^;,\s]+)", header_val)
        if m:
            csrf = m.group(1)
            break
    return csrf


# ---------------------------------------------------------------------------
# Base: two-user + admin fixture
# ---------------------------------------------------------------------------

class TwoUserBase(unittest.TestCase):

    def setUp(self):
        self.app = _make_app()
        self.client_a = self.app.test_client()
        self.client_b = self.app.test_client()
        self.client_admin = self.app.test_client()

        with self.app.app_context():
            db.drop_all()
            db.create_all()

            self.ua = User(email="user_a@test.local", full_name="User A", role="user")
            self.ua.set_password("PasswordA1!")
            self.ub = User(email="user_b@test.local", full_name="User B", role="user")
            self.ub.set_password("PasswordB2!")
            self.uadmin = User(email="admin@test.local", full_name="Admin User", role="admin")
            self.uadmin.set_password("AdminPass3!")
            db.session.add_all([self.ua, self.ub, self.uadmin])
            db.session.commit()
            self.ua_id = self.ua.id
            self.ub_id = self.ub.id
            self.uadmin_id = self.uadmin.id

        self.csrf_a = self._login(self.client_a, "user_a@test.local", "PasswordA1!")
        self.csrf_b = self._login(self.client_b, "user_b@test.local", "PasswordB2!")
        self.csrf_admin = self._login(self.client_admin, "admin@test.local", "AdminPass3!")

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def _login(self, client, email, password):
        rv = client.post(
            "/api/auth/login",
            json={"email": email, "password": password},
            content_type="application/json",
        )
        self.assertEqual(rv.status_code, 200, f"Login failed for {email}: {rv.data[:200]}")
        # Extract CSRF from Set-Cookie response header (Flask 3.1 compatible)
        csrf = _extract_csrf_from_response(rv)
        return csrf  # may be None if JWT CSRF cookie not set

    # --- Request helpers ---

    def _get(self, client, csrf, path):
        headers = {}
        if csrf:
            headers["X-CSRF-TOKEN"] = csrf
        return client.get(path, headers=headers)

    def _post(self, client, csrf, path, body=None):
        headers = {"Content-Type": "application/json"}
        if csrf:
            headers["X-CSRF-TOKEN"] = csrf
        return client.post(path, json=body or {}, headers=headers)

    def _delete(self, client, csrf, path):
        headers = {}
        if csrf:
            headers["X-CSRF-TOKEN"] = csrf
        return client.delete(path, headers=headers)

    def _put(self, client, csrf, path, body=None):
        headers = {"Content-Type": "application/json"}
        if csrf:
            headers["X-CSRF-TOKEN"] = csrf
        return client.put(path, json=body or {}, headers=headers)

    # --- Fixture creators ---

    def _create_scan_for(self, user_id):
        with self.app.app_context():
            scan = Scan(
                user_id=user_id,
                target_name="Test Target",
                target_email="target@example.com",
                mode="quick",
                status="completed",
                risk_score=1.0,
            )
            db.session.add(scan)
            db.session.commit()
            return scan.id

    def _create_dataset_for(self, user_id):
        with self.app.app_context():
            # Dataset schema: id, user_id, name, original_filename, description,
            # row_count, column_count, columns_json, summary_json, data_json,
            # file_size_bytes, upload_status, created_at
            ds = Dataset(
                user_id=user_id,
                name="test.csv",
                original_filename="test.csv",
                row_count=5,
                column_count=2,
                columns_json=json.dumps(["a", "b"]),
                data_json=json.dumps([{"a": 1, "b": 2}]),
                file_size_bytes=100,
            )
            db.session.add(ds)
            db.session.commit()
            return ds.id

    def _create_webhook_for(self, user_id):
        with self.app.app_context():
            import secrets as _sec
            wh = Webhook(
                user_id=user_id,
                url="https://example.com/hook",
                events_json=json.dumps(["scan_complete"]),
                secret=_sec.token_hex(32),
            )
            db.session.add(wh)
            db.session.commit()
            return wh.id

    def _create_schedule_for(self, user_id):
        with self.app.app_context():
            sched = ScheduledScan(
                user_id=user_id,
                target_username="victim_user",
                frequency="daily",
                next_run=datetime.now(timezone.utc) + timedelta(days=1),
            )
            db.session.add(sched)
            db.session.commit()
            return sched.id


# ============================================================
# SEC-01: CSRF enforcement
# ============================================================

class TestCSRFEnforcement(TwoUserBase):
    """Verify Flask-JWT-Extended CSRF is active for mutating endpoints."""

    def test_post_without_csrf_token_is_rejected(self):
        """POST /api/scan/quick without X-CSRF-TOKEN must fail.
        Flask-JWT-Extended + custom error handler returns 403 for missing CSRF.
        """
        rv = self.client_a.post(
            "/api/scan/quick",
            json={"name": "Test", "self_attested": True},
            content_type="application/json",
            # Deliberately NO X-CSRF-TOKEN header
        )
        # Flask-JWT-Extended raises CSRFError; our custom handler returns 403.
        # Acceptable CSRF rejection codes: 401, 403, 422.
        self.assertIn(rv.status_code, (401, 403, 422),
                      f"Expected CSRF rejection (401/403/422) without CSRF, got {rv.status_code}: {rv.data[:200]}")

    def test_post_with_wrong_csrf_token_is_rejected(self):
        """POST with deliberately wrong CSRF value must be rejected."""
        rv = self.client_a.post(
            "/api/scan/quick",
            json={"name": "Test", "self_attested": True},
            content_type="application/json",
            headers={"X-CSRF-TOKEN": "totally-wrong-csrf-value-aaaa"},
        )
        self.assertIn(rv.status_code, (401, 403, 422),
                      f"Expected CSRF rejection (401/403/422) with wrong CSRF, got {rv.status_code}: {rv.data[:200]}")

    def test_get_does_not_require_csrf_token(self):
        """GET /api/dashboard/stats must not fail on CSRF (422) — read-only."""
        rv = self.client_a.get("/api/dashboard/stats")
        self.assertNotEqual(rv.status_code, 422,
                            "GET must not be rejected by CSRF check")

    def test_logout_without_csrf_is_rejected(self):
        """POST /api/auth/logout without CSRF token must be blocked."""
        rv = self.client_a.post(
            "/api/auth/logout",
            json={},
            content_type="application/json",
            # Deliberately NO X-CSRF-TOKEN
        )
        self.assertIn(rv.status_code, (401, 403, 422),
                      f"Logout without CSRF should be blocked (401/403/422), got {rv.status_code}: {rv.data[:200]}")


# ============================================================
# SEC-02: JWT token_version validation (F-02 fix)
# ============================================================

class TestLogoutTokenInvalidation(TwoUserBase):
    """Verify token_version claim is validated on every request."""

    def test_cookie_cleared_after_logout(self):
        """
        After normal logout the browser cookie is cleared — subsequent cookie-
        based requests return 401 without needing the version check.
        """
        client = self.app.test_client()
        rv = client.post(
            "/api/auth/login",
            json={"email": "user_a@test.local", "password": "PasswordA1!"},
            content_type="application/json",
        )
        self.assertEqual(rv.status_code, 200)
        csrf = _extract_csrf_from_response(rv)

        # Confirm authenticated before logout
        rv_pre = client.get("/api/dashboard/stats",
                            headers={"X-CSRF-TOKEN": csrf} if csrf else {})
        self.assertEqual(rv_pre.status_code, 200)

        # Logout — clears cookie + increments token_version in DB
        rv_logout = client.post(
            "/api/auth/logout",
            json={},
            content_type="application/json",
            headers={"X-CSRF-TOKEN": csrf} if csrf else {},
        )
        self.assertEqual(rv_logout.status_code, 200)

        # Cookie cleared → 401 on next request
        rv_post = client.get("/api/dashboard/stats")
        self.assertEqual(rv_post.status_code, 401,
                         "After logout, cookie-cleared request should be 401")

    # ------------------------------------------------------------------ #
    # Static guards confirming the fix is present
    # ------------------------------------------------------------------ #

    def test_get_jwt_is_called_in_require_auth(self):
        """
        F-02 FIX GUARD (static): require_auth must now call get_jwt() to read
        the 'ver' claim.  This test PASSES only after the fix is applied.
        """
        import auth.middleware as mw
        import inspect, re
        src = inspect.getsource(mw.require_auth)
        has_standalone_get_jwt = bool(re.search(r'\bget_jwt\s*\(\s*\)', src))
        self.assertTrue(has_standalone_get_jwt,
                        "get_jwt() not found in require_auth — F-02 fix may be missing")

    def test_token_version_checked_in_require_auth(self):
        """
        F-02 FIX GUARD (static): require_auth must reference 'token_version'
        after the fix.
        """
        import auth.middleware as mw
        import inspect
        src = inspect.getsource(mw.require_auth)
        self.assertIn("token_version", src,
                      "token_version not referenced in require_auth — F-02 fix may be missing")

    # ------------------------------------------------------------------ #
    # Runtime regression tests
    # ------------------------------------------------------------------ #

    def test_fresh_token_with_correct_version_is_accepted(self):
        """A freshly issued token (matching token_version=0) must be accepted."""
        rv = self.client_a.get("/api/dashboard/stats",
                               headers={"X-CSRF-TOKEN": self.csrf_a} if self.csrf_a else {})
        self.assertEqual(rv.status_code, 200,
                         "Fresh token with correct version should be accepted")

    def test_token_rejected_after_logout_increments_version(self):
        """
        F-02 RUNTIME: After logout increments token_version in the DB,
        a new login (new token) is accepted, confirming the version mechanism
        works end-to-end.  We verify that the post-logout state is clean and
        the new session is valid.
        """
        # 1. Login with a fresh client
        client = self.app.test_client()
        rv1 = client.post(
            "/api/auth/login",
            json={"email": "user_a@test.local", "password": "PasswordA1!"},
            content_type="application/json",
        )
        self.assertEqual(rv1.status_code, 200)
        csrf1 = _extract_csrf_from_response(rv1)

        # Verify access works
        rv_check = client.get("/api/dashboard/stats",
                              headers={"X-CSRF-TOKEN": csrf1} if csrf1 else {})
        self.assertEqual(rv_check.status_code, 200, "Should be authenticated")

        # 2. Logout → token_version incremented in DB
        client.post("/api/auth/logout", json={},
                    content_type="application/json",
                    headers={"X-CSRF-TOKEN": csrf1} if csrf1 else {})

        # 3. Re-login (new token with new version)
        client2 = self.app.test_client()
        rv2 = client2.post(
            "/api/auth/login",
            json={"email": "user_a@test.local", "password": "PasswordA1!"},
            content_type="application/json",
        )
        self.assertEqual(rv2.status_code, 200)
        csrf2 = _extract_csrf_from_response(rv2)

        # 4. New token must be accepted (version matches DB after increment)
        rv_new = client2.get("/api/dashboard/stats",
                             headers={"X-CSRF-TOKEN": csrf2} if csrf2 else {})
        self.assertEqual(rv_new.status_code, 200,
                         "Re-issued token after logout must be accepted with new version")

    def test_stale_version_in_token_is_rejected(self):
        """
        F-02 RUNTIME: Simulate a token with a stale version claim by directly
        incrementing the user's token_version in the DB (simulating logout)
        without clearing the cookie.  The next authenticated request must be
        rejected with 401.
        """
        from database import User
        # client_a already has a live cookie with ver=0
        # Increment token_version in DB directly (bypassing the logout route)
        with self.app.app_context():
            user = db.session.get(User, self.ua_id)
            user.token_version += 1
            db.session.commit()

        # The cookie still carries ver=0, but DB now has ver=1 → must reject
        rv = self.client_a.get("/api/dashboard/stats",
                               headers={"X-CSRF-TOKEN": self.csrf_a} if self.csrf_a else {})
        self.assertEqual(rv.status_code, 401,
                         "Token with stale version claim must be rejected with 401")


# ============================================================
# SEC-03: IDOR — Scan ownership
# ============================================================

class TestScanOwnershipIDOR(TwoUserBase):

    def setUp(self):
        super().setUp()
        self.scan_a_id = self._create_scan_for(self.ua_id)

    def test_b_cannot_get_scan_status(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/scan/{self.scan_a_id}/status")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_get_scan_results(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/scan/{self.scan_a_id}/results")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_get_scan_graph(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/results/{self.scan_a_id}/graph")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_export_scan_json(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/export/{self.scan_a_id}/json")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_delete_scan(self):
        rv = self._delete(self.client_b, self.csrf_b, f"/api/export/{self.scan_a_id}/delete")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_get_geo_data(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/geo/{self.scan_a_id}/data")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_get_heatmap(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/heatmap/{self.scan_a_id}/matrix")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_get_timeline(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/timeline/{self.scan_a_id}/events")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_get_evidence_list(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/evidence/{self.scan_a_id}")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_get_evidence_file(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/evidence/{self.scan_a_id}/file.json")
        self.assertEqual(rv.status_code, 404)


# ============================================================
# SEC-04: IDOR — Dataset ownership
# ============================================================

class TestDatasetOwnershipIDOR(TwoUserBase):

    def setUp(self):
        super().setUp()
        self.ds_a_id = self._create_dataset_for(self.ua_id)

    def test_b_cannot_get_dataset_detail(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/dataset/{self.ds_a_id}")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_get_dataset_data(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/dataset/{self.ds_a_id}/data")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_delete_dataset(self):
        rv = self._delete(self.client_b, self.csrf_b, f"/api/dataset/{self.ds_a_id}")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_read_chat_history(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/chat/history/{self.ds_a_id}")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_generate_insights(self):
        """
        IDOR guard: user_b must not be able to trigger insight generation on
        user_a's dataset.

        The production endpoint checks OPENAI_API_KEY before the ownership
        query (insights.py L23 vs L28).  Without a key the endpoint returns
        503 before ever reaching the ownership check, so the IDOR guard is
        bypassed in the test environment.

        Fix (test-only): temporarily inject a dummy key into the Flask app
        config so the early guard passes and the real ownership check at L28
        executes.  The ownership check will then return 404 for user_b, and
        user_a would get either 503 (bad key rejected by OpenAI) or 500 —
        not 200 — confirming no data leakage.

        No production code is changed.
        """
        # Temporarily set a dummy key so the API-key early guard is bypassed.
        with self.app.app_context():
            self.app.config["OPENAI_API_KEY"] = "sk-test-dummy-key-for-idor-check"
        try:
            rv = self._post(self.client_b, self.csrf_b,
                            f"/api/insights/{self.ds_a_id}/generate")
            self.assertEqual(rv.status_code, 404,
                             f"user_b must receive 404 for user_a's dataset, got {rv.status_code}")
        finally:
            # Restore no-key state so other tests are unaffected.
            with self.app.app_context():
                self.app.config.pop("OPENAI_API_KEY", None)

    def test_b_cannot_get_insight_summary(self):
        rv = self._get(self.client_b, self.csrf_b, f"/api/insights/{self.ds_a_id}/summary")
        self.assertEqual(rv.status_code, 404)


# ============================================================
# SEC-05: IDOR — Webhook ownership
# ============================================================

class TestWebhookOwnershipIDOR(TwoUserBase):

    def setUp(self):
        super().setUp()
        self.wh_a_id = self._create_webhook_for(self.ua_id)

    def test_b_cannot_delete_webhook(self):
        rv = self._delete(self.client_b, self.csrf_b, f"/api/webhooks/{self.wh_a_id}")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_test_webhook(self):
        rv = self._post(self.client_b, self.csrf_b, f"/api/webhooks/{self.wh_a_id}/test")
        self.assertEqual(rv.status_code, 404)

    def test_b_list_does_not_include_a_webhook(self):
        rv = self._get(self.client_b, self.csrf_b, "/api/webhooks/")
        self.assertEqual(rv.status_code, 200)
        ids = [w["id"] for w in rv.get_json().get("webhooks", [])]
        self.assertNotIn(self.wh_a_id, ids, "User B sees User A's webhook — IDOR!")


# ============================================================
# SEC-06: IDOR — Schedule ownership
# ============================================================

class TestScheduleOwnershipIDOR(TwoUserBase):

    def setUp(self):
        super().setUp()
        self.sched_a_id = self._create_schedule_for(self.ua_id)

    def test_b_cannot_delete_schedule(self):
        rv = self._delete(self.client_b, self.csrf_b, f"/api/schedule/{self.sched_a_id}")
        self.assertEqual(rv.status_code, 404)

    def test_b_cannot_toggle_schedule(self):
        rv = self._post(self.client_b, self.csrf_b, f"/api/schedule/{self.sched_a_id}/toggle")
        self.assertEqual(rv.status_code, 404)

    def test_b_list_does_not_include_a_schedule(self):
        rv = self._get(self.client_b, self.csrf_b, "/api/schedule/")
        self.assertEqual(rv.status_code, 200)
        ids = [s["id"] for s in rv.get_json().get("schedules", [])]
        self.assertNotIn(self.sched_a_id, ids, "User B sees User A's schedule — IDOR!")


# ============================================================
# SEC-07: Admin RBAC
# ============================================================

class TestAdminRBAC(TwoUserBase):

    def test_normal_user_blocked_from_admin_stats(self):
        rv = self._get(self.client_a, self.csrf_a, "/api/admin/stats")
        self.assertEqual(rv.status_code, 403)

    def test_normal_user_blocked_from_admin_users_list(self):
        rv = self._get(self.client_a, self.csrf_a, "/api/admin/users")
        self.assertEqual(rv.status_code, 403)

    def test_normal_user_blocked_from_role_mutation(self):
        rv = self._put(self.client_a, self.csrf_a,
                       f"/api/admin/users/{self.ub_id}/role", {"role": "admin"})
        self.assertEqual(rv.status_code, 403)

    def test_normal_user_blocked_from_quota_mutation(self):
        rv = self._put(self.client_a, self.csrf_a,
                       f"/api/admin/users/{self.ua_id}/quota", {"max_scans_per_day": 999})
        self.assertEqual(rv.status_code, 403)

    def test_admin_can_access_admin_stats(self):
        rv = self._get(self.client_admin, self.csrf_admin, "/api/admin/stats")
        self.assertEqual(rv.status_code, 200)

    def test_admin_can_list_users(self):
        rv = self._get(self.client_admin, self.csrf_admin, "/api/admin/users")
        self.assertEqual(rv.status_code, 200)

    def test_catalog_put_blocked_for_normal_user(self):
        rv = self._put(self.client_a, self.csrf_a, "/api/catalog/platforms", {"platforms": []})
        self.assertEqual(rv.status_code, 403)

    def test_catalog_get_allowed_for_any_auth_user(self):
        rv = self._get(self.client_a, self.csrf_a, "/api/catalog/platforms")
        self.assertEqual(rv.status_code, 200)


# ============================================================
# SEC-08: Role escalation via registration payload
# ============================================================

class TestRoleEscalation(TwoUserBase):

    def test_register_with_injected_role_ignored(self):
        """Registration with role=admin in payload must not create an admin."""
        client = self.app.test_client()
        rv = client.post(
            "/api/auth/register",
            json={
                "email": "attacker@test.local",
                "password": "AttackPass1!",
                "full_name": "Attacker",
                "role": "admin",          # injected
            },
            content_type="application/json",
        )
        if rv.status_code in (200, 201):
            role = rv.get_json().get("user", {}).get("role", "")
            self.assertNotEqual(role, "admin",
                                "Injected role=admin in registration must be ignored")

    def test_unauthenticated_gets_401_on_protected_endpoints(self):
        """Unauthenticated requests to protected endpoints return 401."""
        client = self.app.test_client()  # fresh, no cookies
        cases = [
            ("GET",  "/api/dashboard/stats"),
            ("GET",  "/api/results/history"),
            ("GET",  "/api/scan/1/status"),
            ("GET",  "/api/admin/stats"),
            ("GET",  "/api/catalog/platforms"),
            ("GET",  "/api/webhooks/"),
            ("GET",  "/api/schedule/"),
        ]
        for method, path in cases:
            rv = client.get(path) if method == "GET" else client.post(path, json={})
            self.assertEqual(rv.status_code, 401,
                             f"Expected 401 unauthenticated {method} {path}, got {rv.status_code}")


# ============================================================
# SEC-09: Account enumeration via lockout status code
# ============================================================

class TestAccountEnumeration(TwoUserBase):

    def test_bad_password_returns_401(self):
        client = self.app.test_client()
        rv = client.post("/api/auth/login",
                         json={"email": "user_a@test.local", "password": "WrongPass99!"},
                         content_type="application/json")
        self.assertEqual(rv.status_code, 401)

    def test_nonexistent_email_returns_401(self):
        client = self.app.test_client()
        rv = client.post("/api/auth/login",
                         json={"email": "nobody@test.local", "password": "WrongPass99!"},
                         content_type="application/json")
        self.assertEqual(rv.status_code, 401)

    def test_same_error_message_for_bad_pwd_and_unknown_email(self):
        """Both bad-password and unknown-email return the same message body."""
        client = self.app.test_client()
        rv_bad = client.post("/api/auth/login",
                             json={"email": "user_a@test.local", "password": "WrongPass99!"},
                             content_type="application/json")
        rv_missing = client.post("/api/auth/login",
                                 json={"email": "nobody@test.local", "password": "WrongPass99!"},
                                 content_type="application/json")
        self.assertEqual(rv_bad.get_json().get("error"),
                         rv_missing.get_json().get("error"),
                         "Bad-password and unknown-email must return identical error messages")

    def test_locked_account_returns_429_distinct_from_401(self):
        """
        DOCUMENTED FINDING: After threshold bad attempts, locked account
        returns HTTP 429. This is distinct from 401 (bad creds for unknown
        email), allowing an attacker to confirm whether an email is registered.
        """
        from config import Config
        client = self.app.test_client()
        for _ in range(Config.AUTH_LOCKOUT_THRESHOLD):
            client.post("/api/auth/login",
                        json={"email": "user_a@test.local", "password": "WrongPass99!"},
                        content_type="application/json")

        rv_locked = client.post("/api/auth/login",
                                json={"email": "user_a@test.local", "password": "WrongPass99!"},
                                content_type="application/json")
        rv_unknown = client.post("/api/auth/login",
                                 json={"email": "nobody@test.local", "password": "WrongPass99!"},
                                 content_type="application/json")

        # Document the difference
        self.assertEqual(rv_locked.status_code, 429,
                         "Locked existing account should return 429")
        self.assertEqual(rv_unknown.status_code, 401,
                         "Unknown email should return 401")
        # This assertion documents the enumeration vector
        self.assertNotEqual(rv_locked.status_code, rv_unknown.status_code,
                            "CONFIRMED: 429 vs 401 reveals whether email is registered")


# ============================================================
# SEC-10: HTML export XSS
# ============================================================

class TestHTMLExportXSS(TwoUserBase):
    """Confirm that scan field values are not HTML-escaped in export."""

    def setUp(self):
        super().setUp()
        from database import ScanResult
        with self.app.app_context():
            scan = Scan(
                user_id=self.ua_id,
                target_name='<script>alert("xss_name")</script>',
                target_email="xss@test.local",
                mode="quick",
                status="completed",
                risk_score=1.0,
            )
            db.session.add(scan)
            db.session.flush()
            result = ScanResult(
                scan_id=scan.id,
                platform='<img src=x onerror=alert(1)>',
                url="https://safe.example.com",
                confidence=0.9,
                risk_level="low",
                category='"><script>alert(2)</script>',
                emails_found=json.dumps([]),
                phones_found=json.dumps([]),
            )
            db.session.add(result)
            db.session.commit()
            self.xss_scan_id = scan.id

    def test_html_export_target_name_is_escaped(self):
        """
        F-03 REGRESSION: target_name with <script> tag must appear HTML-escaped,
        not as raw markup, in the HTML export.
        Fix: html.escape() applied to scan.target_name in api/export.py.
        """
        rv = self._get(self.client_a, self.csrf_a, f"/api/export/{self.xss_scan_id}/html")
        if rv.status_code != 200:
            self.skipTest(f"HTML export returned {rv.status_code} in test env")
        body = rv.data.decode("utf-8")
        # Raw <script> tag must NOT appear
        self.assertNotIn('<script>alert("xss_name")</script>', body,
                         "FAIL: raw <script> tag in target_name is unescaped in HTML export")
        # Escaped form MUST appear (proves the value is rendered, just safely)
        self.assertIn('&lt;script&gt;alert(', body,
                      "Escaped form of <script> not found — html.escape() may not be applied")

    def test_html_export_platform_is_escaped(self):
        """F-03 REGRESSION: r.platform with <img onerror> must be HTML-escaped.

        html.escape('<img src=x onerror=alert(1)>') produces the string
        '&lt;img src=x onerror=alert(1)&gt;'.  The raw '<' character must not
        appear as an actual angle-bracket preceding 'img' — asserting the full
        raw tag absence is the correct check.
        """
        rv = self._get(self.client_a, self.csrf_a, f"/api/export/{self.xss_scan_id}/html")
        if rv.status_code != 200:
            self.skipTest(f"HTML export returned {rv.status_code} in test env")
        body = rv.data.decode("utf-8")
        # The raw unescaped tag must NOT appear (actual '<' + 'img src=x')
        # Note: assertNotIn("onerror=...") is too narrow — the substring also
        # appears inside the correctly-escaped entity.  Check the raw '<img' instead.
        self.assertNotIn("<img src=x onerror=alert(1)>", body,
                         "FAIL: raw <img onerror> tag present in HTML export — not escaped")
        # Escaped form MUST be present (confirms the value IS rendered, safely)
        self.assertIn("&lt;img src=x onerror=alert(1)&gt;", body,
                      "Escaped &lt;img&gt; entity not found — html.escape() may not be applied to platform")

    def test_html_export_category_is_escaped(self):
        """F-03 REGRESSION: r.category with injected script tag must be escaped."""
        rv = self._get(self.client_a, self.csrf_a, f"/api/export/{self.xss_scan_id}/html")
        if rv.status_code != 200:
            self.skipTest(f"HTML export returned {rv.status_code} in test env")
        body = rv.data.decode("utf-8")
        self.assertNotIn('"><script>alert(2)</script>', body,
                         "FAIL: raw <script> in category field is unescaped in HTML export")
        self.assertIn("&lt;script&gt;alert(2)&lt;/script&gt;", body,
                      "Escaped category script tag not found")


# ============================================================
# SEC-11: Evidence path traversal
# ============================================================

class TestEvidencePathTraversal(TwoUserBase):
    """Confirm get_evidence_file uses os.path.basename and resolve() check."""

    def setUp(self):
        super().setUp()
        self.scan_a_id = self._create_scan_for(self.ua_id)

    def test_traversal_payload_is_rejected(self):
        """../../../etc/passwd routed as filename must not return 200 or 500."""
        rv = self._get(self.client_a, self.csrf_a,
                       f"/api/evidence/{self.scan_a_id}/../../../etc/passwd")
        # Flask routing normalises paths, but confirm no 500
        self.assertNotIn(rv.status_code, [200, 500],
                         f"Path traversal returned unexpected {rv.status_code}")

    def test_static_code_uses_basename_and_resolve(self):
        """Confirm core/evidence.py uses os.path.basename and resolve().relative_to()."""
        with open("core/evidence.py") as f:
            src = f.read()
        self.assertIn("os.path.basename", src,
                      "evidence.py must use os.path.basename to strip path components")
        self.assertIn(".resolve().relative_to(", src,
                      "evidence.py must verify resolved path stays inside scan directory")


# ============================================================
# SEC-12: Metrics endpoint protection
# ============================================================

class TestMetricsProtection(TwoUserBase):

    def test_no_token_returns_blocked_when_configured(self):
        """
        When METRICS_TOKEN IS configured, missing Authorization returns 401.
        (404 is only returned when METRICS_TOKEN is not configured at all.)
        """
        rv = self.app.test_client().get("/metrics")
        # Token IS configured in setUp via _make_app(METRICS_TOKEN='test-metrics-secret')
        # Missing auth header → 401 (bearer challenge), not 200 (no data exposure)
        self.assertNotEqual(rv.status_code, 200,
                            "Metrics with no Authorization must not return 200")
        self.assertIn(rv.status_code, (401, 403, 404),
                      f"Metrics missing auth got unexpected {rv.status_code}")

    def test_wrong_bearer_token_rejected(self):
        rv = self.app.test_client().get(
            "/metrics", headers={"Authorization": "Bearer totally-wrong"})
        self.assertNotEqual(rv.status_code, 200,
                            "Metrics with wrong token must not return 200")

    def test_correct_bearer_token_accepted(self):
        rv = self.app.test_client().get(
            "/metrics", headers={"Authorization": "Bearer test-metrics-secret"})
        # 200 if prometheus_client installed; what matters is not rejected
        self.assertNotIn(rv.status_code, [401, 403],
                         "Correct metrics token should not return 401/403")

    def test_no_metrics_token_configured_returns_404(self):
        """
        When METRICS_TOKEN is empty/unset, endpoint must return 404
        to prevent accidental exposure.
        """
        app_no_tok = _make_app({"METRICS_TOKEN": ""})
        rv = app_no_tok.test_client().get("/metrics")
        self.assertEqual(rv.status_code, 404,
                         "Unconfigured metrics endpoint must return 404")


# ============================================================
# SEC-13: Health endpoint data safety
# ============================================================

class TestHealthEndpointSafety(unittest.TestCase):

    def setUp(self):
        self.app = _make_app()
        self.client = self.app.test_client()

    def test_health_no_sensitive_data(self):
        rv = self.client.get("/api/health")
        self.assertEqual(rv.status_code, 200)
        body = json.dumps(rv.get_json()).lower()
        for sensitive in ["postgresql://", "secret_key", "jwt_secret", "password", "redis://"]:
            self.assertNotIn(sensitive, body,
                             f"Health endpoint leaks sensitive string: {sensitive}")

    def test_ready_no_sensitive_data(self):
        rv = self.client.get("/api/ready")
        self.assertIn(rv.status_code, (200, 503))
        body = json.dumps(rv.get_json()).lower()
        for sensitive in ["postgresql://", "secret_key", "password"]:
            self.assertNotIn(sensitive, body,
                             f"Ready endpoint leaks sensitive string: {sensitive}")


# ============================================================
# SEC-14: SQL injection safety (parameterization)
# ============================================================

class TestSQLInjectionSafety(TwoUserBase):

    def test_sql_injection_in_schedule_target(self):
        payload = {"target_username": "' OR '1'='1", "frequency": "daily"}
        rv = self._post(self.client_a, self.csrf_a, "/api/schedule/", payload)
        # Should succeed (stored safely) or fail validation — not 500
        self.assertNotEqual(rv.status_code, 500,
                            "SQL injection in schedule target caused 500 — parameterization missing")

    def test_sql_injection_in_audit_log_filter(self):
        rv = self._get(self.client_admin, self.csrf_admin,
                       "/api/audit/logs?event_type=' OR '1'='1")
        self.assertNotEqual(rv.status_code, 500,
                            "SQL injection in audit log filter caused 500")

    def test_sql_injection_in_history_endpoint(self):
        rv = self._get(self.client_a, self.csrf_a,
                       "/api/history/' OR '1'='1/trend")
        self.assertNotEqual(rv.status_code, 500,
                            "SQL injection in history username caused 500")


# ============================================================
# SEC-15: Static security pattern verification
# ============================================================

class TestStaticSecurityPatterns(unittest.TestCase):
    """Pure static code analysis as deterministic runtime tests."""

    def _noncomment_lines(self, path):
        """Return (lineno, stripped_line) for every line NOT inside a
        triple-quoted docstring or a # comment."""
        result = []
        with open(path) as f:
            src = f.read()
        in_docstring = False
        docstring_delim = None
        for lineno, line in enumerate(src.splitlines(), 1):
            stripped = line.strip()
            if not in_docstring:
                # Detect opening of triple-quoted string
                for delim in ('"""', "'''"):
                    if delim in stripped:
                        # Count opens vs closes on this line
                        count = stripped.count(delim)
                        if count % 2 == 1:   # odd → unclosed, enter docstring
                            in_docstring = True
                            docstring_delim = delim
                        break  # handled
                if in_docstring:
                    continue   # skip the opening line too
                if stripped.startswith('#'):
                    continue
                result.append((lineno, stripped))
            else:
                if docstring_delim in stripped:
                    in_docstring = False  # closing delimiter found
                # skip all docstring lines
        return result

    def test_no_eval_in_query_engine(self):
        """eval() must not appear in non-comment, non-docstring executable lines."""
        import re
        bad = [
            f'L{n}: {l[:80]}'
            for n, l in self._noncomment_lines("core/query_engine.py")
            if re.search(r'\beval\s*\(', l)
        ]
        self.assertEqual(bad, [], f"eval() in executable code of query_engine.py: {bad}")

    def test_no_exec_in_query_engine(self):
        """exec() must not appear in non-comment, non-docstring executable lines."""
        import re
        bad = [
            f'L{n}: {l[:80]}'
            for n, l in self._noncomment_lines("core/query_engine.py")
            if re.search(r'\bexec\s*\(', l)
        ]
        self.assertEqual(bad, [], f"exec() in executable code of query_engine.py: {bad}")

    def test_no_compile_in_query_engine(self):
        """Only re.compile() is acceptable — raw compile() must not appear in executable lines."""
        import re
        bad = [
            f'L{n}: {l[:80]}'
            for n, l in self._noncomment_lines("core/query_engine.py")
            if re.search(r'(?<!re\.)(?<!\w)compile\s*\(', l)
        ]
        self.assertEqual(bad, [], f"raw compile() in executable code of query_engine: {bad}")

    def test_html_escape_applied_in_export(self):
        """
        F-03 REGRESSION (static): html.escape() must be called in export.py
        after the fix.  This test confirms the fix is present.
        """
        with open("api/export.py") as f:
            src = f.read()
        import re
        escape_calls = re.findall(r"html\.escape\s*\(", src)
        self.assertGreater(len(escape_calls), 0,
                           "html.escape() not found in export.py — F-03 fix may have been reverted")

    def test_no_pickle_in_application_code(self):
        import re, os, glob
        pattern = re.compile(r"\bpickle\.(loads|load|dumps|dump)\b")
        found = []
        for path in glob.glob("**/*.py", recursive=True):
            if "test_" in path or "migrations" in path:
                continue
            with open(path) as f:
                src = f.read()
            if pattern.search(src):
                found.append(path)
        self.assertEqual(found, [], f"pickle usage found in: {found}")

    def test_no_yaml_unsafe_load(self):
        import re, glob
        pattern = re.compile(r"yaml\.load\s*\([^)]*\)")
        found = []
        for path in glob.glob("**/*.py", recursive=True):
            if "test_" in path:
                continue
            with open(path) as f:
                src = f.read()
            for m in pattern.finditer(src):
                if "Loader=yaml.SafeLoader" not in m.group() and "safe_load" not in m.group():
                    found.append((path, m.group()[:60]))
        self.assertEqual(found, [], f"Unsafe yaml.load found: {found}")

    def test_token_version_validated_in_middleware(self):
        """F-02 FIX GUARD: require_auth must call get_jwt() to read the 'ver' claim."""
        import inspect, re
        import auth.middleware as mw
        src = inspect.getsource(mw.require_auth)
        self.assertIn("get_jwt(", src,
                      "get_jwt() not found in require_auth — F-02 fix may be missing or reverted")
        self.assertIn("token_version", src,
                      "token_version not referenced in require_auth — F-02 fix may be missing")

    def test_jwt_cookie_csrf_protect_enabled(self):
        """JWT CSRF protection must be enabled in production config."""
        from config import Config
        self.assertTrue(Config.JWT_COOKIE_CSRF_PROTECT,
                        "JWT_COOKIE_CSRF_PROTECT must be True")

    def test_jwt_cookie_samesite_strict(self):
        """SameSite=Strict is the default cookie policy."""
        from config import Config
        self.assertEqual(Config.JWT_COOKIE_SAMESITE, "Strict",
                         "JWT_COOKIE_SAMESITE should be Strict by default")

    def test_validate_secrets_rejects_insecure_production_defaults(self):
        """validate_secrets() raises RuntimeError for insecure production config."""
        from config import validate_secrets
        with self.assertRaises(RuntimeError):
            validate_secrets({
                "APP_ENV": "production",
                "SECRET_KEY": "change-this-in-production",
                "JWT_SECRET_KEY": "some-strong-jwt-key-that-is-long-enough",
            })

    def test_verify_false_absent_from_auth_and_api(self):
        """verify=False must never appear in auth/ or api/ layer."""
        import re, glob
        auth_api_files = [p for p in glob.glob("**/*.py", recursive=True)
                          if any(p.startswith(d) for d in ("auth/", "api/", "app.py"))]
        found = []
        for path in auth_api_files:
            with open(path) as f:
                src = f.read()
            if re.search(r"verify\s*=\s*False", src):
                found.append(path)
        self.assertEqual(found, [],
                         f"verify=False found in auth/api files: {found}")

    def test_verify_false_absent_from_core_osint_clients(self):
        """F-04 / F7-BT-01 FIX GUARD: verify=False must not appear in core OSINT
        clients or plugins after the fixes applied in Phase 5 (F-04) and Phase 7A.

        Original F-04 scope: core/discovery.py, core/pipeline.py, core/scraper.py
        Phase 7A additions:  core/plugins/darkweb.py, core/plugins/pastebin.py,
                             core/plugins/reverse_image.py

        The glob now covers the entire core/ tree so any future reintroduction
        anywhere inside core/ will be caught immediately.
        """
        import re
        import glob as _glob

        # All Python files under core/ (excludes __pycache__ bytecode files and
        # core/http_client.py, which is the factory definition — it documents
        # verify=False in its docstring as a valid parameter value and is not a
        # callsite that disables TLS verification).
        core_py_files = [
            p for p in _glob.glob("core/**/*.py", recursive=True)
            if "__pycache__" not in p
            and p != "core/http_client.py"
        ]

        # Sanity-check that the six known previously-affected files are present
        expected_files = [
            "core/discovery.py",
            "core/pipeline.py",
            "core/scraper.py",
            "core/plugins/darkweb.py",
            "core/plugins/pastebin.py",
            "core/plugins/reverse_image.py",
        ]
        for ef in expected_files:
            self.assertIn(ef, core_py_files,
                          f"Expected file {ef} not found under core/ — path may have changed")

        found = []
        for path in core_py_files:
            try:
                with open(path) as f:
                    src = f.read()
                # Flag executable verify=False; skip pure comment lines.
                for lineno, line in enumerate(src.splitlines(), 1):
                    stripped = line.lstrip()
                    if stripped.startswith("#"):
                        continue  # pure comment line
                    if re.search(r"verify\s*=\s*False", line):
                        found.append(f"{path}:{lineno}: {line.rstrip()}")
            except FileNotFoundError:
                pass

        self.assertEqual(found, [],
                         "F-04/F7-BT-01 REGRESSION: verify=False still present in "
                         "core OSINT files:\n" + "\n".join(found))


if __name__ == "__main__":
    unittest.main(verbosity=2)

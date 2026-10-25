"""Focused regression tests for webhook HMAC-SHA256 signature verification.

Verifies:
1. Webhook payloads are serialized to UTF-8 JSON bytes and signed.
2. The exact same bytes are transmitted via httpx.post(content=body_bytes).
3. The signature in X-DFAS-Signature (sha256=<hex>) can be verified by a receiver
   using the stored webhook secret over the exact transmitted body bytes.
4. Both normal delivery (fire_webhooks) and test delivery (POST /api/webhooks/<id>/test)
   are covered.
"""

import hashlib
import hmac
import json
import re
import unittest
from unittest.mock import MagicMock, call, patch

from app import create_app
from database import User, Webhook, db
from api.webhooks import _sign_payload, fire_webhooks


def _extract_csrf(rv):
    for val in rv.headers.getlist("Set-Cookie"):
        m = re.search(r"csrf_access_token=([^;,\s]+)", val)
        if m:
            return m.group(1)
    return None


class TestWebhookSignature(unittest.TestCase):
    def setUp(self):
        self.app = create_app({
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
            "RATELIMIT_ENABLED": False,
            "SELF_SCAN_ONLY": False,
        })
        self.client = self.app.test_client()

        with self.app.app_context():
            db.drop_all()
            db.create_all()

            self.user = User(email="webhook_tester@test.local", full_name="Tester", role="user")
            self.user.set_password("SecurePassword123!")
            db.session.add(self.user)
            db.session.commit()
            self.user_id = self.user.id

            self.secret = "test-webhook-secret-token-32bytes"
            self.webhook = Webhook(
                user_id=self.user_id,
                url="https://receiver.example.com/webhook",
                secret=self.secret,
                events_json=json.dumps(["scan_complete"]),
                active=True,
            )
            db.session.add(self.webhook)
            db.session.commit()
            self.webhook_id = self.webhook.id

        # Log in to get session cookies + CSRF token
        login_res = self.client.post(
            "/api/auth/login",
            json={"email": "webhook_tester@test.local", "password": "SecurePassword123!"},
        )
        self.assertEqual(login_res.status_code, 200)
        self.csrf_token = _extract_csrf(login_res)

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_sign_payload_helper(self):
        """_sign_payload returns expected hex digest for raw bytes, string, and dict."""
        secret = "my-secret"
        raw_bytes = b'{"event":"test"}'
        expected = hmac.new(b"my-secret", raw_bytes, hashlib.sha256).hexdigest()

        # From bytes
        self.assertEqual(_sign_payload(raw_bytes, secret), expected)
        # From str
        self.assertEqual(_sign_payload('{"event":"test"}', secret), expected)
        # From dict
        d = {"event": "test"}
        dict_expected = hmac.new(b"my-secret", json.dumps(d).encode("utf-8"), hashlib.sha256).hexdigest()
        self.assertEqual(_sign_payload(d, secret), dict_expected)

    @patch("api.webhooks.httpx.post")
    def test_fire_webhooks_signature_matches_raw_transmitted_bytes(self, mock_post):
        """fire_webhooks sends raw bytes that match the X-DFAS-Signature header."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_post.return_value = mock_resp

        payload = {
            "scan_id": 42,
            "target": "alice",
            "risk_score": 7.5,
            "nested": {"z": 1, "a": 2},
        }

        with self.app.app_context():
            fire_webhooks("scan_complete", payload, self.user_id)

        self.assertEqual(mock_post.call_count, 1)
        args, kwargs = mock_post.call_args

        # 1. Verify URL and timeout
        self.assertEqual(args[0], "https://receiver.example.com/webhook")
        self.assertEqual(kwargs.get("timeout"), 10.0)

        # 2. Verify content is bytes (not json= kwarg)
        self.assertNotIn("json", kwargs)
        body_bytes = kwargs.get("content")
        self.assertIsInstance(body_bytes, bytes)

        # 3. Verify headers
        headers = kwargs.get("headers", {})
        self.assertEqual(headers.get("Content-Type"), "application/json")
        self.assertEqual(headers.get("X-DFAS-Event"), "scan_complete")
        sig_header = headers.get("X-DFAS-Signature", "")
        self.assertTrue(sig_header.startswith("sha256="))
        received_sig = sig_header[len("sha256="):]

        # 4. Receiver HMAC verification over the exact transmitted body bytes
        expected_sig = hmac.new(
            self.secret.encode("utf-8"), body_bytes, hashlib.sha256
        ).hexdigest()
        self.assertEqual(received_sig, expected_sig)

        # 5. Receiver parses valid JSON from the received bytes
        decoded_payload = json.loads(body_bytes.decode("utf-8"))
        self.assertEqual(decoded_payload["event"], "scan_complete")
        self.assertEqual(decoded_payload["data"]["scan_id"], 42)
        self.assertEqual(decoded_payload["data"]["target"], "alice")

        # 6. Verification fails if even 1 byte is modified or wrong secret used
        corrupted_bytes = body_bytes + b" "
        corrupted_sig = hmac.new(self.secret.encode("utf-8"), corrupted_bytes, hashlib.sha256).hexdigest()
        self.assertNotEqual(received_sig, corrupted_sig)

        wrong_secret_sig = hmac.new(b"wrong-secret", body_bytes, hashlib.sha256).hexdigest()
        self.assertNotEqual(received_sig, wrong_secret_sig)

    @patch("api.webhooks.httpx.post")
    def test_test_webhook_endpoint_signature_matches_transmitted_bytes(self, mock_post):
        """POST /api/webhooks/<id>/test sends raw bytes verified by receiver."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_post.return_value = mock_resp

        headers = {}
        if self.csrf_token:
            headers["X-CSRF-TOKEN"] = self.csrf_token

        rv = self.client.post(f"/api/webhooks/{self.webhook_id}/test", headers=headers)
        self.assertEqual(rv.status_code, 200)
        resp_data = rv.get_json()
        self.assertTrue(resp_data.get("success"))

        self.assertEqual(mock_post.call_count, 1)
        args, kwargs = mock_post.call_args

        self.assertEqual(args[0], "https://receiver.example.com/webhook")
        self.assertNotIn("json", kwargs)
        body_bytes = kwargs.get("content")
        self.assertIsInstance(body_bytes, bytes)

        req_headers = kwargs.get("headers", {})
        self.assertEqual(req_headers.get("X-DFAS-Event"), "test")
        sig_header = req_headers.get("X-DFAS-Signature", "")
        self.assertTrue(sig_header.startswith("sha256="))
        received_sig = sig_header[len("sha256="):]

        # Receiver verification
        expected_sig = hmac.new(
            self.secret.encode("utf-8"), body_bytes, hashlib.sha256
        ).hexdigest()
        self.assertEqual(received_sig, expected_sig)

        # Check payload
        parsed = json.loads(body_bytes.decode("utf-8"))
        self.assertEqual(parsed["event"], "test")
        self.assertIn("message", parsed["data"])

    @patch("api.webhooks.httpx.post")
    def test_fire_webhooks_non_2xx_logs_warning_without_secrets(self, mock_post):
        """fire_webhooks logs non-2xx responses at WARNING level without exposing URL or secrets."""
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_post.return_value = mock_resp

        with self.assertLogs("api.webhooks", level="WARNING") as cm:
            with self.app.app_context():
                fire_webhooks("scan_complete", {"scan_id": 99, "secret_param": "sensitive-val"}, self.user_id)

        # 1. Verify warning is logged with webhook ID and status code
        log_output = "\n".join(cm.output)
        self.assertIn(str(self.webhook_id), log_output)
        self.assertIn("500", log_output)
        self.assertIn("non-2xx", log_output)

        # 2. Verify no URL, secret, or payload values leaked in the log message
        self.assertNotIn("https://receiver.example.com/webhook", log_output)
        self.assertNotIn(self.secret, log_output)
        self.assertNotIn("sensitive-val", log_output)

        # 3. Verify status code in DB is 500
        with self.app.app_context():
            wh = db.session.get(Webhook, self.webhook_id)
            self.assertEqual(wh.last_status_code, 500)

    @patch("api.webhooks.httpx.post")
    def test_test_webhook_timeout_clears_stale_success_status(self, mock_post):
        """test_webhook sets last_status_code=0 on timeout/network failure to overwrite stale 200."""
        import httpx

        # 1. Pre-seed webhook with last_status_code=200
        with self.app.app_context():
            wh = db.session.get(Webhook, self.webhook_id)
            wh.last_status_code = 200
            db.session.commit()

        # Verify initial state via API
        list_rv = self.client.get("/api/webhooks/")
        self.assertEqual(list_rv.status_code, 200)
        self.assertEqual(list_rv.get_json()["webhooks"][0]["last_status_code"], 200)

        # 2. Mock network timeout
        mock_post.side_effect = httpx.TimeoutException("Connection timed out")

        headers = {}
        if self.csrf_token:
            headers["X-CSRF-TOKEN"] = self.csrf_token

        rv = self.client.post(f"/api/webhooks/{self.webhook_id}/test", headers=headers)
        self.assertEqual(rv.status_code, 502)
        self.assertEqual(rv.get_json(), {"error": "Webhook delivery failed. Check the target URL and try again."})

        # 3. Verify that DB and GET /api/webhooks/ reflect last_status_code=0 (not stale 200)
        with self.app.app_context():
            wh = db.session.get(Webhook, self.webhook_id)
            self.assertEqual(wh.last_status_code, 0)

        list_rv2 = self.client.get("/api/webhooks/")
        self.assertEqual(list_rv2.status_code, 200)
        self.assertEqual(list_rv2.get_json()["webhooks"][0]["last_status_code"], 0)

    @patch("api.webhooks.time.sleep")
    @patch("api.webhooks.httpx.post")
    def test_fire_webhooks_retries_on_5xx_and_succeeds(self, mock_post, mock_sleep):
        """fire_webhooks retries HTTP 5xx responses and succeeds on subsequent attempt."""
        resp_500 = MagicMock(status_code=500)
        resp_200 = MagicMock(status_code=200)
        mock_post.side_effect = [resp_500, resp_200]

        with self.app.app_context():
            fire_webhooks("scan_complete", {"scan_id": 101}, self.user_id)

        self.assertEqual(mock_post.call_count, 2)
        mock_sleep.assert_called_once_with(0.5)

        with self.app.app_context():
            wh = db.session.get(Webhook, self.webhook_id)
            self.assertEqual(wh.last_status_code, 200)

    @patch("api.webhooks.time.sleep")
    @patch("api.webhooks.httpx.post")
    def test_fire_webhooks_retries_on_network_timeout_and_succeeds(self, mock_post, mock_sleep):
        """fire_webhooks retries network/timeout exceptions and succeeds on retry."""
        import httpx
        resp_200 = MagicMock(status_code=200)
        mock_post.side_effect = [httpx.TimeoutException("timeout"), resp_200]

        with self.app.app_context():
            fire_webhooks("scan_complete", {"scan_id": 102}, self.user_id)

        self.assertEqual(mock_post.call_count, 2)
        mock_sleep.assert_called_once_with(0.5)

        with self.app.app_context():
            wh = db.session.get(Webhook, self.webhook_id)
            self.assertEqual(wh.last_status_code, 200)

    @patch("api.webhooks.time.sleep")
    @patch("api.webhooks.httpx.post")
    def test_fire_webhooks_exhausts_retries_on_persistent_5xx(self, mock_post, mock_sleep):
        """fire_webhooks stops after 2 additional retry attempts (3 attempts total) on 5xx."""
        mock_post.return_value = MagicMock(status_code=503)

        with self.app.app_context():
            fire_webhooks("scan_complete", {"scan_id": 103}, self.user_id)

        self.assertEqual(mock_post.call_count, 3)
        self.assertEqual(mock_sleep.call_count, 2)
        mock_sleep.assert_has_calls([call(0.5), call(1.0)])

        with self.app.app_context():
            wh = db.session.get(Webhook, self.webhook_id)
            self.assertEqual(wh.last_status_code, 503)

    @patch("api.webhooks.time.sleep")
    @patch("api.webhooks.httpx.post")
    def test_fire_webhooks_exhausts_retries_on_persistent_timeout(self, mock_post, mock_sleep):
        """fire_webhooks stops after 2 additional retry attempts (3 attempts total) on timeout."""
        import httpx
        mock_post.side_effect = httpx.TimeoutException("timed out")

        with self.app.app_context():
            fire_webhooks("scan_complete", {"scan_id": 104}, self.user_id)

        self.assertEqual(mock_post.call_count, 3)
        self.assertEqual(mock_sleep.call_count, 2)
        mock_sleep.assert_has_calls([call(0.5), call(1.0)])

        with self.app.app_context():
            wh = db.session.get(Webhook, self.webhook_id)
            self.assertEqual(wh.last_status_code, 0)

    @patch("api.webhooks.time.sleep")
    @patch("api.webhooks.httpx.post")
    def test_fire_webhooks_does_not_retry_on_4xx(self, mock_post, mock_sleep):
        """fire_webhooks does not retry client errors (HTTP 4xx)."""
        mock_post.return_value = MagicMock(status_code=404)

        with self.app.app_context():
            fire_webhooks("scan_complete", {"scan_id": 105}, self.user_id)

        self.assertEqual(mock_post.call_count, 1)
        mock_sleep.assert_not_called()

        with self.app.app_context():
            wh = db.session.get(Webhook, self.webhook_id)
            self.assertEqual(wh.last_status_code, 404)

    @patch("api.webhooks.time.sleep")
    @patch("api.webhooks.httpx.post")
    def test_fire_webhooks_failure_does_not_prevent_delivery_to_other_webhooks(self, mock_post, mock_sleep):
        """Failure of one webhook does not abort delivery to subsequent webhooks."""
        # Create second webhook for user
        with self.app.app_context():
            wh2 = Webhook(
                user_id=self.user_id,
                url="https://receiver2.example.com/webhook",
                secret="secret-2",
                events_json=json.dumps(["scan_complete"]),
                active=True,
            )
            db.session.add(wh2)
            db.session.commit()
            wh2_id = wh2.id

        # Webhook 1 fails 3 times (500), Webhook 2 succeeds on first attempt (200)
        mock_post.side_effect = [
            MagicMock(status_code=500),
            MagicMock(status_code=500),
            MagicMock(status_code=500),
            MagicMock(status_code=200),
        ]

        with self.app.app_context():
            fire_webhooks("scan_complete", {"scan_id": 106}, self.user_id)

        self.assertEqual(mock_post.call_count, 4)

        with self.app.app_context():
            saved_wh1 = db.session.get(Webhook, self.webhook_id)
            saved_wh2 = db.session.get(Webhook, wh2_id)
            self.assertEqual(saved_wh1.last_status_code, 500)
            self.assertEqual(saved_wh2.last_status_code, 200)


if __name__ == "__main__":
    unittest.main()

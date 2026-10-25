import json
import tempfile
import unittest
from pathlib import Path

from app import create_app
from database import Scan, User, db


class TestExport(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_export.db"
        self.app = create_app({
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{self.db_path}",
            "RATELIMIT_ENABLED": False,
        })
        self.app_context = self.app.app_context()
        self.app_context.push()
        self.client = self.app.test_client()
        db.create_all()

        self.u = User(email="export@dfas.local", role="analyst", full_name="Export User")
        self.u.set_password("pass")
        db.session.add(self.u)
        db.session.commit()

        self.scan = Scan(user_id=self.u.id, target_name="Export Target", target_username="export")
        self.scan.status = "completed"
        db.session.add(self.scan)
        db.session.commit()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.app_context.pop()
        self.temp_dir.cleanup()

    def _headers(self):
        self.client.post("/api/auth/login", json={"email": "export@dfas.local", "password": "pass"})
        token = self.client.get_cookie("csrf_access_token")
        return {"X-CSRF-TOKEN": token.value if token else ""}

    def test_stix_export_format(self):
        headers = self._headers()
        resp = self.client.get(f"/api/export/{self.scan.id}/stix", headers=headers)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("Content-Type"), "application/json")

        data = json.loads(resp.data)
        self.assertEqual(data["type"], "bundle")
        self.assertIn("objects", data)
        self.assertIsInstance(data["objects"], list)

    def test_html_export_format(self):
        headers = self._headers()
        resp = self.client.get(f"/api/export/{self.scan.id}/html", headers=headers)

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get("Content-Type"), "text/html; charset=utf-8")

        html_content = resp.data.decode('utf-8')
        self.assertIn("<!DOCTYPE html>", html_content)
        self.assertIn("Sentinel Intelligence Report", html_content)

if __name__ == "__main__":
    unittest.main()

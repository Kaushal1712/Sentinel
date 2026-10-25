import tempfile
import unittest
from pathlib import Path

from app import create_app
from database import User, db


class TestAdminRBAC(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_admin.db"
        self.app = create_app({
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{self.db_path}",
            "RATELIMIT_ENABLED": False,
        })
        self.app_context = self.app.app_context()
        self.app_context.push()
        self.client = self.app.test_client()
        db.create_all()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.app_context.pop()
        self.temp_dir.cleanup()

    def _login_as(self, role):
        u = User(email=f"{role}@dfas.local", full_name="Test User", role=role)
        u.set_password("pass")
        db.session.add(u)
        db.session.commit()

        login = self.client.post("/api/auth/login", json={"email": u.email, "password": "pass"})
        token = self.client.get_cookie("csrf_access_token")
        return {"X-CSRF-TOKEN": token.value if token else ""}

    def test_admin_endpoints_block_standard_users(self):
        # Create viewer user
        headers = self._login_as("viewer")

        # Test /api/admin/stats
        resp = self.client.get("/api/admin/stats", headers=headers)
        self.assertEqual(resp.status_code, 403)

    def test_admin_allow_admin_role(self):
        headers = self._login_as("admin")

        resp = self.client.get("/api/admin/stats", headers=headers)
        self.assertEqual(resp.status_code, 200)

if __name__ == "__main__":
    unittest.main()

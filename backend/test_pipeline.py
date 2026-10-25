import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import create_app
from database import Scan, User, db


class TestPipeline(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_pipeline.db"
        self.app = create_app({
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{self.db_path}",
            "RATELIMIT_ENABLED": False,
        })
        self.app_context = self.app.app_context()
        self.app_context.push()
        db.create_all()

        self.u = User(email="pipeline@dfas.local", role="analyst", full_name="Pipeline User")
        self.u.set_password("pass")
        db.session.add(self.u)
        db.session.commit()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.app_context.pop()
        self.temp_dir.cleanup()

    @patch('core.pipeline._run_enrichment_and_intel')
    @patch('core.pipeline.run_discovery')
    def test_intel_wrapper_handles_plugin_failure(self, mock_discovery, mock_enrich):
        # Mocks
        mock_discovery.return_value = {"discovered_urls": [], "emails": []}

        # Simulate a crash in a plugin (e.g., throwing ValueError)
        mock_enrich.side_effect = Exception("API connection dropped")

        scan = Scan(user_id=self.u.id, target_name="Test", target_username="test_target")
        db.session.add(scan)
        db.session.commit()

        from core.pipeline import run_scan_pipeline
        run_scan_pipeline(scan.id, execution_backend="local")

        # Verify that despite the exception, the pipeline gracefully updated status
        updated_scan = Scan.query.get(scan.id)
        self.assertIsNotNone(updated_scan)
        # Assuming the pipeline continues or marks failed but does not crash the app thread
        self.assertTrue(updated_scan.status in ["completed", "failed"])

if __name__ == "__main__":
    unittest.main()

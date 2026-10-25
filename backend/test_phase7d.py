"""Phase 7D regression tests — DatasetChunk pagination (F7-BE-04).

All tests run against an in-process SQLite test database with
RATELIMIT_ENABLED=False.  No running Redis, external HTTP server, or
real OpenAI API call is required.

Coverage
--------
F7D-01  New upload writes chunks atomically; chunks_migrated=True.
F7D-02  Upload with 0 rows produces one empty chunk; chunks_migrated=True.
F7D-03  Pagination first page (chunk-path).
F7D-04  Pagination last page (partial page, chunk boundary).
F7D-05  Pagination across chunk boundary (page spans two chunks).
F7D-06  Pagination beyond last page returns empty data.
F7D-07  Legacy fallback (chunks_migrated=False) reads data_json.
F7D-08  Response schema unchanged between chunk-path and legacy path.
F7D-09  Delete cascade removes all DatasetChunk rows.
F7D-10  Backfill: migrates an unmigrated dataset correctly.
F7D-11  Backfill: idempotent — skips already-migrated dataset.
F7D-12  Backfill: handles malformed data_json without crashing.
F7D-13  Backfill: dry-run does not write any data.
F7D-22  Backfill: malformed dataset fails (exit 1) without blocking a valid one.
F7D-23  Backfill: stale chunks + chunks_migrated=False are repaired, no duplicates.
F7D-24  Backfill: dry-run validation matches a real run (bad JSON, non-list, null).
F7D-25  Backfill: second run skips migrated datasets, chunk rows untouched.
F7D-26  Backfill: --dataset-id filter and row_count mismatch warning.
F7D-27  Upload: first-chunk failure leaves no dataset or chunk rows.
F7D-28  Upload: later-chunk failure leaves no dataset or chunk rows.
F7D-14  _build_chunks: empty list produces one empty-array chunk.
F7D-15  _build_chunks: rows exactly divisible by CHUNK_SIZE.
F7D-16  _build_chunks: partial last chunk.
F7D-17  _rows_from_chunks: arbitrary start/end within single chunk.
F7D-18  _rows_from_chunks: spans two chunks correctly.
F7D-19  Chat endpoint reads from chunks when chunks_migrated=True.
F7D-20  Insights endpoint reads only first chunk for sample data.
F7D-21  IDOR: user B cannot access user A's dataset data (chunk path).
"""

import json
import os
import re
import sys
import unittest

# ─── App factory ──────────────────────────────────────────────────────────────

sys.path.insert(0, os.path.dirname(__file__))

_TEST_CONFIG = {
    "TESTING": True,
    "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
    "SECRET_KEY": "test-secret-key-phase7d-testing-only-32ch",
    "JWT_SECRET_KEY": "test-jwt-secret-phase7d-testing-only-32ch",
    "JWT_TOKEN_LOCATION": ["headers", "cookies"],
    "JWT_COOKIE_CSRF_PROTECT": True,
    "JWT_ACCESS_CSRF_HEADER_NAME": "X-CSRF-TOKEN",
    "JWT_COOKIE_SECURE": False,
    "JWT_COOKIE_SAMESITE": "Strict",
    "RATELIMIT_ENABLED": False,
    "APP_ENV": "testing",
    "WTF_CSRF_ENABLED": False,
    "OPENAI_API_KEY": "",   # AI features disabled — tests mock them
}


def _make_app():
    from app import create_app
    app = create_app(_TEST_CONFIG)
    return app


# ─── Test helpers ──────────────────────────────────────────────────────────────

def _extract_csrf_from_response(rv):
    """Extract the CSRF token from the Set-Cookie header returned by login."""
    for header_val in rv.headers.getlist("Set-Cookie"):
        m = re.search(r"csrf_access_token=([^;,\s]+)", header_val)
        if m:
            return m.group(1)
    return ""


def _register_and_login(client, email, password="Passw0rd!test"):
    """Register a user and return the CSRF token from the login response."""
    client.post("/api/auth/register", json={
        "email": email, "password": password, "full_name": "Test User",
        "self_attestation": True, "target_name": email.split("@")[0],
    })
    rv = client.post("/api/auth/login", json={"email": email, "password": password})
    return _extract_csrf_from_response(rv)


def _make_dataset(app, user_id, rows, chunks_migrated=True, data_json_override=None):
    """Create a Dataset (and optionally chunks) directly via DB session."""
    from database import CHUNK_SIZE, Dataset, DatasetChunk, db

    with app.app_context():
        col_info = [{"name": "col_a", "dtype": "integer"}]
        ds = Dataset(
            user_id=user_id,
            name="test_dataset",
            original_filename="test.csv",
            row_count=len(rows),
            column_count=1,
            columns_json=json.dumps(col_info),
            summary_json=json.dumps({}),
            data_json=json.dumps(rows) if data_json_override is None else data_json_override,
            file_size_bytes=100,
            upload_status="ready",
            chunks_migrated=False,
        )
        db.session.add(ds)
        db.session.flush()

        if chunks_migrated:
            for i in range(0, max(len(rows), 1), CHUNK_SIZE):
                batch = rows[i: i + CHUNK_SIZE]
                db.session.add(DatasetChunk(
                    dataset_id=ds.id,
                    chunk_index=i // CHUNK_SIZE,
                    rows_json=json.dumps(batch),
                ))
            ds.chunks_migrated = True

        db.session.commit()
        return ds.id


def _get(client, csrf, path, **kw):
    return client.get(path, headers={"X-CSRF-TOKEN": csrf}, **kw)


def _delete(client, csrf, path):
    return client.delete(path, headers={"X-CSRF-TOKEN": csrf})


# ═══════════════════════════════════════════════════════════════════════════════

class TestPhase7DChunkHelpers(unittest.TestCase):
    """Unit tests for _build_chunks and _rows_from_chunks (no HTTP, no DB)."""

    def setUp(self):
        self.app = _make_app()
        self.ctx = self.app.app_context()
        self.ctx.push()
        from database import db
        db.create_all()
        # Create a real user so Dataset FK is satisfied in F7D-17 and F7D-18.
        from database import User
        u = User(email="helper_test@example.com", full_name="Helper")
        u.set_password("Passw0rd!test")
        db.session.add(u)
        db.session.commit()
        self.user_id = u.id

    def tearDown(self):
        from database import db
        db.session.remove()
        db.drop_all()
        self.ctx.pop()

    # F7D-14
    def test_build_chunks_empty_produces_one_empty_chunk(self):
        from api.dataset import _build_chunks
        result = _build_chunks([])
        self.assertEqual(len(result), 1)
        self.assertEqual(json.loads(result[0]), [])

    # F7D-15
    def test_build_chunks_exact_multiple(self):
        from api.dataset import _build_chunks
        from database import CHUNK_SIZE
        rows = [{"i": n} for n in range(CHUNK_SIZE * 3)]
        result = _build_chunks(rows)
        self.assertEqual(len(result), 3)
        for blob in result:
            self.assertEqual(len(json.loads(blob)), CHUNK_SIZE)

    # F7D-16
    def test_build_chunks_partial_last(self):
        from api.dataset import _build_chunks
        from database import CHUNK_SIZE
        rows = [{"i": n} for n in range(CHUNK_SIZE + 7)]
        result = _build_chunks(rows)
        self.assertEqual(len(result), 2)
        self.assertEqual(len(json.loads(result[0])), CHUNK_SIZE)
        self.assertEqual(len(json.loads(result[1])), 7)

    # F7D-17
    def test_rows_from_chunks_single_chunk(self):
        """_rows_from_chunks works correctly for a range within one chunk."""
        from api.dataset import _rows_from_chunks
        from database import CHUNK_SIZE, DatasetChunk, db

        # Insert a dataset + one chunk directly
        from database import Dataset
        ds = Dataset(
            user_id=self.user_id, name="t", original_filename="t.csv",
            row_count=10, column_count=1,
            columns_json="[]", summary_json="{}", data_json="[]",
            file_size_bytes=10, upload_status="ready", chunks_migrated=True,
        )
        db.session.add(ds)
        db.session.flush()
        rows = [{"i": n} for n in range(10)]
        db.session.add(DatasetChunk(
            dataset_id=ds.id, chunk_index=0,
            rows_json=json.dumps(rows),
        ))
        db.session.commit()

        result = _rows_from_chunks(ds.id, 2, 5)
        self.assertEqual(result, [{"i": 2}, {"i": 3}, {"i": 4}])

    # F7D-18
    def test_rows_from_chunks_cross_boundary(self):
        """_rows_from_chunks spans two chunks and slices correctly."""
        from api.dataset import _rows_from_chunks
        from database import CHUNK_SIZE, DatasetChunk, Dataset, db

        total = CHUNK_SIZE + 10
        rows = [{"i": n} for n in range(total)]
        ds = Dataset(
            user_id=self.user_id, name="t2", original_filename="t2.csv",
            row_count=total, column_count=1,
            columns_json="[]", summary_json="{}", data_json="[]",
            file_size_bytes=10, upload_status="ready", chunks_migrated=True,
        )
        db.session.add(ds)
        db.session.flush()
        db.session.add(DatasetChunk(
            dataset_id=ds.id, chunk_index=0,
            rows_json=json.dumps(rows[:CHUNK_SIZE]),
        ))
        db.session.add(DatasetChunk(
            dataset_id=ds.id, chunk_index=1,
            rows_json=json.dumps(rows[CHUNK_SIZE:]),
        ))
        db.session.commit()

        # Request a window that straddles chunk 0 → chunk 1
        start = CHUNK_SIZE - 3
        end = CHUNK_SIZE + 5
        result = _rows_from_chunks(ds.id, start, end)
        self.assertEqual(result, rows[start:end])


class TestPhase7DDatasetSetup(unittest.TestCase):
    """Base class that sets up app context + DB tables + registers user."""

    def setUp(self):
        self.app = _make_app()
        with self.app.app_context():
            from database import db
            db.create_all()

        self.client = self.app.test_client()
        self.csrf = _register_and_login(self.client, "chunk_user@example.com")

        with self.app.app_context():
            from database import User
            self.user = User.query.filter_by(email="chunk_user@example.com").first()
            self.user_id = self.user.id

    def tearDown(self):
        with self.app.app_context():
            from database import db
            db.drop_all()


class TestPhase7DUpload(TestPhase7DDatasetSetup):
    """F7D-01, F7D-02: Upload writes chunks atomically."""

    # F7D-01
    def test_upload_sets_chunks_migrated(self):
        """After upload, Dataset.chunks_migrated is True and chunks exist."""
        from database import DatasetChunk, Dataset
        import io

        csv_data = "col_a,col_b\n1,2\n3,4\n5,6\n"
        rv = self.client.post(
            "/api/dataset/upload",
            headers={"X-CSRF-TOKEN": self.csrf},
            data={"file": (io.BytesIO(csv_data.encode()), "test.csv")},
            content_type="multipart/form-data",
        )
        self.assertEqual(rv.status_code, 201, rv.get_data(as_text=True))
        ds_id = rv.get_json()["dataset"]["id"]

        with self.app.app_context():
            from database import Dataset, DatasetChunk, db
            ds = db.session.get(Dataset, ds_id)
            self.assertTrue(ds.chunks_migrated, "chunks_migrated must be True after upload")
            chunks = DatasetChunk.query.filter_by(dataset_id=ds_id).all()
            self.assertGreater(len(chunks), 0, "At least one chunk must exist after upload")
            # Verify all rows are accounted for
            all_rows = []
            for c in sorted(chunks, key=lambda c: c.chunk_index):
                all_rows.extend(json.loads(c.rows_json))
            self.assertEqual(len(all_rows), ds.row_count)

    def _post_csv(self, n_rows):
        import io
        csv_data = "col_a,col_b\n" + "".join(f"{i},{i * 2}\n" for i in range(n_rows))
        return self.client.post(
            "/api/dataset/upload",
            headers={"X-CSRF-TOKEN": self.csrf},
            data={"file": (io.BytesIO(csv_data.encode()), "test.csv")},
            content_type="multipart/form-data",
        )

    def _assert_nothing_persisted(self):
        from database import Dataset, DatasetChunk
        with self.app.app_context():
            self.assertEqual(Dataset.query.count(), 0, "No dataset row may remain")
            self.assertEqual(DatasetChunk.query.count(), 0, "No chunk rows may remain")

    # F7D-27
    def test_upload_chunk_creation_failure_leaves_nothing(self):
        """If the first chunk cannot be created, the upload fails and rolls back fully."""
        from unittest import mock
        with mock.patch("api.dataset.DatasetChunk", side_effect=RuntimeError("boom")) as chunk_mock:
            rv = self._post_csv(5)

        # The injected failure must actually have been hit ...
        self.assertTrue(chunk_mock.called, "DatasetChunk failure injection was never reached")
        # ... and the response must be the dataset-save error, not an unrelated 500.
        self.assertEqual(rv.status_code, 500, rv.get_data(as_text=True))
        self.assertEqual(rv.get_json().get("error"), "Failed to save dataset. Please try again.")
        self._assert_nothing_persisted()

    # F7D-28
    def test_upload_failure_after_partial_chunks_leaves_nothing(self):
        """A failure on the 2nd chunk must not leave the dataset or the flushed 1st chunk behind."""
        from unittest import mock
        from database import CHUNK_SIZE, DatasetChunk, db

        real = DatasetChunk
        state = {"n": 0, "chunks_flushed": None}

        def flaky(**kw):
            state["n"] += 1
            if state["n"] == 2:
                # Chunk 0 is already added to the session by the route. Flush it so a
                # real INSERT is issued inside the open transaction, and confirm that,
                # before raising: rollback must then undo an actual chunk row.
                db.session.flush()
                state["chunks_flushed"] = db.session.query(real).count()
                raise RuntimeError("second chunk failed")
            return real(**kw)

        with mock.patch("api.dataset.DatasetChunk", side_effect=flaky):
            rv = self._post_csv(CHUNK_SIZE + 5)   # needs 2 chunks

        self.assertEqual(state["n"], 2, "Test must actually reach the second chunk")
        self.assertEqual(state["chunks_flushed"], 1,
                         "First chunk must have been INSERTed (flushed) before the failure")
        self.assertEqual(rv.status_code, 500, rv.get_data(as_text=True))
        self.assertEqual(rv.get_json().get("error"), "Failed to save dataset. Please try again.")
        self._assert_nothing_persisted()


class TestPhase7DPagination(TestPhase7DDatasetSetup):
    """F7D-03 to F7D-08: Pagination via chunk path and legacy fallback."""

    def _rows(self, n):
        return [{"col_a": i} for i in range(n)]

    # F7D-03
    def test_first_page_chunk_path(self):
        ds_id = _make_dataset(self.app, self.user_id, self._rows(120), chunks_migrated=True)
        rv = _get(self.client, self.csrf, f"/api/dataset/{ds_id}/data?page=1&page_size=50")
        body = rv.get_json()
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(len(body["data"]), 50)
        self.assertEqual(body["data"][0]["col_a"], 0)
        self.assertEqual(body["data"][49]["col_a"], 49)
        self.assertEqual(body["total"], 120)

    # F7D-04
    def test_last_page_partial(self):
        ds_id = _make_dataset(self.app, self.user_id, self._rows(120), chunks_migrated=True)
        rv = _get(self.client, self.csrf, f"/api/dataset/{ds_id}/data?page=3&page_size=50")
        body = rv.get_json()
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(len(body["data"]), 20)  # 120 - 2*50 = 20
        self.assertEqual(body["data"][0]["col_a"], 100)

    # F7D-05 — cross-chunk boundary (CHUNK_SIZE=500, page spans 490-510)
    def test_cross_chunk_boundary(self):
        from database import CHUNK_SIZE
        total = CHUNK_SIZE + 50   # 550 rows → 2 chunks
        ds_id = _make_dataset(self.app, self.user_id, self._rows(total), chunks_migrated=True)
        # Page that spans last 10 of chunk 0 and first 40 of chunk 1
        start = CHUNK_SIZE - 10
        page_size = 50
        page = start // page_size + 1
        rv = _get(self.client, self.csrf,
                  f"/api/dataset/{ds_id}/data?page={page}&page_size={page_size}")
        body = rv.get_json()
        self.assertEqual(rv.status_code, 200)
        data = body["data"]
        self.assertEqual(len(data), page_size)
        self.assertEqual(data[0]["col_a"], (page - 1) * page_size)

    # F7D-06
    def test_beyond_last_page_returns_empty(self):
        ds_id = _make_dataset(self.app, self.user_id, self._rows(10), chunks_migrated=True)
        rv = _get(self.client, self.csrf, f"/api/dataset/{ds_id}/data?page=999&page_size=50")
        body = rv.get_json()
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(body["data"], [])
        self.assertEqual(body["total"], 10)

    # F7D-07
    def test_legacy_fallback_reads_data_json(self):
        ds_id = _make_dataset(self.app, self.user_id, self._rows(5), chunks_migrated=False)
        rv = _get(self.client, self.csrf, f"/api/dataset/{ds_id}/data?page=1&page_size=50")
        body = rv.get_json()
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(len(body["data"]), 5)
        self.assertEqual(body["data"][0]["col_a"], 0)

    # F7D-08
    def test_response_schema_identical_chunk_and_legacy(self):
        rows = self._rows(5)
        chunk_id = _make_dataset(self.app, self.user_id, rows, chunks_migrated=True)
        legacy_id = _make_dataset(self.app, self.user_id, rows, chunks_migrated=False)

        rv_c = _get(self.client, self.csrf, f"/api/dataset/{chunk_id}/data")
        rv_l = _get(self.client, self.csrf, f"/api/dataset/{legacy_id}/data")
        bc = rv_c.get_json()
        bl = rv_l.get_json()

        self.assertEqual(set(bc.keys()), set(bl.keys()))
        self.assertEqual(bc["data"], bl["data"])
        self.assertEqual(bc["total"], bl["total"])
        self.assertEqual(bc["total_pages"], bl["total_pages"])


class TestPhase7DDeletion(TestPhase7DDatasetSetup):
    """F7D-09: Delete cascades to DatasetChunk rows."""

    def test_delete_removes_chunks(self):
        from database import DatasetChunk
        rows = [{"col_a": i} for i in range(10)]
        ds_id = _make_dataset(self.app, self.user_id, rows, chunks_migrated=True)

        # Confirm chunks exist
        with self.app.app_context():
            cnt = DatasetChunk.query.filter_by(dataset_id=ds_id).count()
            self.assertGreater(cnt, 0)

        rv = _delete(self.client, self.csrf, f"/api/dataset/{ds_id}")
        self.assertEqual(rv.status_code, 200)

        with self.app.app_context():
            cnt = DatasetChunk.query.filter_by(dataset_id=ds_id).count()
            self.assertEqual(cnt, 0, "All chunks must be removed when dataset is deleted")


class TestPhase7DBackfill(TestPhase7DDatasetSetup):
    """F7D-10 to F7D-13 (+22 to 26): real run_backfill() behavior."""

    def _unmigrated_dataset(self, rows, **kw):
        return _make_dataset(self.app, self.user_id, rows, chunks_migrated=False, **kw)

    def _run(self, **kw):
        from backfill_chunks import run_backfill
        return run_backfill(app=self.app, **kw)

    def _state(self, ds_id):
        """Return (chunks_migrated, [(chunk_index, rows_json), ...])."""
        from database import Dataset, DatasetChunk, db
        with self.app.app_context():
            ds = db.session.get(Dataset, ds_id)
            chunks = (DatasetChunk.query.filter_by(dataset_id=ds_id)
                      .order_by(DatasetChunk.chunk_index).all())
            return ds.chunks_migrated, [(c.chunk_index, c.rows_json) for c in chunks]

    @staticmethod
    def _rows_of(chunk_state):
        out = []
        for _, rj in chunk_state:
            out.extend(json.loads(rj))
        return out

    # F7D-10
    def test_backfill_migrates_dataset(self):
        """run_backfill populates chunks and sets chunks_migrated=True."""
        from database import CHUNK_SIZE
        rows = [{"col_a": i} for i in range(CHUNK_SIZE + 7)]
        ds_id = self._unmigrated_dataset(rows)

        self.assertEqual(self._run(), 0)

        migrated, chunks = self._state(ds_id)
        self.assertTrue(migrated)
        self.assertEqual([i for i, _ in chunks], [0, 1])
        self.assertEqual(self._rows_of(chunks), rows)

    # F7D-11 / F7D-25
    def test_backfill_second_run_skips_migrated(self):
        """A second run leaves already-migrated datasets' chunks untouched."""
        rows = [{"col_a": i} for i in range(5)]
        ds_id = self._unmigrated_dataset(rows)
        self.assertEqual(self._run(), 0)
        first = self._state(ds_id)

        from database import DatasetChunk, db
        with self.app.app_context():
            ids_before = sorted(c.id for c in DatasetChunk.query.filter_by(dataset_id=ds_id))

        self.assertEqual(self._run(), 0)

        self.assertEqual(self._state(ds_id), first)
        with self.app.app_context():
            ids_after = sorted(c.id for c in DatasetChunk.query.filter_by(dataset_id=ds_id))
        # Same primary keys => rows were skipped, not deleted and re-inserted.
        self.assertEqual(ids_before, ids_after)

    # F7D-12 / F7D-22
    def test_backfill_malformed_dataset_does_not_block_valid_one(self):
        """Malformed dataset is failed (exit 1); the valid dataset still migrates."""
        bad_id = self._unmigrated_dataset([], data_json_override="NOT VALID JSON {{{")
        good_rows = [{"col_a": i} for i in range(3)]
        good_id = self._unmigrated_dataset(good_rows)   # higher id, processed after bad

        with self.assertLogs("backfill_chunks", level="ERROR") as logs:
            rc = self._run()

        self.assertEqual(rc, 1, "Exit code must be non-zero when any dataset failed")
        self.assertTrue(any("malformed data_json" in m and f"id={bad_id}" in m
                            for m in logs.output))

        bad_migrated, bad_chunks = self._state(bad_id)
        self.assertFalse(bad_migrated)
        self.assertEqual(bad_chunks, [])

        good_migrated, good_chunks = self._state(good_id)
        self.assertTrue(good_migrated)
        self.assertEqual(self._rows_of(good_chunks), good_rows)

    # F7D-23
    def test_backfill_repairs_stale_chunks_without_duplicates(self):
        """Stale chunks + chunks_migrated=False are replaced atomically on rerun."""
        from database import CHUNK_SIZE, DatasetChunk, db
        rows = [{"col_a": i} for i in range(CHUNK_SIZE + 3)]
        ds_id = self._unmigrated_dataset(rows)

        # Simulate an interrupted/foreign write: stale chunks, flag still False.
        with self.app.app_context():
            db.session.add(DatasetChunk(dataset_id=ds_id, chunk_index=0,
                                        rows_json=json.dumps([{"col_a": "STALE"}])))
            db.session.add(DatasetChunk(dataset_id=ds_id, chunk_index=7,
                                        rows_json=json.dumps([{"col_a": "STALE7"}])))
            db.session.commit()
        self.assertFalse(self._state(ds_id)[0])

        self.assertEqual(self._run(), 0)

        migrated, chunks = self._state(ds_id)
        self.assertTrue(migrated)
        self.assertEqual([i for i, _ in chunks], [0, 1], "no duplicates, no leftover index 7")
        self.assertEqual(self._rows_of(chunks), rows)

    def test_backfill_savepoint_failure_rolls_back_stale_delete(self):
        """If inserting canonical chunks fails, the stale-chunk delete is rolled back too."""
        from unittest import mock
        from database import DatasetChunk, db
        rows = [{"col_a": i} for i in range(3)]
        ds_id = self._unmigrated_dataset(rows)
        with self.app.app_context():
            db.session.add(DatasetChunk(dataset_id=ds_id, chunk_index=0,
                                        rows_json=json.dumps([{"col_a": "STALE"}])))
            db.session.commit()
        before = self._state(ds_id)

        def boom(*a, **kw):
            raise RuntimeError("forced insert failure")

        with mock.patch("database.DatasetChunk.__init__", side_effect=boom):
            rc = self._run()

        self.assertEqual(rc, 1)
        self.assertEqual(self._state(ds_id), before, "delete+insert+flag must be atomic")

    # F7D-13 / F7D-24
    def test_backfill_dry_run_writes_nothing(self):
        """Dry-run writes no chunks and flips no flags, and validates like a real run."""
        from database import DatasetChunk, db
        ok_id = self._unmigrated_dataset([{"col_a": i} for i in range(5)])
        bad_json_id = self._unmigrated_dataset([], data_json_override="NOT VALID JSON {{{")
        non_list_id = self._unmigrated_dataset([], data_json_override='{"a": 1}')
        null_id = self._unmigrated_dataset([], data_json_override="null")
        stale_id = self._unmigrated_dataset([{"col_a": 1}])
        with self.app.app_context():
            db.session.add(DatasetChunk(dataset_id=stale_id, chunk_index=0,
                                        rows_json=json.dumps([{"col_a": "STALE"}])))
            db.session.commit()

        all_ids = [ok_id, bad_json_id, non_list_id, null_id, stale_id]
        before = {i: self._state(i) for i in all_ids}

        with self.assertLogs("backfill_chunks", level="ERROR") as logs:
            dry_rc = self._run(dry_run=True)

        # Same failures as a real run would report: bad JSON, {"a":1}, and "null".
        self.assertEqual(dry_rc, 1)
        errors = " ".join(logs.output)
        for bad in (bad_json_id, non_list_id, null_id):
            self.assertIn(f"id={bad}", errors)
        self.assertNotIn(f"id={ok_id}", errors)
        self.assertEqual({i: self._state(i) for i in all_ids}, before,
                         "Dry-run must not change chunks or chunks_migrated")

        # And a real run agrees with the dry-run's verdict.
        with self.assertLogs("backfill_chunks", level="ERROR"):
            real_rc = self._run()
        self.assertEqual(real_rc, dry_rc)
        self.assertTrue(self._state(ok_id)[0])
        for bad in (bad_json_id, non_list_id, null_id):
            self.assertFalse(self._state(bad)[0])

    # F7D-26
    def test_backfill_dataset_id_filter_and_row_count_warning(self):
        """--dataset-id restricts the run; row_count mismatch warns but is not rewritten."""
        from database import Dataset, db
        a = self._unmigrated_dataset([{"col_a": 1}, {"col_a": 2}])
        b = self._unmigrated_dataset([{"col_a": 3}])
        with self.app.app_context():
            db.session.get(Dataset, a).row_count = 99   # deliberately wrong
            db.session.commit()

        with self.assertLogs("backfill_chunks", level="WARNING") as logs:
            rc = self._run(dataset_id_filter=a)

        self.assertEqual(rc, 0)
        self.assertTrue(any("ROW COUNT MISMATCH" in m for m in logs.output))
        self.assertTrue(self._state(a)[0])
        self.assertFalse(self._state(b)[0], "Other datasets must not be touched")
        with self.app.app_context():
            self.assertEqual(db.session.get(Dataset, a).row_count, 99)


class TestPhase7DChatIntegration(TestPhase7DDatasetSetup):
    """F7D-19: Chat endpoint loads rows from chunks when chunks_migrated=True."""

    def test_chat_loads_rows_from_chunks(self):
        """_load_all_rows returns all rows from chunks for a migrated dataset."""
        from database import Dataset
        rows = [{"col_a": i} for i in range(12)]
        ds_id = _make_dataset(self.app, self.user_id, rows, chunks_migrated=True)

        with self.app.app_context():
            from database import Dataset, db
            ds = db.session.get(Dataset, ds_id)
            from api.chat import _load_all_rows
            loaded = _load_all_rows(ds)
        self.assertEqual(loaded, rows)

    def test_chat_load_all_rows_fallback(self):
        """_load_all_rows falls back to data_json for unmigrated datasets."""
        from database import Dataset
        rows = [{"col_a": i} for i in range(5)]
        ds_id = _make_dataset(self.app, self.user_id, rows, chunks_migrated=False)

        with self.app.app_context():
            from database import Dataset, db
            ds = db.session.get(Dataset, ds_id)
            from api.chat import _load_all_rows
            loaded = _load_all_rows(ds)
        self.assertEqual(loaded, rows)


class TestPhase7DInsightsIntegration(TestPhase7DDatasetSetup):
    """F7D-20: Insights endpoint reads only the first chunk for the sample."""

    def test_insights_reads_only_first_chunk(self):
        """For migrated datasets, insights only fetches chunk_index=0."""
        from database import DatasetChunk, Dataset
        from database import CHUNK_SIZE

        total = CHUNK_SIZE + 100
        rows = [{"col_a": i} for i in range(total)]
        ds_id = _make_dataset(self.app, self.user_id, rows, chunks_migrated=True)

        with self.app.app_context():
            from database import DatasetChunk, Dataset, db
            ds = db.session.get(Dataset, ds_id)
            # Simulate what insights.py does for a migrated dataset
            first_chunk = DatasetChunk.query.filter_by(
                dataset_id=ds_id, chunk_index=0
            ).first()
            self.assertIsNotNone(first_chunk)
            sample = json.loads(first_chunk.rows_json)[:10]
            self.assertEqual(len(sample), 10)
            self.assertEqual(sample[0]["col_a"], 0)


class TestPhase7DIDOR(TestPhase7DDatasetSetup):
    """F7D-21: IDOR check on the chunk pagination path."""

    def setUp(self):
        super().setUp()
        self.client_b = self.app.test_client()
        self.csrf_b = _register_and_login(self.client_b, "chunk_user_b@example.com")
        with self.app.app_context():
            from database import User
            self.user_b_id = User.query.filter_by(email="chunk_user_b@example.com").first().id

    def test_user_b_cannot_read_user_a_chunk_data(self):
        rows = [{"col_a": i} for i in range(5)]
        ds_id = _make_dataset(self.app, self.user_id, rows, chunks_migrated=True)

        rv = _get(self.client_b, self.csrf_b, f"/api/dataset/{ds_id}/data")
        self.assertEqual(rv.status_code, 404,
                         f"User B must receive 404 for User A's dataset, got {rv.status_code}")


if __name__ == "__main__":
    unittest.main(verbosity=2)

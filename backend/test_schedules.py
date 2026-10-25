import unittest
from datetime import datetime, timezone, timedelta
from unittest import mock  # also makes ``unittest.mock`` available to the tests below
from app import create_app
from database import db, User, ScheduledScan, Scan

class TestSchedules(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config['TESTING'] = True
        self.app_context = self.app.app_context()
        self.app_context.push()
        self.client = self.app.test_client()
        db.create_all()

        self.u = User(email="sched@dfas.local", role="analyst", full_name="Sched User")
        self.u.set_password("pass")
        db.session.add(self.u)
        db.session.commit()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.app_context.pop()

    def _headers(self):
        self.client.post("/api/auth/login", json={"email": "sched@dfas.local", "password": "pass"})
        token = self.client.get_cookie("csrf_access_token")
        return {"X-CSRF-TOKEN": token.value if token else ""}

    def test_create_schedule_validates_frequency(self):
        headers = self._headers()

        # Valid freq
        resp = self.client.post("/api/schedule/", json={
            "target": "example", "target_username": "example",
            "scan_mode": "quick", "frequency": "daily"
        }, headers=headers)
        self.assertEqual(resp.status_code, 201)

        # Invalid freq
        resp2 = self.client.post("/api/schedule/", json={
            "target": "example2", "target_username": "example2",
            "scan_mode": "quick", "frequency": "hourly"
        }, headers=headers)
        self.assertEqual(resp2.status_code, 400)

    def test_process_schedules_spawns_tasks(self):
        from tasks import process_schedules

        # Create a schedule that is due now
        sched = ScheduledScan(
            user_id=self.u.id, target_username="due_user", frequency="daily",
            next_run=datetime.now(timezone.utc) - timedelta(minutes=5)
        )
        db.session.add(sched)
        db.session.commit()

        # Call the beat evaluator
        with unittest.mock.patch('tasks.run_scan_task.apply_async') as mock_delay:
            process_schedules()
            mock_delay.assert_called_once()

        # Ensure next run was incremented
        updated_sched = ScheduledScan.query.get(sched.id)
        self.assertGreater(updated_sched.next_run, datetime.now())

    # ── Phase 7: Beat deduplication ───────────────────────────────────────────

    def _due_schedule(self, minutes_ago=5):
        due = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
        sched = ScheduledScan(
            user_id=self.u.id, target_username="due_user", frequency="daily",
            next_run=due,
        )
        db.session.add(sched)
        db.session.commit()
        # SQLite DateTime columns come back naive (UTC wall time).
        return sched.id, due.replace(tzinfo=None)

    def _scan_count(self):
        db.session.expire_all()
        return Scan.query.filter_by(user_id=self.u.id, execution_backend="celery").count()

    def test_due_schedule_creates_exactly_one_scan_when_processed_twice(self):
        from tasks import process_schedules
        sid, _ = self._due_schedule()

        with mock.patch("tasks.run_scan_task.apply_async") as mock_delay:
            process_schedules()
            process_schedules()

        self.assertEqual(mock_delay.call_count, 1)
        self.assertEqual(self._scan_count(), 1)

    def test_schedule_claimed_by_overlapping_execution_is_skipped(self):
        """The conditional claim affects zero rows when another execution won.

        The race is reproduced against the real database: after this execution
        has taken its due-list snapshot, a competing execution (separate
        connection) claims and commits the same schedule.  The real
        process_schedules must then skip it and create no scan.
        """
        import api.schedule as schedule_api
        from tasks import process_schedules

        sid, _ = self._due_schedule()
        competitor_next = datetime.now(timezone.utc) + timedelta(days=1)
        competitor_last = datetime.now(timezone.utc)
        real_compute = schedule_api._compute_next_run
        raced = {"count": 0}

        def compute_after_competitor_claims(frequency):
            # Runs after process_schedules read its snapshot, before it claims.
            with db.engine.begin() as conn:
                conn.execute(
                    db.update(ScheduledScan)
                    .where(ScheduledScan.id == sid)
                    .values(last_run=competitor_last, next_run=competitor_next)
                )
            raced["count"] += 1
            return real_compute(frequency)

        with mock.patch("api.schedule._compute_next_run", side_effect=compute_after_competitor_claims), \
                mock.patch("tasks.run_scan_task.apply_async") as mock_delay, \
                self.assertLogs("tasks", level="INFO") as logs:
            process_schedules()

        self.assertEqual(raced["count"], 1, "Race simulation must have run")
        mock_delay.assert_not_called()
        self.assertEqual(self._scan_count(), 0)
        self.assertTrue(any("already claimed" in m for m in logs.output))

        db.session.expire_all()
        sched = db.session.get(ScheduledScan, sid)
        # The competitor's claim is untouched by the skipped execution.
        self.assertEqual(sched.next_run, competitor_next.replace(tzinfo=None))
        self.assertEqual(sched.last_run, competitor_last.replace(tzinfo=None))

    def test_failed_scan_insert_rolls_back_schedule_claim(self):
        from tasks import process_schedules
        sid, due = self._due_schedule()

        with mock.patch("database.Scan", side_effect=RuntimeError("scan insert failed")), \
                mock.patch("tasks.run_scan_task.apply_async") as mock_delay, \
                self.assertLogs("tasks", level="ERROR"):
            process_schedules()

        mock_delay.assert_not_called()
        self.assertEqual(self._scan_count(), 0)
        sched = db.session.get(ScheduledScan, sid)
        self.assertEqual(sched.next_run, due, "Claim must be rolled back with the failed insert")
        self.assertIsNone(sched.last_run)

        # The schedule is still due, so the next run succeeds normally.
        with mock.patch("tasks.run_scan_task.apply_async") as mock_delay:
            process_schedules()
        self.assertEqual(mock_delay.call_count, 1)
        self.assertEqual(self._scan_count(), 1)

    def test_beat_entry_expires_stale_ticks_after_300_seconds(self):
        from celery.beat import ScheduleEntry
        from config import Config
        from tasks import celery_app

        name = "process-scheduled-scans"
        entry = celery_app.conf.beat_schedule[name]

        # Existing behavior preserved.
        self.assertEqual(entry["task"], "dfas.schedules.process")
        self.assertEqual(entry["schedule"], 300.0)
        self.assertNotIn("queue", entry["options"])
        self.assertEqual(celery_app.conf.task_default_queue, Config.SCAN_QUEUE_NAME)

        # New: 300-second expiry, accepted by Celery Beat and the message protocol.
        self.assertEqual(entry["options"], {"expires": 300})
        beat_entry = ScheduleEntry(**dict(entry, name=name, app=celery_app))
        self.assertEqual(beat_entry.options["expires"], 300)
        message = celery_app.amqp.as_task_v2(
            "test-task-id", entry["task"], expires=beat_entry.options["expires"],
        )
        self.assertIsNotNone(message.headers.get("expires"))

    # ── Scheduled-scan dispatch recovery ──────────────────────────────────────

    def _scan_by_id(self, scan_id):
        db.session.expire_all()
        return db.session.get(Scan, scan_id)

    def _only_celery_scan(self):
        db.session.expire_all()
        scans = Scan.query.filter_by(user_id=self.u.id, execution_backend="celery").all()
        self.assertEqual(len(scans), 1)
        return scans[0]

    def _make_scan(self, *, status="queued", dispatch_state="pending",
                   attempted_minutes_ago=30, backend="celery",
                   task_id="fixed-task-id", created_minutes_ago=30):
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        scan = Scan(
            user_id=self.u.id, target_name="t", target_username="t", mode="quick",
            execution_backend=backend, status=status, task_id=task_id,
            dispatch_state=dispatch_state,
            dispatch_attempted_at=(
                now - timedelta(minutes=attempted_minutes_ago)
                if attempted_minutes_ago is not None else None
            ),
            created_at=now - timedelta(minutes=created_minutes_ago),
        )
        db.session.add(scan)
        db.session.commit()
        return scan.id

    def test_scheduled_scan_created_pending_with_stable_task_id_then_published(self):
        from tasks import process_schedules
        self._due_schedule()

        with mock.patch("tasks.run_scan_task.apply_async") as publish:
            process_schedules()

        scan = self._only_celery_scan()
        self.assertEqual(scan.status, "queued")
        self.assertIsNotNone(scan.task_id)
        self.assertEqual(len(scan.task_id), 36, "pre-generated UUID task id")
        self.assertIsNotNone(scan.dispatch_attempted_at)
        # Published exactly once, with the stored id; confirmation flipped the state.
        publish.assert_called_once_with(args=[scan.id], task_id=scan.task_id)
        self.assertEqual(scan.dispatch_state, "published")

    def test_dispatch_exception_leaves_scan_pending_with_task_id(self):
        from tasks import process_schedules
        sid, _ = self._due_schedule()

        with mock.patch("tasks.run_scan_task.apply_async", side_effect=RuntimeError("broker down")), \
                self.assertLogs("tasks", level="ERROR"):
            process_schedules()

        scan = self._only_celery_scan()
        self.assertEqual(scan.dispatch_state, "pending")
        self.assertIsNotNone(scan.task_id, "task id must not be cleared")
        self.assertEqual(scan.status, "queued")
        # The schedule claim is NOT undone by a publish failure.
        sched = db.session.get(ScheduledScan, sid)
        self.assertIsNotNone(sched.last_run)

    def test_publish_without_confirmation_is_retried_with_same_task_id(self):
        """Crash-equivalent: message published, confirmation never recorded."""
        from tasks import process_schedules, recover_orphaned_scans
        self._due_schedule()

        with mock.patch("tasks.run_scan_task.apply_async") as first_publish, \
                mock.patch("tasks._mark_published", side_effect=RuntimeError("crashed before confirm")), \
                self.assertLogs("tasks", level="ERROR"):
            process_schedules()
        first_publish.assert_called_once()

        scan = self._only_celery_scan()
        self.assertEqual(scan.dispatch_state, "pending")
        stored_id = scan.task_id
        first_call_id = first_publish.call_args.kwargs["task_id"]
        self.assertEqual(first_call_id, stored_id)

        # Lease still fresh: no retry yet.
        with mock.patch("tasks.run_scan_task.apply_async") as early:
            recover_orphaned_scans()
        early.assert_not_called()

        # Lease expires: retried with the SAME task id (at-least-once).
        scan.dispatch_attempted_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=30)
        db.session.commit()
        with mock.patch("tasks.run_scan_task.apply_async") as retry:
            recover_orphaned_scans()
        retry.assert_called_once_with(args=[scan.id], task_id=stored_id)
        self.assertEqual(self._scan_by_id(scan.id).dispatch_state, "published")

    def test_expired_pending_claim_is_recovered(self):
        from tasks import recover_orphaned_scans
        sid = self._make_scan(attempted_minutes_ago=30)
        before = self._scan_by_id(sid).dispatch_attempted_at

        with mock.patch("tasks.run_scan_task.apply_async") as publish:
            recover_orphaned_scans()

        publish.assert_called_once_with(args=[sid], task_id="fixed-task-id")
        scan = self._scan_by_id(sid)
        self.assertEqual(scan.dispatch_state, "published")
        self.assertGreater(scan.dispatch_attempted_at, before)

    def test_null_attempted_at_pending_scan_is_recovered(self):
        from tasks import recover_orphaned_scans
        sid = self._make_scan(attempted_minutes_ago=None)
        with mock.patch("tasks.run_scan_task.apply_async") as publish:
            recover_orphaned_scans()
        publish.assert_called_once_with(args=[sid], task_id="fixed-task-id")

    def test_recovery_publish_error_leaves_pending_for_later_retry(self):
        from tasks import recover_orphaned_scans
        sid = self._make_scan(attempted_minutes_ago=30)

        with mock.patch("tasks.run_scan_task.apply_async", side_effect=RuntimeError("down")), \
                self.assertLogs("tasks", level="ERROR"):
            recover_orphaned_scans()

        scan = self._scan_by_id(sid)
        self.assertEqual(scan.dispatch_state, "pending")
        self.assertEqual(scan.task_id, "fixed-task-id")
        # The lease was taken, so an immediate second pass does not hammer the broker.
        with mock.patch("tasks.run_scan_task.apply_async") as again:
            recover_orphaned_scans()
        again.assert_not_called()

    def test_fresh_claim_cannot_be_taken_over(self):
        from tasks import recover_orphaned_scans
        sid = self._make_scan(attempted_minutes_ago=1)
        before = self._scan_by_id(sid).dispatch_attempted_at

        with mock.patch("tasks.run_scan_task.apply_async") as publish:
            recover_orphaned_scans()

        publish.assert_not_called()
        scan = self._scan_by_id(sid)
        self.assertEqual(scan.dispatch_state, "pending")
        self.assertEqual(scan.dispatch_attempted_at, before)

    def test_competing_recovery_workers_only_one_claim_succeeds(self):
        """A competitor takes the lease after our candidate snapshot, before our claim."""
        import tasks
        sid = self._make_scan(attempted_minutes_ago=30)
        real_claim = tasks._claim_dispatch
        competitor_time = datetime.now(timezone.utc).replace(tzinfo=None)
        raced = {"count": 0}

        def claim_after_competitor(scan_id, now, lease_cutoff):
            with db.engine.begin() as conn:
                conn.execute(
                    db.update(Scan).where(Scan.id == scan_id)
                    .values(dispatch_attempted_at=competitor_time)
                )
            raced["count"] += 1
            return real_claim(scan_id, now, lease_cutoff)

        with mock.patch("tasks._claim_dispatch", side_effect=claim_after_competitor), \
                mock.patch("tasks.run_scan_task.apply_async") as publish, \
                self.assertLogs("tasks", level="INFO") as logs:
            tasks.recover_orphaned_scans()

        self.assertEqual(raced["count"], 1, "Race simulation must have run")
        publish.assert_not_called()
        self.assertTrue(any("already claimed" in m for m in logs.output))
        scan = self._scan_by_id(sid)
        self.assertEqual(scan.dispatch_state, "pending")
        self.assertEqual(scan.dispatch_attempted_at, competitor_time)

    def test_claim_dispatch_affects_one_row_then_zero(self):
        import tasks
        sid = self._make_scan(attempted_minutes_ago=30)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        cutoff = now - timedelta(seconds=tasks.DISPATCH_LEASE_SECONDS)
        self.assertEqual(tasks._claim_dispatch(sid, now, cutoff), 1)
        self.assertEqual(tasks._claim_dispatch(sid, now, cutoff), 0)

    def test_published_scans_are_never_redispatched_regardless_of_age(self):
        from tasks import recover_orphaned_scans
        sid = self._make_scan(dispatch_state="published", attempted_minutes_ago=60 * 24 * 7,
                              created_minutes_ago=60 * 24 * 7)
        before = self._scan_by_id(sid).dispatch_attempted_at

        with mock.patch("tasks.run_scan_task.apply_async") as publish:
            recover_orphaned_scans()

        publish.assert_not_called()
        scan = self._scan_by_id(sid)
        self.assertEqual(scan.dispatch_state, "published")
        self.assertEqual(scan.status, "queued")
        self.assertEqual(scan.dispatch_attempted_at, before)

    def test_running_completed_failed_and_ineligible_scans_are_untouched(self):
        from tasks import recover_orphaned_scans
        ids = {
            "running": self._make_scan(status="running"),
            "completed": self._make_scan(status="completed"),
            "failed": self._make_scan(status="failed"),
            "null_state": self._make_scan(dispatch_state=None),
            "manual_pending": self._make_scan(status="pending", dispatch_state=None, backend=None),
            "non_celery": self._make_scan(backend="thread"),
        }
        snapshot = {
            name: (s.status, s.dispatch_state, s.dispatch_attempted_at, s.task_id)
            for name, sid in ids.items() for s in [self._scan_by_id(sid)]
        }

        with mock.patch("tasks.run_scan_task.apply_async") as publish:
            recover_orphaned_scans()

        publish.assert_not_called()
        for name, sid in ids.items():
            s = self._scan_by_id(sid)
            self.assertEqual(
                (s.status, s.dispatch_state, s.dispatch_attempted_at, s.task_id),
                snapshot[name], name,
            )

    def test_prolonged_pending_scan_is_logged_not_failed(self):
        from tasks import recover_orphaned_scans
        sid = self._make_scan(attempted_minutes_ago=30, created_minutes_ago=60 * 5)

        with mock.patch("tasks.run_scan_task.apply_async", side_effect=RuntimeError("down")), \
                self.assertLogs("tasks", level="WARNING") as logs:
            recover_orphaned_scans()

        self.assertTrue(any("pending dispatch" in m for m in logs.output))
        scan = self._scan_by_id(sid)
        self.assertEqual(scan.status, "queued")
        self.assertEqual(scan.dispatch_state, "pending")

    def test_recovery_beat_entry_has_expiry(self):
        from tasks import celery_app
        entry = celery_app.conf.beat_schedule["recover-orphaned-scans"]
        self.assertEqual(entry["task"], "dfas.scans.recover")
        self.assertEqual(entry["options"], {"expires": 300})
        self.assertIn("dfas.scans.recover", celery_app.tasks)
        # The existing schedule entry is unchanged.
        existing = celery_app.conf.beat_schedule["process-scheduled-scans"]
        self.assertEqual(existing["task"], "dfas.schedules.process")
        self.assertEqual(existing["schedule"], 300.0)
        self.assertEqual(existing["options"], {"expires": 300})


if __name__ == "__main__":
    unittest.main()

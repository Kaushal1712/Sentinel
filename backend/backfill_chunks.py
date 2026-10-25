#!/usr/bin/env python3
"""Backfill management command — populate DatasetChunk rows for existing datasets.

Usage
-----
    # Inside the Docker container (or with backend deps available):
    python backfill_chunks.py [--dry-run] [--batch-size N] [--dataset-id ID]

Options
-------
    --dry-run          Inspect and report without writing any data.
    --batch-size N     Datasets processed per outer progress log line (default 10).
    --dataset-id ID    Backfill only the single dataset with this primary key.

Idempotency and recovery
------------------------
A dataset is skipped if ``Dataset.chunks_migrated`` is already True.  For a
dataset that is not yet flagged, any chunk rows already present are deleted
and the canonical chunks are re-inserted, all inside one savepoint, so a rerun
repairs stale chunks instead of failing.  The unique constraint
``uq_dataset_chunk`` only guarantees that a (dataset_id, chunk_index) pair can
never be stored twice; it does not by itself repair interrupted work.

Transaction safety
------------------
Each dataset is processed in its own nested savepoint (stale-chunk delete,
chunk inserts and ``chunks_migrated=True``), followed by a commit.  On failure
the work is rolled back and the run continues with the next dataset, so the
flag is only visible after a successful per-dataset commit.

Memory
------
Dataset IDs are read in bounded keyset pages and each dataset (including its
potentially large ``data_json``) is loaded and released one at a time.

Error handling
--------------
- Malformed ``data_json`` (invalid JSON) or valid JSON that is not an array:
  logged as ERROR, dataset counted as failed with ``chunks_migrated`` left False.
  Dry-run applies exactly the same rules.
- ``data_json`` is NULL or empty: treated as an empty dataset (one empty chunk
  written, ``chunks_migrated`` set True so the pagination endpoint returns []).
- DB errors: the savepoint is rolled back and the dataset is counted as failed.
- A parsed row count that differs from ``Dataset.row_count`` is logged as a
  WARNING; the stored row count is never rewritten.

Exit codes
----------
    0  All eligible datasets migrated successfully.
    1  One or more datasets failed (check logs).
    2  Configuration/startup error.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("backfill_chunks")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dry-run", action="store_true",
                   help="Report what would be migrated without writing anything.")
    p.add_argument("--batch-size", type=int, default=10,
                   help="Progress log every N datasets (default: 10).")
    p.add_argument("--dataset-id", type=int, default=None,
                   help="Backfill only this dataset ID.")
    return p.parse_args()


def _build_chunks(rows: list[dict], chunk_size: int) -> list[list[dict]]:
    """Split *rows* into ordered batches of at most *chunk_size* rows."""
    if not rows:
        return [[]]   # one empty chunk to mark the dataset as fully migrated
    return [rows[i: i + chunk_size] for i in range(0, len(rows), chunk_size)]


def _parse_rows(data_json: str | None) -> list:
    """Parse ``Dataset.data_json`` into a list of rows.

    Shared by the real run and ``--dry-run`` so both apply identical rules.
    NULL/empty is an empty dataset.  Raises ``ValueError`` (including
    ``json.JSONDecodeError``) for invalid JSON and ``TypeError`` for valid JSON
    that is not an array.
    """
    if not data_json:
        return []
    rows = json.loads(data_json)
    if not isinstance(rows, list):
        raise TypeError(f"data_json is not a JSON array, got {type(rows).__name__}")
    return rows


# Upper bound on the number of dataset IDs held in memory at once.
_ID_PAGE_SIZE = 500


def run_backfill(
    dry_run: bool = False,
    batch_size: int = 10,
    dataset_id_filter: int | None = None,
    app=None,
) -> int:
    """Main backfill logic.  Returns 0 on full success, 1 if any dataset failed.

    ``app`` may be supplied (e.g. by tests) to use an existing Flask app;
    otherwise one is created with ``create_app()``.
    """
    try:
        from app import create_app
        from database import CHUNK_SIZE, Dataset, DatasetChunk, db
    except ImportError as exc:
        logger.error("Cannot import application modules: %s", exc)
        logger.error("Run this script from the backend/ directory with the application venv active.")
        return 2

    if app is None:
        app = create_app()
    batch_size = max(1, batch_size)

    with app.app_context():
        base_filter = []
        if dataset_id_filter is not None:
            base_filter.append(Dataset.id == dataset_id_filter)

        total = db.session.query(db.func.count(Dataset.id)).filter(*base_filter).scalar() or 0
        logger.info("Found %d dataset(s) to inspect (dry_run=%s)", total, dry_run)

        skipped = already_done = migrated = failed = 0
        idx = 0
        last_id = 0

        while True:
            # Bounded keyset page of (id, flag) only — no data_json is loaded here.
            page = (
                db.session.query(Dataset.id, Dataset.chunks_migrated)
                .filter(Dataset.id > last_id, *base_filter)
                .order_by(Dataset.id)
                .limit(_ID_PAGE_SIZE)
                .all()
            )
            if not page:
                break
            last_id = page[-1][0]

            for ds_id, already_flagged in page:
                idx += 1

                if not already_flagged:
                    # Load exactly one dataset; the flag is re-checked on the fresh
                    # row in case another process migrated it since the page read.
                    dataset = db.session.get(Dataset, ds_id)
                else:
                    dataset = None

                if dataset is None or dataset.chunks_migrated:
                    # ── Skip already-migrated datasets ────────────────────────
                    already_done += 1
                    logger.debug("SKIP (already migrated): dataset id=%s", ds_id)
                else:
                    ds_label = f"dataset id={ds_id} name={dataset.name!r}"
                    expected_rows = dataset.row_count or 0
                    raw_json = dataset.data_json

                    # ── Parse rows (identical rules for dry-run and real run) ─
                    rows = None
                    try:
                        rows = _parse_rows(raw_json)
                    except (ValueError, TypeError) as exc:
                        prefix = "DRY-RUN  " if dry_run else "FAIL (malformed data_json) "
                        logger.error("%s%s: %s", prefix, ds_label, exc)
                        failed += 1

                    if rows is not None:
                        if len(rows) != expected_rows:
                            logger.warning(
                                "ROW COUNT MISMATCH %s: parsed %d rows but row_count=%d "
                                "(stored row_count left unchanged)",
                                ds_label, len(rows), expected_rows,
                            )
                        chunk_batches = _build_chunks(rows, CHUNK_SIZE)

                        if dry_run:
                            logger.info("DRY-RUN  %s: %d rows → %d chunks",
                                        ds_label, len(rows), len(chunk_batches))
                            migrated += 1
                        else:
                            # ── Delete stale chunks + write canonical chunks + set
                            # flag atomically in a per-dataset savepoint ──────────
                            try:
                                with db.session.begin_nested():
                                    stale = (
                                        DatasetChunk.query
                                        .filter_by(dataset_id=ds_id)
                                        .delete(synchronize_session=False)
                                    )
                                    for chunk_index, batch in enumerate(chunk_batches):
                                        db.session.add(DatasetChunk(
                                            dataset_id=ds_id,
                                            chunk_index=chunk_index,
                                            rows_json=json.dumps(batch, default=str),
                                        ))
                                    dataset.chunks_migrated = True
                                db.session.commit()
                                migrated += 1
                                if stale:
                                    logger.warning(
                                        "Replaced %d stale chunk(s) for %s", stale, ds_label)
                                logger.info("OK  %s: %d rows → %d chunks",
                                            ds_label, len(rows), len(chunk_batches))
                            except Exception as exc:
                                db.session.rollback()
                                logger.error("FAIL (db error) %s: %s", ds_label, exc)
                                failed += 1

                    # Release the (possibly large) dataset before the next one.
                    del rows, raw_json

                # Drop every loaded instance so memory stays bounded.
                db.session.expunge_all()
                dataset = None

                if idx % batch_size == 0:
                    logger.info(
                        "Progress %d/%d — migrated=%d skipped=%d already_done=%d failed=%d",
                        idx, total, migrated, skipped, already_done, failed,
                    )

        # ── Final summary ─────────────────────────────────────────────────────
        logger.info(
            "=== Backfill complete: total=%d migrated=%d already_done=%d skipped=%d failed=%d ===",
            total, migrated, already_done, skipped, failed,
        )
        if dry_run:
            logger.info("DRY-RUN mode — no data was written.")

        return 1 if failed else 0


if __name__ == "__main__":
    args = _parse_args()
    sys.exit(run_backfill(
        dry_run=args.dry_run,
        batch_size=args.batch_size,
        dataset_id_filter=args.dataset_id,
    ))

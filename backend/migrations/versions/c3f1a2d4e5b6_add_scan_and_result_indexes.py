"""add scan and result indexes

Revision ID: c3f1a2d4e5b6
Revises: b8058a075657
Create Date: 2026-10-12 12:15:00.000000

Performance fix — Phase 7B (F7-BE-01, F7-BE-02).

Adds four missing indexes that are required to prevent full-table scans
on every authenticated API call:

  scans.user_id     — used by every dashboard, history, and results query
                      that filters by the authenticated user.
  scans.status      — used by dashboard running/completed counts.
  scans.created_at  — used by dashboard timeline and admin date-range queries.
  scan_results.scan_id — used by every visualization, export, and timeline
                         endpoint that fetches results for a scan.

PostgreSQL does not automatically index foreign-key columns.  The FK
constraints (scans_user_id_fkey, scan_results_scan_id_fkey) that existed
before this migration do NOT provide query acceleration.

batch_alter_table is used for full SQLite ALTER TABLE compatibility.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c3f1a2d4e5b6'
down_revision = 'b8058a075657'
branch_labels = None
depends_on = None


def upgrade():
    # ── scans table ──────────────────────────────────────────────────────────
    with op.batch_alter_table('scans', schema=None) as batch_op:
        # Index on user_id: required for every user-scoped query
        # (dashboard stats, history, scan list).
        batch_op.create_index(
            batch_op.f('ix_scans_user_id'),
            ['user_id'],
            unique=False,
        )
        # Index on status: required for running/completed/failed count queries.
        batch_op.create_index(
            batch_op.f('ix_scans_status'),
            ['status'],
            unique=False,
        )
        # Index on created_at: required for dashboard 14-day timeline and
        # admin week/month date-range aggregations.
        batch_op.create_index(
            batch_op.f('ix_scans_created_at'),
            ['created_at'],
            unique=False,
        )

    # ── scan_results table ────────────────────────────────────────────────────
    with op.batch_alter_table('scan_results', schema=None) as batch_op:
        # Index on scan_id: required for every per-scan results query
        # (geo, heatmap, timeline, graph, export).
        batch_op.create_index(
            batch_op.f('ix_scan_results_scan_id'),
            ['scan_id'],
            unique=False,
        )


def downgrade():
    with op.batch_alter_table('scan_results', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_scan_results_scan_id'))

    with op.batch_alter_table('scans', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_scans_created_at'))
        batch_op.drop_index(batch_op.f('ix_scans_status'))
        batch_op.drop_index(batch_op.f('ix_scans_user_id'))

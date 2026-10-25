"""add scans.dispatch_state and scans.dispatch_attempted_at

Revision ID: e5a1b2c3d4f6
Revises: d4e7f8a1b2c3
Create Date: 2026-10-17

Schema-only migration.  No data is backfilled: existing scans keep
dispatch_state NULL and are ignored by scheduled-scan dispatch recovery.

Upgrade adds (both nullable, no server default):
- scans.dispatch_state         (VARCHAR(20))  'pending' | 'published' | NULL
- scans.dispatch_attempted_at  (DATETIME)     lease timestamp, naive UTC

Downgrade drops both columns.
"""

from alembic import op
import sqlalchemy as sa

revision = "e5a1b2c3d4f6"
down_revision = "d4e7f8a1b2c3"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("scans") as batch_op:
        batch_op.add_column(sa.Column("dispatch_state", sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column("dispatch_attempted_at", sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table("scans") as batch_op:
        batch_op.drop_column("dispatch_attempted_at")
        batch_op.drop_column("dispatch_state")

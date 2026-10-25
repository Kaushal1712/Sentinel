"""allow anonymous audit events

Revision ID: b8058a075657
Revises: 0b963b63985b
Create Date: 2026-09-25 16:57:02.807431

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b8058a075657'
down_revision = '0b963b63985b'
branch_labels = None
depends_on = None


def upgrade():
    # Allow audit events that are not associated with a known user account.
    # A NULL user_id means the event occurred before authentication (e.g. a
    # login attempt against a non-existent email address).  All existing rows
    # have valid user_id values — no backfill is needed.
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.alter_column('user_id',
               existing_type=sa.INTEGER(),
               nullable=True)

    # Note: Alembic autogenerate also detected a legacy named index
    # 'ix_users_google_id' on users.google_id that was created by
    # ensure_runtime_migrations() and is redundant with the ORM-declared
    # UniqueConstraint('google_id').  That index cleanup is intentionally
    # deferred to a dedicated migration and is NOT included here.


def downgrade():
    # Restore NOT NULL on user_id (drops any anonymous audit rows permanently).
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.alter_column('user_id',
               existing_type=sa.INTEGER(),
               nullable=False)

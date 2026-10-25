"""add dataset_chunks table and chunks_migrated flag

Revision ID: d4e7f8a1b2c3
Revises: c3f1a2d4e5b6
Create Date: 2026-10-12

Schema-only migration.  No data is backfilled here.
Run ``python backfill_chunks.py`` as a separate step to populate
dataset_chunks for existing datasets and set chunks_migrated=True.

Upgrade adds:
- datasets.chunks_migrated  (BOOLEAN NOT NULL DEFAULT FALSE)
- dataset_chunks table with a unique constraint on (dataset_id, chunk_index)
- Index ix_dataset_chunks_dataset_id on dataset_chunks.dataset_id

Downgrade drops dataset_chunks and removes chunks_migrated.
"""

from alembic import op
import sqlalchemy as sa

revision = "d4e7f8a1b2c3"
down_revision = "c3f1a2d4e5b6"
branch_labels = None
depends_on = None


def upgrade():
    # ── 1. Add chunks_migrated column to datasets ─────────────────────────────
    # server_default ensures the column is added non-null without a table rewrite
    # on PostgreSQL (fast ALTER TABLE ... ADD COLUMN ... DEFAULT).
    op.add_column(
        "datasets",
        sa.Column(
            "chunks_migrated",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # ── 2. Create dataset_chunks table ────────────────────────────────────────
    op.create_table(
        "dataset_chunks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dataset_id", sa.Integer(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("rows_json", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dataset_id", "chunk_index", name="uq_dataset_chunk"),
    )

    # ── 3. Index for efficient per-dataset chunk queries ──────────────────────
    op.create_index(
        "ix_dataset_chunks_dataset_id",
        "dataset_chunks",
        ["dataset_id"],
    )


def downgrade():
    op.drop_index("ix_dataset_chunks_dataset_id", table_name="dataset_chunks")
    op.drop_table("dataset_chunks")
    op.drop_column("datasets", "chunks_migrated")

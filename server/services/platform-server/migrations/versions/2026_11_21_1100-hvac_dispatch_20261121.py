"""增加 HVAC 训练和分片任务的持久投递记录。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "hvac_dispatch_20261121"
down_revision: str | None = "dataset_point_ref_idx_20261121"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        "hvac_ac_models",
        sa.Column("training_dispatch_id", postgresql.UUID(), nullable=True),
        schema="platform",
    )
    op.create_table(
        "hvac_dispatches",
        sa.Column("id", postgresql.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("fields", postgresql.JSONB(), nullable=False),
        sa.Column(
            "dispatch_after",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
        sa.Column("dispatch_token", postgresql.UUID(), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("entry_id", sa.Text(), nullable=True),
        sa.Column("execution_token", postgresql.UUID(), nullable=True),
        sa.Column("execution_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_hvac_dispatches"),
        sa.CheckConstraint(
            "kind IN ('training', 'shard')",
            name="ck_hvac_dispatches_kind_known",
        ),
        schema="platform",
    )
    op.create_index(
        "ix_hvac_dispatches_waiting",
        "hvac_dispatches",
        ["dispatch_after", "id"],
        schema="platform",
        postgresql_where=sa.text("published_at IS NULL AND entry_id IS NULL"),
    )
    op.create_index(
        "ix_hvac_dispatches_completed",
        "hvac_dispatches",
        ["completed_at", "id"],
        schema="platform",
        postgresql_where=sa.text("completed_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("hvac_dispatches", schema="platform")
    op.drop_column("hvac_ac_models", "training_dispatch_id", schema="platform")

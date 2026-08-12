"""加分片表，并给批次加一列「没能对上的人工排除数」。

分片表是新建表；批次上加的是可空转有默认值的计数列，属扩展步，旧代码不读它
也照常工作。

Revision ID: b52e7d0c41a9
Revises: a71c3e5d94f8
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "b52e7d0c41a9"
down_revision: str | None = "a71c3e5d94f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ⚠ 与 apps/hvac/startups.py 同口径。那边加取值时，这里要跟一条新迁移改 CHECK
_SHARD_STATUSES = "'done', 'failed', 'pending'"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_shards()
    # 带非 volatile 默认值的加列不重写全表，不需要分两次发布
    op.add_column(
        "hvac_ac_startup_batches",
        sa.Column(
            "unmatched_exclusion_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        schema="platform",
    )
    op.create_check_constraint(
        "ck_hvac_ac_startup_batches_unmatched_exclusion_count_nonnegative",
        "hvac_ac_startup_batches",
        "unmatched_exclusion_count >= 0",
        schema="platform",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_constraint(
        "ck_hvac_ac_startup_batches_unmatched_exclusion_count_nonnegative",
        "hvac_ac_startup_batches",
        type_="check",
        schema="platform",
    )
    op.drop_column(
        "hvac_ac_startup_batches",
        "unmatched_exclusion_count",
        schema="platform",
    )
    op.drop_table("hvac_ac_startup_shards", schema="platform")


def _timestamps() -> tuple[sa.Column[datetime], sa.Column[datetime]]:
    """两列建表时刻。时刻一律 timestamptz 存 UTC。"""
    return (
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def _create_shards() -> None:
    op.create_table(
        "hvac_ac_startup_shards",
        sa.Column("batch_id", sa.UUID(), nullable=False),
        sa.Column("month", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "error IS NULL OR length(error) BETWEEN 1 AND 500",
            name=op.f("ck_hvac_ac_startup_shards_error_sized"),
        ),
        sa.CheckConstraint(
            "month ~ '^[0-9]{4}-[0-9]{2}$'",
            name=op.f("ck_hvac_ac_startup_shards_month_shaped"),
        ),
        sa.CheckConstraint(
            f"status IN ({_SHARD_STATUSES})",
            name=op.f("ck_hvac_ac_startup_shards_status_known"),
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["platform.hvac_ac_startup_batches.id"],
            name=op.f("fk_hvac_ac_startup_shards_batch_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hvac_ac_startup_shards")),
        sa.UniqueConstraint(
            "batch_id",
            "month",
            name="uq_hvac_ac_startup_shards_batch_id_month",
        ),
        schema="platform",
    )

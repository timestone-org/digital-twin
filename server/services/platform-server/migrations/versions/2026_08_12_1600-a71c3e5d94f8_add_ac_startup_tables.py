"""加抽取批次表、开机事件表与人工排除表。

三张都是新建表，索引随建表一起下，不需要 CONCURRENTLY。批次状态与事件结果
用 text + CHECK 表达而不是原生 ENUM——加一个取值只改 CHECK，不改列类型。

Revision ID: a71c3e5d94f8
Revises: 8f4a1c9e2b7d
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a71c3e5d94f8"
down_revision: str | None = "8f4a1c9e2b7d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ⚠ 与 apps/hvac/startups.py 同口径。那边加取值时，这里要跟一条新迁移改 CHECK
# ——两边分叉的表现是写入被数据库拒绝而代码看起来完全正确。
_BATCH_STATUSES = "'failed', 'ready', 'running'"
_OUTCOMES = "'data_gap', 'set_changed', 'timeout', 'usable'"
_OUTCOME_USABLE = "usable"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_batches()
    _create_episodes()
    _create_exclusions()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("hvac_ac_startup_exclusions", schema="platform")
    op.drop_table("hvac_ac_startup_episodes", schema="platform")
    op.drop_table("hvac_ac_startup_batches", schema="platform")


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


def _counter(name: str) -> sa.Column[int]:
    """一列从 0 起的计数。

    Args: name。
    """
    return sa.Column(
        name, sa.Integer(), server_default=sa.text("0"), nullable=False
    )


def _create_batches() -> None:
    op.create_table(
        "hvac_ac_startup_batches",
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("params_fingerprint", sa.Text(), nullable=False),
        sa.Column("logic_version", sa.Integer(), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "is_current",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        _counter("shard_total"),
        _counter("shard_done"),
        _counter("episode_count"),
        sa.Column("id", sa.UUID(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "episode_count >= 0",
            name=op.f("ck_hvac_ac_startup_batches_episode_count_nonnegative"),
        ),
        sa.CheckConstraint(
            "shard_total >= 0 AND shard_done BETWEEN 0 AND shard_total",
            name=op.f("ck_hvac_ac_startup_batches_shards_within_total"),
        ),
        sa.CheckConstraint(
            f"status IN ({_BATCH_STATUSES})",
            name=op.f("ck_hvac_ac_startup_batches_status_known"),
        ),
        sa.CheckConstraint(
            "window_start < window_end",
            name=op.f("ck_hvac_ac_startup_batches_window_ordered"),
        ),
        sa.ForeignKeyConstraint(
            ["room_id"],
            ["platform.hvac_rooms.id"],
            name=op.f("fk_hvac_ac_startup_batches_room_id"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hvac_ac_startup_batches")),
        schema="platform",
    )
    op.create_index(
        "ix_hvac_ac_startup_batches_room_id",
        "hvac_ac_startup_batches",
        ["room_id"],
        unique=False,
        schema="platform",
    )
    # ⚠ 部分唯一索引，不是普通唯一约束：一个房间只能有一个 is_current，而历史
    # 批次要能同时存在。约束写不出 WHERE，只能用索引表达。
    op.create_index(
        "uq_hvac_ac_startup_batches_room_id_current",
        "hvac_ac_startup_batches",
        ["room_id"],
        unique=True,
        schema="platform",
        postgresql_where=sa.text("is_current"),
    )


def _create_episodes() -> None:
    op.create_table(
        "hvac_ac_startup_episodes",
        sa.Column("batch_id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("running_set", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("complied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column(
            "readings",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("id", sa.UUID(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            f"(outcome = '{_OUTCOME_USABLE}') = (complied_at IS NOT NULL)",
            name=op.f("ck_hvac_ac_startup_episodes_compliance_matches_outcome"),
        ),
        sa.CheckConstraint(
            "(complied_at IS NULL) = (duration_minutes IS NULL)",
            name=op.f(
                "ck_hvac_ac_startup_episodes_duration_matches_compliance"
            ),
        ),
        sa.CheckConstraint(
            "duration_minutes IS NULL OR duration_minutes >= 0",
            name=op.f("ck_hvac_ac_startup_episodes_duration_nonnegative"),
        ),
        sa.CheckConstraint(
            f"outcome IN ({_OUTCOMES})",
            name=op.f("ck_hvac_ac_startup_episodes_outcome_known"),
        ),
        sa.CheckConstraint(
            "cardinality(running_set) > 0",
            name=op.f("ck_hvac_ac_startup_episodes_running_set_nonempty"),
        ),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["platform.hvac_ac_startup_batches.id"],
            name=op.f("fk_hvac_ac_startup_episodes_batch_id"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["room_id"],
            ["platform.hvac_rooms.id"],
            name=op.f("fk_hvac_ac_startup_episodes_room_id"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hvac_ac_startup_episodes")),
        sa.UniqueConstraint(
            "batch_id",
            "started_at",
            name="uq_hvac_ac_startup_episodes_batch_id_started_at",
        ),
        schema="platform",
    )
    op.create_index(
        "ix_hvac_ac_startup_episodes_room_id",
        "hvac_ac_startup_episodes",
        ["room_id"],
        unique=False,
        schema="platform",
    )


def _create_exclusions() -> None:
    op.create_table(
        "hvac_ac_startup_exclusions",
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("excluded_by", sa.Text(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "length(excluded_by) BETWEEN 1 AND 128",
            name=op.f("ck_hvac_ac_startup_exclusions_excluded_by_sized"),
        ),
        sa.CheckConstraint(
            "length(reason) BETWEEN 1 AND 500",
            name=op.f("ck_hvac_ac_startup_exclusions_reason_sized"),
        ),
        sa.ForeignKeyConstraint(
            ["room_id"],
            ["platform.hvac_rooms.id"],
            name=op.f("fk_hvac_ac_startup_exclusions_room_id"),
        ),
        sa.PrimaryKeyConstraint(
            "id", name=op.f("pk_hvac_ac_startup_exclusions")
        ),
        sa.UniqueConstraint(
            "room_id",
            "started_at",
            name="uq_hvac_ac_startup_exclusions_room_id_started_at",
        ),
        schema="platform",
    )

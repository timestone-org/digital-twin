"""加采集配置面的两张表（docs/COLLECT_DESIGN.md §5.1）。

两张都是新建表，索引随建表一起下，不需要 CONCURRENTLY。protocol / read_mode /
data_type 用 text + CHECK 不用原生 ENUM。归档宽表不在这里——它归 collect schema，
由 collector-server 的迁移建（一个服务只操作自己的 schema）。

Revision ID: b7d419e2c85a
Revises: f1a72c3b95d4
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b7d419e2c85a"
down_revision: str | None = "f1a72c3b95d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ⚠ 与 apps/collect/protocols.py 同口径。那边加取值时，这里要跟一条新迁移改
# CHECK——两边分叉的表现是写入被数据库拒绝而代码看起来完全正确。
_PROTOCOLS = "'opcua'"
_READ_MODES = "'poll', 'subscribe'"
_DATA_TYPES = "'bool', 'float', 'int', 'string'"
# 与 models/source.py 的 MIN_INTERVAL_MS 同值
_MIN_INTERVAL_MS = 50
_EMPTY_JSON = sa.text("'{}'::jsonb")


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_sources()
    _create_points()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("collect_points", schema="platform")
    op.drop_table("collect_sources", schema="platform")


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


def _create_sources() -> None:
    op.create_table(
        "collect_sources",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("protocol", sa.Text(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        # ⚠ 密文列：明文口令不进这张表，也不进任何出参与日志
        sa.Column("credential_enc", sa.Text(), nullable=True),
        sa.Column(
            "options_json",
            postgresql.JSONB(),
            server_default=_EMPTY_JSON,
            nullable=False,
        ),
        sa.Column("read_mode", sa.Text(), nullable=False),
        sa.Column(
            "poll_interval_ms",
            sa.Integer(),
            server_default=sa.text("1000"),
            nullable=False,
        ),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_collect_sources"),
        sa.UniqueConstraint("code", name="uq_collect_sources_code"),
        sa.CheckConstraint(
            f"protocol IN ({_PROTOCOLS})",
            name="ck_collect_sources_protocol_known",
        ),
        sa.CheckConstraint(
            f"read_mode IN ({_READ_MODES})",
            name="ck_collect_sources_read_mode_known",
        ),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_collect_sources_name_nonempty"
        ),
        sa.CheckConstraint(
            "length(endpoint) > 0", name="ck_collect_sources_endpoint_nonempty"
        ),
        sa.CheckConstraint(
            "length(code) BETWEEN 1 AND 64",
            name="ck_collect_sources_code_sized",
        ),
        sa.CheckConstraint(
            f"poll_interval_ms >= {_MIN_INTERVAL_MS}",
            name="ck_collect_sources_poll_interval_sane",
        ),
        schema="platform",
    )


def _create_points() -> None:
    op.create_table(
        "collect_points",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source_id", sa.UUID(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("data_type", sa.Text(), nullable=False),
        sa.Column("unit", sa.Text(), nullable=True),
        sa.Column(
            "sampling_interval_ms",
            sa.Integer(),
            server_default=sa.text("1000"),
            nullable=False,
        ),
        sa.Column(
            "deadband",
            sa.Float(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "archive_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "archive_max_interval_ms",
            sa.Integer(),
            server_default=sa.text("60000"),
            nullable=False,
        ),
        sa.Column("archive_retention_days", sa.Integer(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_collect_points"),
        sa.ForeignKeyConstraint(
            ["source_id"],
            ["platform.collect_sources.id"],
            name="fk_collect_points_source_id",
            ondelete="CASCADE",
        ),
        # `(source_id, code)` 拼出全系统的 node_key，撞了就是两条曲线共用身份
        sa.UniqueConstraint(
            "source_id", "code", name="uq_collect_points_source_id_code"
        ),
        sa.CheckConstraint(
            f"data_type IN ({_DATA_TYPES})",
            name="ck_collect_points_data_type_known",
        ),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_collect_points_name_nonempty"
        ),
        sa.CheckConstraint(
            "length(address) > 0", name="ck_collect_points_address_nonempty"
        ),
        sa.CheckConstraint(
            "length(code) BETWEEN 1 AND 64", name="ck_collect_points_code_sized"
        ),
        sa.CheckConstraint(
            f"sampling_interval_ms >= {_MIN_INTERVAL_MS}",
            name="ck_collect_points_sampling_interval_sane",
        ),
        sa.CheckConstraint(
            "deadband >= 0", name="ck_collect_points_deadband_nonnegative"
        ),
        sa.CheckConstraint(
            "archive_max_interval_ms > 0",
            name="ck_collect_points_archive_interval_positive",
        ),
        sa.CheckConstraint(
            "archive_retention_days IS NULL OR archive_retention_days > 0",
            name="ck_collect_points_retention_positive",
        ),
        schema="platform",
    )
    op.create_index(
        "ix_collect_points_source_id",
        "collect_points",
        ["source_id"],
        schema="platform",
    )

"""加数据源绑定表与达标范围表。

两张都是新建表，索引随建表一起下，不需要 CONCURRENTLY。数据集与指标的取值用
varchar + CHECK 表达而不是原生 ENUM——加一个取值只改 CHECK，不改列类型。

Revision ID: 8f4a1c9e2b7d
Revises: c3d81f60a4b2
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "8f4a1c9e2b7d"
down_revision: str | None = "c3d81f60a4b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ⚠ 与 apps/hvac/datasets.py 同口径。那边加数据集或可配指标时，这里要跟一条
# 新迁移改 CHECK——两边分叉的表现是写入被数据库拒绝而代码看起来完全正确。
_DATASETS = "'raw_minute'"
_LIMITABLE_METRICS = "'workshop_humidity_avg', 'workshop_temp_avg'"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_data_bindings()
    _create_metric_limits()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("hvac_ac_metric_limits", schema="platform")
    op.drop_table("hvac_ac_data_bindings", schema="platform")


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


def _create_data_bindings() -> None:
    op.create_table(
        "hvac_ac_data_bindings",
        sa.Column("ac_unit_id", sa.UUID(), nullable=False),
        sa.Column("dataset", sa.Text(), nullable=False),
        sa.Column("source_object", sa.Text(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            f"dataset IN ({_DATASETS})",
            name=op.f("ck_hvac_ac_data_bindings_dataset_known"),
        ),
        sa.CheckConstraint(
            "length(source_object) BETWEEN 1 AND 128",
            name=op.f("ck_hvac_ac_data_bindings_source_object_sized"),
        ),
        sa.ForeignKeyConstraint(
            ["ac_unit_id"],
            ["platform.hvac_ac_units.id"],
            name=op.f("fk_hvac_ac_data_bindings_ac_unit_id"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hvac_ac_data_bindings")),
        sa.UniqueConstraint(
            "ac_unit_id",
            "dataset",
            name="uq_hvac_ac_data_bindings_ac_unit_id_dataset",
        ),
        schema="platform",
    )
    op.create_index(
        "ix_hvac_ac_data_bindings_ac_unit_id",
        "hvac_ac_data_bindings",
        ["ac_unit_id"],
        unique=False,
        schema="platform",
    )


def _create_metric_limits() -> None:
    op.create_table(
        "hvac_ac_metric_limits",
        sa.Column("ac_unit_id", sa.UUID(), nullable=False),
        sa.Column("metric", sa.Text(), nullable=False),
        sa.Column(
            "lower_limit", sa.Numeric(precision=8, scale=2), nullable=True
        ),
        sa.Column(
            "upper_limit", sa.Numeric(precision=8, scale=2), nullable=True
        ),
        sa.Column("id", sa.UUID(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "lower_limit IS NOT NULL OR upper_limit IS NOT NULL",
            name=op.f("ck_hvac_ac_metric_limits_bounds_not_both_null"),
        ),
        sa.CheckConstraint(
            "lower_limit IS NULL OR upper_limit IS NULL "
            "OR lower_limit <= upper_limit",
            name=op.f("ck_hvac_ac_metric_limits_bounds_ordered"),
        ),
        sa.CheckConstraint(
            f"metric IN ({_LIMITABLE_METRICS})",
            name=op.f("ck_hvac_ac_metric_limits_metric_known"),
        ),
        sa.ForeignKeyConstraint(
            ["ac_unit_id"],
            ["platform.hvac_ac_units.id"],
            name=op.f("fk_hvac_ac_metric_limits_ac_unit_id"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hvac_ac_metric_limits")),
        sa.UniqueConstraint(
            "ac_unit_id",
            "metric",
            name="uq_hvac_ac_metric_limits_ac_unit_id_metric",
        ),
        schema="platform",
    )
    op.create_index(
        "ix_hvac_ac_metric_limits_ac_unit_id",
        "hvac_ac_metric_limits",
        ["ac_unit_id"],
        unique=False,
        schema="platform",
    )

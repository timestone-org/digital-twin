"""加预测下发的发布配置表与组合时间点位表（docs/AC_PUBLISH_DESIGN.md §3）。

两张都是新建表，索引随建表一起下，不需要 CONCURRENTLY。状态用 text + CHECK
不用原生 ENUM。

⚠ `opcua_instance_id` / `recommendation_node_id` / `node_id` 指向 opcua-server
自己库里的行，**没有也不能有外键**：跨 schema 禁外键（ADR-0003）。

⚠ 组合表冗余一列 `opcua_instance_id` 并用**复合外键**指回发布配置：唯一约束
「一个点位只能有一个来源」跨了两张表，光靠发布配置上那一列建不出索引；而两张
表说的必须是同一台实例，这一点不能靠应用记得同步。

Revision ID: d9f6218c47b3
Revises: c8e5301fa9d7
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision: str = "d9f6218c47b3"
down_revision: str | None = "c8e5301fa9d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ⚠ 与 apps/hvac/publications.py 同口径。那边加取值时，这里要跟一条新迁移改
# CHECK——两边分叉的表现是写入被数据库拒绝而代码看起来完全正确。
_STATUSES = "'degraded', 'failed', 'ok'"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_publications()
    _create_set_bindings()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("hvac_ac_model_set_bindings", schema="platform")
    op.drop_table("hvac_ac_model_publications", schema="platform")


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


def _create_publications() -> None:
    op.create_table(
        "hvac_ac_model_publications",
        sa.Column("model_id", sa.UUID(), nullable=False),
        sa.Column("opcua_instance_id", sa.UUID(), nullable=False),
        sa.Column("recommendation_node_id", sa.UUID(), nullable=True),
        sa.Column("recommendation_identifier", sa.Text(), nullable=True),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "last_published_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column("last_status", sa.Text(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint(
            "model_id", name="pk_hvac_ac_model_publications"
        ),
        sa.ForeignKeyConstraint(
            ["model_id"],
            ["platform.hvac_ac_models.id"],
            ondelete="CASCADE",
            name="fk_hvac_ac_model_publications_model_id",
        ),
        sa.UniqueConstraint(
            "model_id",
            "opcua_instance_id",
            name="uq_hvac_ac_model_publications_model_instance",
        ),
        sa.UniqueConstraint(
            "opcua_instance_id",
            "recommendation_node_id",
            name="uq_hvac_ac_model_publications_recommendation_node",
        ),
        sa.CheckConstraint(
            f"last_status IS NULL OR last_status IN ({_STATUSES})",
            name="ck_hvac_ac_model_publications_last_status_known",
        ),
        sa.CheckConstraint(
            "last_status <> 'failed' OR last_error IS NOT NULL",
            name="ck_hvac_ac_model_publications_failed_has_error",
        ),
        sa.CheckConstraint(
            "(recommendation_node_id IS NULL) = "
            "(recommendation_identifier IS NULL)",
            name="ck_hvac_ac_model_publications_recommendation_pair",
        ),
        schema="platform",
    )


def _create_set_bindings() -> None:
    op.create_table(
        "hvac_ac_model_set_bindings",
        sa.Column("model_id", sa.UUID(), nullable=False),
        sa.Column("opcua_instance_id", sa.UUID(), nullable=False),
        sa.Column("set_key", sa.Text(), nullable=False),
        sa.Column("node_id", sa.UUID(), nullable=False),
        sa.Column("identifier", sa.Text(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_hvac_ac_model_set_bindings"),
        sa.ForeignKeyConstraint(
            ["model_id", "opcua_instance_id"],
            [
                "platform.hvac_ac_model_publications.model_id",
                "platform.hvac_ac_model_publications.opcua_instance_id",
            ],
            ondelete="CASCADE",
            name="fk_hvac_ac_model_set_bindings_publication",
        ),
        sa.UniqueConstraint(
            "model_id",
            "set_key",
            name="uq_hvac_ac_model_set_bindings_model_set",
        ),
        sa.UniqueConstraint(
            "opcua_instance_id",
            "node_id",
            name="uq_hvac_ac_model_set_bindings_node",
        ),
        schema="platform",
    )

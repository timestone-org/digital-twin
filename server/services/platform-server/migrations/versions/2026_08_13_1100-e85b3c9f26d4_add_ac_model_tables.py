"""加模型表、模型工件表与折外预测表（docs/AC_MODEL_DESIGN.md §3）。

三张都是新建表，索引随建表一起下，不需要 CONCURRENTLY。状态用 text + CHECK
不用原生 ENUM。工件单独一张表：列表页查模型不该把几百 KB 的字节拖出来。

Revision ID: e85b3c9f26d4
Revises: d74a2b8e15c3
"""

from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e85b3c9f26d4"
down_revision: str | None = "d74a2b8e15c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# ⚠ 与 apps/hvac/model_statuses.py 同口径。那边加取值时，这里要跟一条新迁移
# 改 CHECK——两边分叉的表现是写入被数据库拒绝而代码看起来完全正确。
_STATUSES = "'failed', 'queued', 'ready', 'training'"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_models()
    _create_artifacts()
    _create_predictions()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("hvac_ac_model_predictions", schema="platform")
    op.drop_table("hvac_ac_model_artifacts", schema="platform")
    op.drop_table("hvac_ac_models", schema="platform")


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


def _create_models() -> None:
    op.create_table(
        "hvac_ac_models",
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("serving_sets", postgresql.JSONB(), nullable=False),
        sa.Column("half_life_days", sa.Float(), nullable=False),
        sa.Column(
            "status",
            sa.Text(),
            server_default=sa.text("'queued'"),
            nullable=False,
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("feature_version", sa.Integer(), nullable=True),
        sa.Column("trained_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("batch_fingerprint", sa.Text(), nullable=True),
        sa.Column("batch_logic_version", sa.Integer(), nullable=True),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sample_count", sa.Integer(), nullable=True),
        sa.Column("metrics", postgresql.JSONB(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_hvac_ac_models"),
        sa.ForeignKeyConstraint(
            ["room_id"],
            ["platform.hvac_rooms.id"],
            name="fk_hvac_ac_models_room_id",
        ),
        sa.UniqueConstraint(
            "room_id", "name", name="uq_hvac_ac_models_room_id_name"
        ),
        sa.CheckConstraint(
            f"status IN ({_STATUSES})",
            name="ck_hvac_ac_models_status_known",
        ),
        sa.CheckConstraint(
            "half_life_days > 0",
            name="ck_hvac_ac_models_half_life_positive",
        ),
        sa.CheckConstraint(
            "status <> 'failed' OR error IS NOT NULL",
            name="ck_hvac_ac_models_failed_has_error",
        ),
        sa.CheckConstraint(
            "status <> 'ready' OR "
            "(trained_at IS NOT NULL AND metrics IS NOT NULL)",
            name="ck_hvac_ac_models_ready_is_trained",
        ),
        sa.CheckConstraint(
            "sample_count IS NULL OR sample_count >= 0",
            name="ck_hvac_ac_models_sample_count_nonnegative",
        ),
        schema="platform",
    )
    op.create_index(
        "ix_hvac_ac_models_status",
        "hvac_ac_models",
        ["status"],
        schema="platform",
    )


def _create_artifacts() -> None:
    op.create_table(
        "hvac_ac_model_artifacts",
        sa.Column("model_id", sa.UUID(), nullable=False),
        sa.Column("payload", sa.LargeBinary(), nullable=False),
        sa.Column("digest", sa.Text(), nullable=False),
        sa.Column("format_version", sa.Integer(), nullable=False),
        sa.Column("sklearn_version", sa.Text(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("model_id", name="pk_hvac_ac_model_artifacts"),
        sa.ForeignKeyConstraint(
            ["model_id"],
            ["platform.hvac_ac_models.id"],
            name="fk_hvac_ac_model_artifacts_model_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "length(digest) = 64",
            name="ck_hvac_ac_model_artifacts_digest_sized",
        ),
        sa.CheckConstraint(
            "format_version >= 1",
            name="ck_hvac_ac_model_artifacts_format_version_positive",
        ),
        schema="platform",
    )


def _create_predictions() -> None:
    op.create_table(
        "hvac_ac_model_predictions",
        sa.Column("model_id", sa.UUID(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("running_set", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("actual_minutes", sa.Integer(), nullable=False),
        sa.Column("p10", sa.Float(), nullable=False),
        sa.Column("p50", sa.Float(), nullable=False),
        sa.Column("p90", sa.Float(), nullable=False),
        sa.Column("fold", sa.Integer(), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_hvac_ac_model_predictions"),
        sa.ForeignKeyConstraint(
            ["model_id"],
            ["platform.hvac_ac_models.id"],
            name="fk_hvac_ac_model_predictions_model_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "model_id",
            "started_at",
            name="uq_hvac_ac_model_predictions_model_id_started_at",
        ),
        sa.CheckConstraint(
            "p10 >= 0 AND p10 <= p50 AND p50 <= p90",
            name="ck_hvac_ac_model_predictions_quantiles_ordered",
        ),
        sa.CheckConstraint(
            "actual_minutes >= 0",
            name="ck_hvac_ac_model_predictions_actual_nonnegative",
        ),
        sa.CheckConstraint(
            "fold >= 0",
            name="ck_hvac_ac_model_predictions_fold_nonnegative",
        ),
        schema="platform",
    )

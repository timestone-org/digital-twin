"""模型压缩档表：一个模型素材一档一行，记它压到哪一步了。

纯新增一张表，索引与唯一约束随建表一起下，故不需要 CONCURRENTLY，也没有回填。
存量素材这次不补 `pending` 行——补了等于把整库模型排进压缩队列，而那是一次
计划外的、可能跑几个小时的重活。存量走界面上的「重压」按需触发。

Revision ID: e1b7d4a9c206
Revises: a4c8e2f61b09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e1b7d4a9c206"
down_revision: str | None = "a4c8e2f61b09"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
# 与 apps/assets/variants.py 的 MODEL_VARIANTS 同口径：两边分叉的表现是写入被
# 数据库拒绝，而代码看起来完全正确
_VARIANTS = ("original", "high", "medium", "low")
_STATUSES = ("pending", "ready", "failed")
_KNOWN_VARIANTS = ", ".join(f"'{name}'" for name in _VARIANTS)
_KNOWN_STATUSES = ", ".join(f"'{name}'" for name in _STATUSES)


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        "asset_model_variants",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("asset_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("variant", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("checksum", sa.Text(), nullable=True),
        sa.Column(
            "error", sa.Text(), nullable=False, server_default=sa.text("''")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            f"variant IN ({_KNOWN_VARIANTS})",
            name="asset_model_variants_variant_known",
        ),
        sa.CheckConstraint(
            f"status IN ({_KNOWN_STATUSES})",
            name="asset_model_variants_status_known",
        ),
        sa.CheckConstraint(
            "size_bytes IS NULL OR size_bytes > 0",
            name="asset_model_variants_size_positive",
        ),
        # 队列是 at-least-once，靠这一对让重复投递写不出第二行
        sa.UniqueConstraint(
            "asset_id",
            "variant",
            name="uq_asset_model_variants_asset_variant",
        ),
        schema=_SCHEMA,
    )
    # 详情面按素材取它名下的全部档
    op.create_index(
        "ix_asset_model_variants_asset",
        "asset_model_variants",
        ["asset_id"],
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_index(
        "ix_asset_model_variants_asset",
        "asset_model_variants",
        schema=_SCHEMA,
    )
    op.drop_table("asset_model_variants", schema=_SCHEMA)

"""素材表：一个上传件一行，字节在对象存储里。

纯新增一张表，索引随建表一起下，故不需要 CONCURRENTLY，也没有回填。
类型用 text + CHECK 而不是原生 ENUM（database-standard §2）：加一类素材只改
约束，而改 ENUM 要走两次发布。

Revision ID: d9f6412ab73c
Revises: c8e5301fa9d7
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d9f6412ab73c"
down_revision: str | None = "c8e5301fa9d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
# 与 apps/assets/kinds.py 的 ASSET_KINDS 同口径：两边分叉的表现是写入被数据库
# 拒绝，而代码看起来完全正确
_KINDS = ("model", "image", "icon")
_KNOWN_KINDS = ", ".join(f"'{kind}'" for kind in _KINDS)


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        "assets",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("checksum", sa.Text(), nullable=False),
        sa.Column(
            "created_by",
            sa.Text(),
            nullable=False,
            server_default=sa.text("''"),
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
            f"kind IN ({_KNOWN_KINDS})", name="assets_kind_known"
        ),
        sa.CheckConstraint("length(name) > 0", name="assets_name_nonempty"),
        sa.CheckConstraint("size_bytes > 0", name="assets_size_positive"),
        schema=_SCHEMA,
    )
    # 素材库按类型分页浏览，列表页恒带 kind 过滤
    op.create_index(
        "ix_assets_kind_created_at",
        "assets",
        ["kind", "created_at"],
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_index("ix_assets_kind_created_at", "assets", schema=_SCHEMA)
    op.drop_table("assets", schema=_SCHEMA)

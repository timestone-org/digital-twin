"""删卡片样式表。样式库整个撤掉，复用一整套观感改走右键复制 / 粘贴
（docs/MODULE_DATA_CARD_DESIGN.md §8.1）。

**扩展—收缩的收缩步**：建表那份（`d1a75c9e34b2`）已经进过 main，读写它的代码在
本次发布的前一步就已摘干净，故这一步落地时没有任何代码还认识这张表。
反过来说，这份迁移**必须在代码发布之后才跑**——先删表再发代码的话，中间那段
时间旧代码会对着不存在的表报 500。

⚠ 删表就删掉了全部用户样式，**不可回滚回数据**：`downgrade` 只把空表建回来。
已经套过样式的节点不受影响——套用那一刻取值就落进节点的配置里了，
样式本身只是个可复用的起点。

Revision ID: e2b86d0f45c3
Revises: d1a75c9e34b2
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e2b86d0f45c3"
down_revision: str | None = "d1a75c9e34b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_TABLE = "card_styles"

# ⚠ 与建表那份一样是**写死的字面量**，不许改成 import 模型：迁移是冻结件，
# 而模型是活的
_EMPTY_JSON = "'{}'::jsonb"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_index("ix_card_styles_module_type", _TABLE, schema=_SCHEMA)
    op.drop_table(_TABLE, schema=_SCHEMA)


def downgrade() -> None:
    """把表建回来，逐字照 `d1a75c9e34b2` 的建表段。

    ⚠ 只回结构不回数据：行已经随 `upgrade` 一起没了。
    """
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        _TABLE,
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        # 空 = 通用外壳样式，套到任何模块上都只写外壳
        sa.Column("module_type", sa.Text(), nullable=True),
        sa.Column(
            "chrome_json",
            postgresql.JSONB(),
            server_default=sa.text(_EMPTY_JSON),
            nullable=False,
        ),
        sa.Column(
            "config_json",
            postgresql.JSONB(),
            server_default=sa.text(_EMPTY_JSON),
            nullable=False,
        ),
        sa.Column("thumbnail", sa.Text(), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name="pk_card_styles"),
        *_checks(),
        schema=_SCHEMA,
    )
    op.create_index(
        "ix_card_styles_module_type",
        _TABLE,
        ["module_type"],
        schema=_SCHEMA,
    )


def _checks() -> tuple[sa.CheckConstraint, ...]:
    """全部 CHECK。装成一组只为让建表那段不超过函数行数上限。"""
    return (
        sa.CheckConstraint(
            "length(name) > 0", name="ck_card_styles_name_nonempty"
        ),
        sa.CheckConstraint(
            "module_type IS NULL OR length(module_type) > 0",
            name="ck_card_styles_module_type_nonempty",
        ),
        sa.CheckConstraint(
            f"module_type IS NOT NULL OR config_json = {_EMPTY_JSON}",
            name="ck_card_styles_generic_style_carries_no_config",
        ),
    )

"""建卡片样式表（docs/CARD_STYLE_LIBRARY_DESIGN.md §5.1）。

一张普通表，全站共享的观感资产，几十到几百行量级。纯扩展步：只建表、不回填，
旧代码配新库照样跑（它只是不认识这张表），故「新结构 + 旧代码」成立。

⚠ `module_type` **不建外键**：模块表的真源是前端构建期产物 `module_types.json`，
库里没有可指的表，未注册的类型由服务层按目录校验。也**不建原生 ENUM**——
数据库规范的硬条。
⚠ 不建 `(module_type, name)` 唯一键：重名是用户自己的事，唯一键会让「另存为」
在撞名时抛 409，而那一刻他要的正是「再存一条」。

Revision ID: d1a75c9e34b2
Revises: b8c34e19d70f
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d1a75c9e34b2"
down_revision: str | None = "b8c34e19d70f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_TABLE = "card_styles"

# ⚠ 下面这条是**写死的字面量**，不许改成 import `apps/dashboard/models`：
# 迁移是冻结件，而模型是活的——将来放宽一处约束，同一个 revision 会在旧库建出
# 旧约束、在新建库建出新约束，且没有任何东西会报错。
_EMPTY_JSON = "'{}'::jsonb"


def upgrade() -> None:
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
    # 样式墙按模块类型分组，编辑器的下拉也只拉本类型那一组
    op.create_index(
        "ix_card_styles_module_type",
        _TABLE,
        ["module_type"],
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # ⚠ 删掉这张表就删掉了全部用户样式。已经套过它们的节点不受影响——套用
    # 那一刻取值就落进节点的配置里了，样式本身只是个可复用的起点
    op.drop_index("ix_card_styles_module_type", _TABLE, schema=_SCHEMA)
    op.drop_table(_TABLE, schema=_SCHEMA)


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
        # ⚠ 这一条在**库里**守，不只在服务层：内芯键是逐模块的，库里躺着一条
        # 带内芯的通用样式，套用时那半袋静默不生效，是查起来最费劲的那种
        sa.CheckConstraint(
            f"module_type IS NOT NULL OR config_json = {_EMPTY_JSON}",
            name="ck_card_styles_generic_style_carries_no_config",
        ),
    )

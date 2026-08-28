"""chat_sessions 的 surface_kind 闭合集合加一档：twin2d-editor。

纯扩展步：换成更宽的那条 CHECK，无回填。「新结构 + 旧代码」照常可用——
旧代码只是永远不写这一档。

Revision ID: e5f2a3b41c78
Revises: d4a1c7b2e903
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5f2a3b41c78"
down_revision: str | None = "d4a1c7b2e903"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"
TABLE = "chat_sessions"
CONSTRAINT = "ck_chat_sessions_surface_kind_known"

NARROW = (
    "'dashboard-editor', 'twin-editor', 'dataset-table', "
    "'collect-source', 'dashboard-view'"
)
WIDE = (
    "'dashboard-editor', 'twin-editor', 'twin2d-editor', 'dataset-table', "
    "'collect-source', 'dashboard-view'"
)


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _swap(WIDE)


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # ⚠ 已经落在 twin2d-editor 上的会话行会让 VALIDATE 直接失败。不悄悄删掉
    # 它们是有意的：回退结构可以，丢用户的会话不行——先把那些行处理掉再退
    _swap(NARROW)


def _swap(kinds: str) -> None:
    """换掉那条 CHECK：删旧的、按 NOT VALID 加新的、再单独 VALIDATE。

    ⚠ 一步 ADD CONSTRAINT 会持排他锁全表扫；NOT VALID 立刻返回，
    VALIDATE 只要 SHARE UPDATE EXCLUSIVE，热表上不挡读写。

    Args: kinds（闭合集合摊成的值列表）。
    """
    _drop_existing()
    op.execute(
        f"ALTER TABLE {SCHEMA}.{TABLE} ADD CONSTRAINT {CONSTRAINT} "
        f"CHECK (surface_kind IN ({kinds})) NOT VALID"
    )
    op.execute(f"ALTER TABLE {SCHEMA}.{TABLE} VALIDATE CONSTRAINT {CONSTRAINT}")


def _drop_existing() -> None:
    """删掉现有那条管 `surface_kind` 的 CHECK，**不管它此刻叫什么名字**。

    ⚠ 同一条约束在不同库里名字不一样，所以按名字硬删只在其中一种库上成立，
    另一种上是 `constraint … does not exist`，整个迁移作业退 1。根因：命名约定是
    `ck_%(table_name)s_%(constraint_name)s`，而建表时传进去的 `name=` 已经自带
    `ck_chat_sessions_` 前缀——约定生效的库里于是成了**双前缀**，没生效的库里是
    单前缀。alembic 的 `op.create_table` 在 `target_metadata` 是**列表**时取不到
    约定（本服务正是两份 metadata），故新建的库是单前缀，而现网那份是双前缀。

    ⚠ 连「试两个名字」都不够：超过 63 字符的名字会被 Postgres 截断并加哈希后缀，
    现网 hvac 那几张表上就有。唯一可靠的做法是按**定义**查出真名再删。
    """
    found = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid = CAST(:table AS regclass) "
                "AND contype = 'c' "
                "AND pg_get_constraintdef(oid) ILIKE :pattern"
            ),
            {"table": f"{SCHEMA}.{TABLE}", "pattern": "%surface_kind%"},
        )
        .scalars()
        .all()
    )
    for name in found:
        op.drop_constraint(str(name), TABLE, type_="check", schema=SCHEMA)

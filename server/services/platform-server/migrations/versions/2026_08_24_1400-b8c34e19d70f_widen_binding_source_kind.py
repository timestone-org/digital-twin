"""把绑定来源的取值集合放宽一档，容下 `dataset`。

只改 CHECK 约束、不动数据，属扩展步：放宽是安全的，旧代码配新库照样跑
（它只是产不出 `dataset` 这个取值），故「新结构 + 旧代码」成立。

Revision ID: b8c34e19d70f
Revises: a3f27b6c05d1
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b8c34e19d70f"
down_revision: str | None = "a3f27b6c05d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "platform"
TABLE = "dashboard_bindings"
CONSTRAINT = "ck_dashboard_bindings_source_kind_known"

# ⚠ 两侧取值都是**写死的字面量**，不许改成 import
# `apps/dashboard/source_kinds.py`：迁移是冻结件，而那是个活常量——将来再加
# 一档，同一个 revision 会在旧库建出旧集合、在新建库建出新集合，且没有任何
# 东西会报错。两侧不许漂由 tests/contract/test_binding_ddl_literals.py 盯着。
OLD_KINDS = "'archive', 'computed', 'opcua', 'static'"
NEW_KINDS = "'archive', 'computed', 'dataset', 'opcua', 'static'"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _replace_check(NEW_KINDS)


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # ⚠ 收窄**会失败**，而且应该失败：库里若已经躺着 `dataset` 的绑定，
    # 重建约束时 PG 会拒绝，此时正确的动作是先把那些绑定改掉或删掉，
    # 而不是让这一步「成功」并留下一批违反约束的行
    _replace_check(OLD_KINDS)


def _replace_check(kinds: str) -> None:
    """按给定的取值集合重建那条 CHECK。

    ⚠ 建的时候要写**全名**：ORM 那套命名约定只作用于声明式模型，手写的
    `op.*` 拿到什么名字就用什么名字。图省事传短名的话，约束会被悄悄改名成
    `source_kind_known`，而模型仍按全名声明——两边从此对不上，表现是
    autogenerate 每次都想把它删了重建。
    Args: kinds（已渲染好的 SQL 字面量列表）。
    """
    op.drop_constraint(CONSTRAINT, TABLE, type_="check", schema=SCHEMA)
    op.create_check_constraint(
        CONSTRAINT, TABLE, f"source_kind IN ({kinds})", schema=SCHEMA
    )

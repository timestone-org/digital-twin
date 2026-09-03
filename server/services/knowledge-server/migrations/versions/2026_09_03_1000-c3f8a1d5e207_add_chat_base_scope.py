"""会话表加一列检索范围（ADR-0044）。

纯扩展步：加一列**可空**、不回填。旧代码不认识这一列，读到的行为与改造前
一致——`NULL` 就是「全部知识库」。

⚠ `NULL` 与空数组是两件事，由 CHECK 分开：`NULL` = 不限库，空数组 = 一个都
没选。分不开的表现是「用户清空了选择，于是检索悄悄扩到了全部库」，而那正是他
明确要排除掉的那些库。约束先 `NOT VALID` 再 `VALIDATE`：直接加会持有 ACCESS
EXCLUSIVE 锁把全表扫一遍。

⚠ 这一列**不建外键**指向 `kb_bases`：它记的是用户当时划的边界，不是一条活
引用。级联删会把选过的库悄悄抹掉（范围于是被动变宽），而 RESTRICT 会让删库
失败——两种都不对。库被删之后如实标成「已不存在」，由读侧回答。

⚠ 不建索引：没有任何一条查询按范围筛会话，索引在这里只是一份写放大。

Revision ID: c3f8a1d5e207
Revises: b7d2e9f04a15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3f8a1d5e207"
down_revision: str | None = "b7d2e9f04a15"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "knowledge"
TABLE = "kb_chat_sessions"
COLUMN = "base_scope_ids"
CONSTRAINT = "ck_kb_chat_sessions_scope_not_empty"


def upgrade() -> None:
    """加一列范围，并钉住「空数组不是合法取值」。"""
    op.execute("SET lock_timeout = '5s'")
    op.add_column(
        TABLE,
        # 可空是关键：存量行天然是 NULL，也就是「全部知识库」
        sa.Column(
            COLUMN,
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=True,
        ),
        schema=SCHEMA,
    )
    op.execute(
        f"ALTER TABLE {SCHEMA}.{TABLE} ADD CONSTRAINT {CONSTRAINT} "
        f"CHECK ({COLUMN} IS NULL OR array_length({COLUMN}, 1) >= 1) NOT VALID"
    )
    op.execute(f"ALTER TABLE {SCHEMA}.{TABLE} VALIDATE CONSTRAINT {CONSTRAINT}")


def downgrade() -> None:
    """删约束与列。范围只存在这一列上，删了就是回到「永远全部」。"""
    op.execute("SET lock_timeout = '5s'")
    op.execute(
        f"ALTER TABLE {SCHEMA}.{TABLE} DROP CONSTRAINT IF EXISTS {CONSTRAINT}"
    )
    op.drop_column(TABLE, COLUMN, schema=SCHEMA)

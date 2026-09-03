"""节点记录加两列：这一步学到的参数，与它实际看到 / 产出的列
（docs/MODELING_PLATFORM_DESIGN.md D1 / D3）。

纯扩展步：两列都可空、都没有默认值、没有回填。旧代码不读也不写这两列，
故「新结构 + 旧代码」可用。

⚠ 这一步之前的历史运行两列全是 NULL，与今天的行为一致（今天就是没有）。
发布侧读不到时给一句「这次运行早于本次升级，请重跑一遍再发布」，
**不许**退回旧的「从摘要里捞 fitted」那条路——那条路一直捞的是空。

Revision ID: c9a3f61b0d24
Revises: b6f4a20d75e1
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c9a3f61b0d24"
down_revision: str | None = "b6f4a20d75e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_TABLE = "modeling_node_runs"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        _TABLE,
        sa.Column("fitted_json", postgresql.JSONB(), nullable=True),
        schema=_SCHEMA,
    )
    op.add_column(
        _TABLE,
        sa.Column("io_json", postgresql.JSONB(), nullable=True),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    """⚠ 撤回会让已经跑过的运行失去发布能力（发布侧读不到这两列）。
    已经发布出去的模型版本不受影响——它们的可服务表示是自带的。"""
    op.execute("SET lock_timeout = '3s'")
    op.drop_column(_TABLE, "io_json", schema=_SCHEMA)
    op.drop_column(_TABLE, "fitted_json", schema=_SCHEMA)

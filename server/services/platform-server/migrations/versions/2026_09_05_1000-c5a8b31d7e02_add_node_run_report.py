"""节点记录加一列：这一步要在结果面上讲的那些块
（docs/MODELING_RESULT_VIEW_DESIGN.md §4.2）。

纯扩展步：可空、无默认值、无 CHECK、无回填。旧代码不读也不写它，故
「新结构 + 旧代码」可用。

⚠ 独立成列而不是塞进 `preview_json`：帧摘要已经贴着自己的字节天花板，块一进去
就会触发降档，而降档只削行——用户看到的是「明细行数莫名变少」，没有一个字说是
为了腾地方。同一张表上的 `fitted_json` 就是这个先例。

Revision ID: c5a8b31d7e02
Revises: b7e2a4c81d63
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c5a8b31d7e02"
down_revision: str | None = "b7e2a4c81d63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_TABLE = "modeling_node_runs"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    # `{"blocks": [...], "dropped": [...], "note": "…"}`，有硬上限。
    # ⚠ 这一步之前的历史运行全是 NULL，界面上退化成升级前的样子
    op.add_column(
        _TABLE,
        sa.Column("report_json", postgresql.JSONB(), nullable=True),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    """⚠ 撤回只丢结果面上的讲解，不影响发布与推理——那两条路读的是别的列。"""
    op.execute("SET lock_timeout = '3s'")
    op.drop_column(_TABLE, "report_json", schema=_SCHEMA)

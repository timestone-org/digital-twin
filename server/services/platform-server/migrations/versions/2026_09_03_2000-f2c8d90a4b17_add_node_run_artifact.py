"""节点运行上的产物元信息（docs/MODELING_PLATFORM_DESIGN.md D9）。

纯扩展步：一列可空 JSONB，无回填。旧代码不读它，旧行是 NULL。

⚠ 摘要与库版本必须留在**训练那一侧**：发布是在 api 进程里做的，那里的
numpy / sklearn 版本未必与训练用的工进程一致。发布时现算一遍摘要会把 api 的
版本当成训练时的版本记下来，于是跨版本那道拒载闸永远不会响。

Revision ID: f2c8d90a4b17
Revises: e7c2b95a3f81
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f2c8d90a4b17"
down_revision: str | None = "e7c2b95a3f81"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_TABLE = "modeling_node_runs"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.add_column(
        _TABLE,
        sa.Column("artifact_json", postgresql.JSONB(), nullable=True),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_column(_TABLE, "artifact_json", schema=_SCHEMA)

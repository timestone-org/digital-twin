"""运行参数「保留全量产物」与节点上那份 CSV 的元信息
（docs/MODELING_PLATFORM_DESIGN.md D12）。

纯扩展步：一列带默认值的布尔 + 一列可空 JSONB，无回填。旧代码不读它们。

⚠ 默认**关**是刻意的：默认开会让每一次运行都往对象存储写几十 MB，而绝大多数
运行只是在调参数。

Revision ID: b7e2a4c81d63
Revises: a3d5c81f9e42
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b7e2a4c81d63"
down_revision: str | None = "a3d5c81f9e42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_TABLE = "modeling_runs"
_NODE_TABLE = "modeling_node_runs"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.add_column(
        _TABLE,
        sa.Column(
            "is_keeping_frames",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        schema=_SCHEMA,
    )
    # `{端口: {object_key, row_count, size_bytes, is_truncated}}`。
    # ⚠ 只留键与规模，字节在对象存储里——一次取数可以是几十万行
    op.add_column(
        _NODE_TABLE,
        sa.Column("frames_json", postgresql.JSONB(), nullable=True),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_column(_NODE_TABLE, "frames_json", schema=_SCHEMA)
    op.drop_column(_TABLE, "is_keeping_frames", schema=_SCHEMA)

"""chat_sessions 加两列可空：这个会话用哪一路模型、哪一档推理。

纯扩展步：加可空列，无回填。空值 = 按部署配置的默认那一路。

Revision ID: d4a1c7b2e903
Revises: c3d9e21af560
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4a1c7b2e903"
down_revision: str | None = "c3d9e21af560"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"
TABLE = "chat_sessions"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        TABLE,
        sa.Column("model_profile", sa.String(32), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        TABLE,
        sa.Column("reasoning_effort", sa.String(16), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_column(TABLE, "reasoning_effort", schema=SCHEMA)
    op.drop_column(TABLE, "model_profile", schema=SCHEMA)

"""chat_sessions 加一列可空 plan_json：模型的执行计划（ADR-0024）。

纯扩展步：加可空列，无回填。

Revision ID: b2c8d13ea45f
Revises: a1f7c02b9d34
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b2c8d13ea45f"
down_revision: str | None = "a1f7c02b9d34"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        "chat_sessions",
        sa.Column("plan_json", postgresql.JSONB(), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_column("chat_sessions", "plan_json", schema=SCHEMA)

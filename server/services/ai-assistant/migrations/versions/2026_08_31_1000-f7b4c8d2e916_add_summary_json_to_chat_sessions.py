"""chat_sessions 加一列可空 summary_json：窗口外那一截折成的摘要。

纯扩展步：加可空列，无回填。旧代码不认识这一列，也不会去读它。

Revision ID: f7b4c8d2e916
Revises: e5f2a3b41c78
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f7b4c8d2e916"
down_revision: str | None = "e5f2a3b41c78"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        "chat_sessions",
        sa.Column("summary_json", postgresql.JSONB(), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_column("chat_sessions", "summary_json", schema=SCHEMA)

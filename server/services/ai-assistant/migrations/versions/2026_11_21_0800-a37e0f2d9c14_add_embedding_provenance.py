"""为存量记忆追加可空的向量空间及内容校验值。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a37e0f2d9c14"
down_revision: str | None = "d9a3e51c7f20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"
TABLE = "knowledge_chunks"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        TABLE,
        sa.Column("embedding_space_id", sa.Text(), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        TABLE,
        sa.Column("embedding_checksum", sa.Text(), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_column(TABLE, "embedding_checksum", schema=SCHEMA)
    op.drop_column(TABLE, "embedding_space_id", schema=SCHEMA)

"""保留已完成解析、等待管理员重嵌的文档。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "fc27a09c18e3"
down_revision: str | None = "a71fc2d9e036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        "kb_documents",
        sa.Column("embedding_deferred", sa.Boolean(), nullable=True),
        schema="knowledge",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_column("kb_documents", "embedding_deferred", schema="knowledge")

"""为已解绑的知识来源保留可空时间。"""

import sqlalchemy as sa
from alembic import op

revision: str = "b62a1d73f8e0"
down_revision: str | None = "fc27a09c18e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        "kb_sources",
        sa.Column("detached_at", sa.DateTime(timezone=True), nullable=True),
        schema="knowledge",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_column("kb_sources", "detached_at", schema="knowledge")

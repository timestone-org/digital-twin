"""collect_sources 加 description / username 两列（BK 采集面对齐）。

两列都可空、无默认回填，是纯扩展步：旧代码看不见它们也能照常写入。
username 是连接现场设备的账号名，不是敏感值；口令仍只进 credential_enc。

Revision ID: a4c8e2f61b09
Revises: d9f6218c47b3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a4c8e2f61b09"
down_revision: str | None = "d9f6218c47b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        "collect_sources",
        sa.Column("description", sa.Text(), nullable=True),
        schema="platform",
    )
    op.add_column(
        "collect_sources",
        sa.Column("username", sa.Text(), nullable=True),
        schema="platform",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_column("collect_sources", "username", schema="platform")
    op.drop_column("collect_sources", "description", schema="platform")

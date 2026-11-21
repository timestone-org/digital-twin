"""为采集运行态增加可空的上报顺序，兼容已有行。

Revision ID: a5d2316ee740
Revises: 9b7d4e2a61c8
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a5d2316ee740"
down_revision: str | None = "9b7d4e2a61c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "collect_source_states"
SCHEMA = "collect"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        TABLE,
        sa.Column("report_order", sa.BigInteger(), nullable=True),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_column(TABLE, "report_order", schema=SCHEMA)

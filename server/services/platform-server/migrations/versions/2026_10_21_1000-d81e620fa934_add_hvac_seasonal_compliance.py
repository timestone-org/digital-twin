"""空调冬季配置及抽取、训练的配置快照；保留非冬季范围。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d81e620fa934"
down_revision: str | None = "c72f901de583"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        "hvac_ac_units",
        sa.Column("winter_policy", postgresql.JSONB(), nullable=True),
        schema="platform",
    )
    for table in ("hvac_ac_startup_batches", "hvac_ac_models"):
        op.add_column(
            table,
            sa.Column(
                "configuration_snapshot", postgresql.JSONB(), nullable=True
            ),
            schema="platform",
        )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    for table in ("hvac_ac_models", "hvac_ac_startup_batches"):
        op.drop_column(table, "configuration_snapshot", schema="platform")
    op.drop_column("hvac_ac_units", "winter_policy", schema="platform")

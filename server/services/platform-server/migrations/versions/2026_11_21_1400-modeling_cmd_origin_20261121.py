"""保留训练命令的实际入口，不改写历史预约。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "modeling_cmd_origin_20261121"
down_revision: str | None = "hvac_dispatch_20261121"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.add_column(
        "modeling_commands",
        sa.Column("requested_operation", sa.Text(), nullable=True),
        schema="platform",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_column(
        "modeling_commands", "requested_operation", schema="platform"
    )

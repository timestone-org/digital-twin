"""为运行参数覆盖保留已认证账号名及其本次写入时刻。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "runtime_param_actor_20261121"
down_revision: str | None = "collect_audit_events_20261121"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.add_column(
        "runtime_param_overrides",
        sa.Column("updated_by_name", sa.Text(), nullable=True),
        schema="platform",
    )
    op.add_column(
        "runtime_param_overrides",
        sa.Column(
            "updated_by_name_at", sa.DateTime(timezone=True), nullable=True
        ),
        schema="platform",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_column(
        "runtime_param_overrides", "updated_by_name_at", schema="platform"
    )
    op.drop_column(
        "runtime_param_overrides", "updated_by_name", schema="platform"
    )

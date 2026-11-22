"""给账号追加可空的刷新会话代次。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ce1a6ac48d07"
down_revision: str | None = "c41f7ab2d5e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        "auth_users",
        sa.Column("refresh_generation", sa.UUID(), nullable=True),
        schema="auth",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_column("auth_users", "refresh_generation", schema="auth")

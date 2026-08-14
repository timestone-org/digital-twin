"""建 API 密钥表：第三方系统的常驻凭据。

纯新增表，属扩展步——「新结构 + 旧代码」可用，旧代码根本不认识它。

Revision ID: c41f7ab2d5e8
Revises: 86553681eac9
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c41f7ab2d5e8"
down_revision: str | None = "86553681eac9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        "auth_api_keys",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("prefix", sa.Text(), nullable=False),
        sa.Column("hashed_secret", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("issued_by", sa.UUID(), nullable=True),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "length(name) > 0", name=op.f("ck_auth_api_keys_name_nonempty")
        ),
        sa.CheckConstraint(
            "length(prefix) > 0", name=op.f("ck_auth_api_keys_prefix_nonempty")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["auth.auth_users.id"],
            name=op.f("fk_auth_api_keys_user_id"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_api_keys")),
        sa.UniqueConstraint("prefix", name="uq_auth_api_keys_prefix"),
        schema="auth",
    )
    op.create_index(
        "ix_auth_api_keys_user_id",
        "auth_api_keys",
        ["user_id"],
        unique=False,
        schema="auth",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_index(
        "ix_auth_api_keys_user_id",
        table_name="auth_api_keys",
        schema="auth",
    )
    op.drop_table("auth_api_keys", schema="auth")

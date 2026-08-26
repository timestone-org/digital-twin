"""新表 model_credentials：订阅账号那一路的登录态，一路模型一行。

纯扩展步：只建表，不回填。令牌以密文入库（`token_enc`），明文一个字都不落。

Revision ID: c3d9e21af560
Revises: b2c8d13ea45f
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3d9e21af560"
down_revision: str | None = "b2c8d13ea45f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"
TABLE = "model_credentials"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        TABLE,
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("auth_mode", sa.String(32), nullable=False),
        sa.Column("token_enc", sa.Text(), nullable=False),
        sa.Column("account_label", sa.String(128), nullable=True),
        sa.Column("plan_label", sa.String(128), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_refresh_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "row_version", sa.Integer(), nullable=False, server_default="1"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_model_credentials"),
        # ⚠ CHECK 而不是原生 ENUM：加一档要 ALTER TYPE，而那对并发写是排他的
        sa.CheckConstraint(
            "provider IN ('codex')", name="ck_model_credentials_provider_known"
        ),
        sa.CheckConstraint(
            "auth_mode IN ('chatgpt')",
            name="ck_model_credentials_auth_mode_known",
        ),
        sa.CheckConstraint(
            "row_version >= 1", name="ck_model_credentials_row_version_positive"
        ),
        # 一路模型只许有一行：两行的话，读到哪一行取决于排序，
        # 而「换了账号却没生效」是这一类故障里最难查的
        sa.UniqueConstraint("provider", name="uq_model_credentials_provider"),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table(TABLE, schema=SCHEMA)

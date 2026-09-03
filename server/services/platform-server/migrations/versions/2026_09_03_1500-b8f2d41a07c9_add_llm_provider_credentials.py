"""建订阅账号登录态表（ADR-0041）：要登录的那一路供应商一行。

新建表，索引（唯一键）随建表一起下，不需要 CONCURRENTLY，也没有回填。
旧代码不认识这张表、也不会去读，故「新结构 + 旧代码」天然可用。

⚠ 存量登录态**不搬**：迁移里禁止回填，跨服务读别人的密文也不该做。
已经在助手那边登录过的部署，升级后要在模型管理页重登一次。

Revision ID: b8f2d41a07c9
Revises: a7e1c93b6d40
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b8f2d41a07c9"
down_revision: str | None = "a7e1c93b6d40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_TABLE = "llm_provider_credentials"
_PROVIDERS = "llm_providers"

# ⚠ 认证方式是**写死的字面量**，不许改成 import `enums.py`：迁移是冻结件，
# 而那是个活常量——将来加一档时另出一次迁移放宽 CHECK，同一个 revision
# 在旧库与新建库上必须建出同一个集合
AUTH_MODES = "'chatgpt'"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        _TABLE,
        sa.Column("id", sa.UUID(), nullable=False),
        # ⚠ 唯一 + 级联删：登录态是那一路供应商的一部分。留着的话，下一个建出来
        # 的供应商可能撞上一行没人认领的登录态
        sa.Column("provider_id", sa.UUID(), nullable=False),
        sa.Column("auth_mode", sa.String(length=32), nullable=False),
        # 令牌包整份加密后落这一格；明文一个字都不落
        sa.Column("token_enc", sa.Text(), nullable=False),
        # 给界面看的几格：账号只留掩码（PII），订阅档上游给什么就是什么
        sa.Column("account_label", sa.String(length=128), nullable=True),
        sa.Column("plan_label", sa.String(length=128), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_refresh_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column(
            "row_version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
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
        sa.PrimaryKeyConstraint("id", name="pk_llm_provider_credentials"),
        sa.UniqueConstraint(
            "provider_id", name="uq_llm_provider_credentials_provider_id"
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            [f"{_SCHEMA}.{_PROVIDERS}.id"],
            name="fk_llm_provider_credentials_provider_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            f"auth_mode IN ({AUTH_MODES})",
            name="ck_llm_provider_credentials_auth_mode_known",
        ),
        sa.CheckConstraint(
            "row_version >= 1",
            name="ck_llm_provider_credentials_row_version_positive",
        ),
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table(_TABLE, schema=_SCHEMA)

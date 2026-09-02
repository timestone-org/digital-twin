"""给供应商加接入形态与形态自己的那几格配置（ADR-0040）。

纯扩展步：加两列（都带非 volatile 默认或可空），并把端点与密钥两列放开
NOT NULL——靠登录的那些形态没有端点。旧代码只写 `openai_compat` 那一形态，
它写进来的行仍然带地址与密钥，故「新结构 + 旧代码」可用。没有回填。

Revision ID: a7e1c93b6d40
Revises: c4d8e2a71f35
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a7e1c93b6d40"
down_revision: str | None = "c4d8e2a71f35"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_PROVIDERS = "llm_providers"

# ⚠ 形态码是**写死的字面量**，不许改成 import `enums.py`：迁移是冻结件，
# 而那是个活常量——将来加一种形态时另出一次迁移放宽 CHECK，同一个 revision
# 在旧库与新建库上必须建出同一个集合
KINDS = "'openai_compat', 'codex_oauth'"
# 存量行只有端点那一形态，故默认值就是它——旧代码建的行也落在这一档
DEFAULT_KIND = "openai_compat"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.add_column(
        _PROVIDERS,
        sa.Column(
            "kind",
            sa.Text(),
            nullable=False,
            server_default=DEFAULT_KIND,
        ),
        schema=_SCHEMA,
    )
    op.add_column(
        _PROVIDERS,
        sa.Column(
            "options_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        schema=_SCHEMA,
    )
    op.create_check_constraint(
        "ck_llm_providers_kind_known",
        _PROVIDERS,
        f"kind IN ({KINDS})",
        schema=_SCHEMA,
    )
    op.create_check_constraint(
        "ck_llm_providers_options_are_an_object",
        _PROVIDERS,
        "options_json IS NULL OR jsonb_typeof(options_json) = 'object'",
        schema=_SCHEMA,
    )
    # ⚠ 放开而不是加：靠登录的那些形态没有端点与密钥。地址那条 CHECK
    # 对 NULL 判 NULL 而不是假，于是照常放行，不必动它
    op.alter_column(_PROVIDERS, "base_url", nullable=True, schema=_SCHEMA)
    op.alter_column(_PROVIDERS, "api_key_enc", nullable=True, schema=_SCHEMA)


def downgrade() -> None:
    """⚠ 收回 NOT NULL 之前先确认没有靠登录的那一形态：有的话那几行没有地址
    与密钥，收回去当场失败。这条不替调用方删数据——删的是配置不是缓存。"""
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.alter_column(_PROVIDERS, "api_key_enc", nullable=False, schema=_SCHEMA)
    op.alter_column(_PROVIDERS, "base_url", nullable=False, schema=_SCHEMA)
    op.drop_constraint(
        "ck_llm_providers_options_are_an_object",
        _PROVIDERS,
        type_="check",
        schema=_SCHEMA,
    )
    op.drop_constraint(
        "ck_llm_providers_kind_known",
        _PROVIDERS,
        type_="check",
        schema=_SCHEMA,
    )
    op.drop_column(_PROVIDERS, "options_json", schema=_SCHEMA)
    op.drop_column(_PROVIDERS, "kind", schema=_SCHEMA)

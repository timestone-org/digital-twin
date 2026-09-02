"""建模型供应商目录的两张表（ADR-0039）：供应商与用途分配。

两张都是新建表，索引随建表一起下，不需要 CONCURRENTLY，也没有回填。
旧代码不认识这两张表、也不会去读，故「新结构 + 旧代码」天然可用。

Revision ID: c4d8e2a71f35
Revises: f3c9a15d82e6
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c4d8e2a71f35"
down_revision: str | None = "f3c9a15d82e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_PROVIDERS = "llm_providers"
_ASSIGNMENTS = "llm_assignments"

# ⚠ 用途码是**写死的字面量**，不许改成 import `apps/llm_providers/enums.py`：
# 迁移是冻结件，而那是个活常量——将来加一档用途时另出一次迁移放宽 CHECK，
# 同一个 revision 在旧库与新建库上必须建出同一个集合。两侧不许漂由契约测试盯着
PURPOSES = (
    "'assistant.chat', 'assistant.vision', 'assistant.summary', "
    "'assistant.embedding', 'knowledge.chat', 'knowledge.embedding'"
)


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_providers()
    _create_assignments()


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # ⚠ 顺序与建表相反：分配表上的 RESTRICT 外键会挡住先删供应商表
    op.drop_index(
        "ix_llm_assignments_provider_id", _ASSIGNMENTS, schema=_SCHEMA
    )
    op.drop_table(_ASSIGNMENTS, schema=_SCHEMA)
    op.drop_table(_PROVIDERS, schema=_SCHEMA)


def _timestamps() -> tuple[sa.Column[object], sa.Column[object]]:
    """建表与更新两列时刻。时刻一律 timestamptz 存 UTC。"""
    return (
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
    )


def _create_providers() -> None:
    op.create_table(
        _PROVIDERS,
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("base_url", sa.Text(), nullable=False),
        # 密钥只以密文入库；旁边留尾巴几位给界面认「是哪一把」
        sa.Column("api_key_enc", sa.Text(), nullable=False),
        sa.Column(
            "api_key_hint",
            sa.String(length=16),
            server_default="",
            nullable=False,
        ),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        # 端点方言里的额外请求体；模型清单是
        # `[{name, kind, has_vision, dimensions}]`
        sa.Column("extra_body_json", postgresql.JSONB(), nullable=True),
        sa.Column(
            "models_json",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), server_default="", nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_llm_providers"),
        sa.UniqueConstraint("name", name="uq_llm_providers_name"),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_llm_providers_name_nonempty"
        ),
        sa.CheckConstraint(
            "base_url ~ '^https?://'",
            name="ck_llm_providers_base_url_is_http",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(models_json) = 'array'",
            name="ck_llm_providers_models_are_an_array",
        ),
        sa.CheckConstraint(
            "extra_body_json IS NULL OR jsonb_typeof(extra_body_json) = "
            "'object'",
            name="ck_llm_providers_extra_body_is_an_object",
        ),
        schema=_SCHEMA,
    )


def _create_assignments() -> None:
    op.create_table(
        _ASSIGNMENTS,
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("provider_id", sa.UUID(), nullable=False),
        sa.Column("model_name", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("purpose", name="pk_llm_assignments"),
        # ⚠ RESTRICT：删一路还被指着的供应商，数据库当场拒——放行的话消费方
        # 那一侧解不出端点、静默退回环境变量那一档，而界面上分配还写着它
        sa.ForeignKeyConstraint(
            ["provider_id"],
            [f"{_SCHEMA}.{_PROVIDERS}.id"],
            name="fk_llm_assignments_provider_id",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            f"purpose IN ({PURPOSES})", name="ck_llm_assignments_purpose_known"
        ),
        sa.CheckConstraint(
            "length(model_name) > 0",
            name="ck_llm_assignments_model_name_nonempty",
        ),
        schema=_SCHEMA,
    )
    op.create_index(
        "ix_llm_assignments_provider_id",
        _ASSIGNMENTS,
        ["provider_id"],
        unique=False,
        schema=_SCHEMA,
    )

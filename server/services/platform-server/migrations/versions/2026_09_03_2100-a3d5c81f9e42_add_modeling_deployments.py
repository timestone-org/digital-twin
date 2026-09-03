"""模型对外服务的三张表（docs/MODELING_PLATFORM_DESIGN.md D13）。

纯扩展步：三张新表，无回填。旧代码不认识它们。

⚠ `code` 是 URL 段而不是版本 id：换版本时第三方不必改代码。
⚠ 密钥表里只存 `sha256(明文)` 与前 12 位明文前缀。明文只在创建回执里出现一次，
之后任何接口都取不回来——存了就等于给自己留了一个能读出全部密钥的接口。
⚠ 调用记录**不记入参与出参**：那是业务数据、可能含敏感值，而且体积会压垮这张
表。排查具体一次调用靠 `trace_id` 去结构化日志里找。

Revision ID: a3d5c81f9e42
Revises: f2c8d90a4b17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a3d5c81f9e42"
down_revision: str | None = "f2c8d90a4b17"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SCHEMA = "platform"
_DEPLOYMENTS = "modeling_deployments"
_KEYS = "modeling_api_keys"
_LOGS = "modeling_call_logs"

# URL 段的形状。⚠ 与代码里的正则必须同一份口径，两边漂了就是「界面收得下、
# 数据库拒掉」
_CODE_PATTERN = "^[a-z0-9][a-z0-9-]{1,62}$"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_deployments()
    _create_keys()
    _create_logs()


def _create_deployments() -> None:
    op.create_table(
        _DEPLOYMENTS,
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column(
            "model_version_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "is_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "max_rows_per_call",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("200"),
        ),
        sa.Column(
            "rate_limit_per_minute",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("60"),
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_name", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["model_version_id"],
            [f"{_SCHEMA}.modeling_model_versions.id"],
            name="fk_modeling_deployments_version_id",
            # ⚠ RESTRICT 不是 CASCADE：还有第三方在调的版本删不掉，
            # 而 CASCADE 的表现是「退役一个版本，对方系统当场 404」
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("code", name="uq_modeling_deployments_code"),
        sa.CheckConstraint(
            f"code ~ '{_CODE_PATTERN}'", name="code_is_a_url_segment"
        ),
        sa.CheckConstraint("length(name) > 0", name="name_nonempty"),
        sa.CheckConstraint(
            "max_rows_per_call BETWEEN 1 AND 1000", name="max_rows_in_range"
        ),
        sa.CheckConstraint(
            "rate_limit_per_minute BETWEEN 1 AND 6000",
            name="rate_limit_in_range",
        ),
        schema=_SCHEMA,
    )


def _create_keys() -> None:
    op.create_table(
        _KEYS,
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "deployment_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("key_prefix", sa.Text(), nullable=False),
        sa.Column("key_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_name", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["deployment_id"],
            [f"{_SCHEMA}.{_DEPLOYMENTS}.id"],
            name="fk_modeling_api_keys_deployment_id",
            ondelete="CASCADE",
        ),
        # ⚠ 摘要唯一：校验时按摘要直接查一行，不必遍历这个部署的每一把钥匙
        sa.UniqueConstraint("key_hash", name="uq_modeling_api_keys_hash"),
        sa.CheckConstraint("length(name) > 0", name="name_nonempty"),
        sa.CheckConstraint("length(key_hash) = 64", name="hash_is_sha256"),
        sa.CheckConstraint("length(key_prefix) > 0", name="prefix_nonempty"),
        schema=_SCHEMA,
    )
    op.create_index(
        "ix_modeling_api_keys_deployment_id",
        _KEYS,
        ["deployment_id"],
        schema=_SCHEMA,
    )


def _create_logs() -> None:
    op.create_table(
        _LOGS,
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "deployment_id", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column("api_key_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["deployment_id"],
            [f"{_SCHEMA}.{_DEPLOYMENTS}.id"],
            name="fk_modeling_call_logs_deployment_id",
            ondelete="CASCADE",
        ),
        # ⚠ 密钥被撤销并删掉之后调用记录要留着：置空而不是连坐删掉
        sa.ForeignKeyConstraint(
            ["api_key_id"],
            [f"{_SCHEMA}.{_KEYS}.id"],
            name="fk_modeling_call_logs_api_key_id",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint("row_count >= 0", name="row_count_nonnegative"),
        sa.CheckConstraint("duration_ms >= 0", name="duration_nonnegative"),
        schema=_SCHEMA,
    )
    op.create_index(
        "ix_modeling_call_logs_deployment_id_created_at",
        _LOGS,
        ["deployment_id", "created_at"],
        schema=_SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.drop_table(_LOGS, schema=_SCHEMA)
    op.drop_table(_KEYS, schema=_SCHEMA)
    op.drop_table(_DEPLOYMENTS, schema=_SCHEMA)

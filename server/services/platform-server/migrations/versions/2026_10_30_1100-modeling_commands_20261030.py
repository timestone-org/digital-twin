"""扩展建模持久命令、可信操作者审计与调用账号；无存量回填。"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "modeling_commands_20261030"
down_revision: str | None = "modeling_management_idx_20261030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _commands()
    _audits()
    for name, column_type in (
        ("account_user_id", postgresql.UUID()),
        ("external_operator_id", sa.Text()),
        ("trace_id", sa.Text()),
    ):
        op.add_column(
            "modeling_call_logs",
            sa.Column(name, column_type, nullable=True),
            schema="platform",
        )


def _timestamps() -> list[sa.Column[sa.DateTime]]:
    return [
        sa.Column(
            name,
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        )
        for name in ("created_at", "updated_at")
    ]


def _commands() -> None:
    op.create_table(
        "modeling_commands",
        sa.Column("id", postgresql.UUID(), nullable=False),
        sa.Column("account_user_id", postgresql.UUID(), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("key_hash", sa.Text(), nullable=False),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("result_json", postgresql.JSONB(), nullable=True),
        sa.Column("error_json", postgresql.JSONB(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trace_id", sa.Text(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_modeling_commands"),
        sa.UniqueConstraint(
            "account_user_id",
            "scope",
            "key_hash",
            name="uq_modeling_commands_account_user_id_scope_key_hash",
        ),
        sa.CheckConstraint(
            "state IN ('pending', 'succeeded', 'failed')",
            name="ck_modeling_commands_state_valid",
        ),
        sa.CheckConstraint(
            "length(key_hash) = 64 AND length(request_hash) = 64",
            name="ck_modeling_commands_hashes_sha256",
        ),
        sa.CheckConstraint(
            "(state = 'pending' AND result_json IS NULL "
            "AND http_status IS NULL AND completed_at IS NULL "
            "AND error_json IS NULL) OR "
            "(state = 'succeeded' AND result_json IS NOT NULL "
            "AND http_status BETWEEN 200 AND 299 AND completed_at IS NOT NULL "
            "AND error_json IS NULL) OR "
            "(state = 'failed' AND result_json IS NULL "
            "AND http_status BETWEEN 400 AND 499 AND completed_at IS NOT NULL "
            "AND error_json IS NOT NULL)",
            name="ck_modeling_commands_result_matches_state",
        ),
        schema="platform",
    )


def _audits() -> None:
    op.create_table(
        "modeling_operator_audits",
        sa.Column("id", postgresql.UUID(), nullable=False),
        sa.Column("account_user_id", postgresql.UUID(), nullable=False),
        sa.Column("external_operator_id", sa.Text(), nullable=True),
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("resource_id", postgresql.UUID(), nullable=True),
        sa.Column("command_id", postgresql.UUID(), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=False),
        sa.Column("trace_id", sa.Text(), nullable=False),
        sa.Column("source_ip", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id", name="pk_modeling_operator_audits"),
        sa.ForeignKeyConstraint(
            ["command_id"],
            ["platform.modeling_commands.id"],
            name="fk_modeling_operator_audits_command_id_modeling_commands",
            ondelete="RESTRICT",
        ),
        schema="platform",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    for name in ("trace_id", "external_operator_id", "account_user_id"):
        op.drop_column("modeling_call_logs", name, schema="platform")
    op.drop_table("modeling_operator_audits", schema="platform")
    op.drop_table("modeling_commands", schema="platform")

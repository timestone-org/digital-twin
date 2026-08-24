"""建 assistant schema 的三张表：会话、消息、步骤。

纯新增，无回填。⚠ 架构里规划过的「知识块」表本期**不建**：空着的表比不存在的
表更容易被误用（CONTEXT.md §5）。

Revision ID: a1f7c02b9d34
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1f7c02b9d34"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "assistant"


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    _create_sessions()
    _create_messages()
    _create_steps()


def _create_sessions() -> None:
    op.create_table(
        "chat_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "title", sa.String(length=200), nullable=False, server_default=""
        ),
        sa.Column("surface_kind", sa.String(length=32), nullable=False),
        sa.Column("surface_ref", sa.String(length=128), nullable=True),
        sa.Column(
            "is_archived",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "row_version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("last_error", sa.Text(), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name="pk_chat_sessions"),
        sa.CheckConstraint(
            "surface_kind IN ('dashboard-editor', 'twin-editor', "
            "'dataset-table', 'collect-source', 'dashboard-view')",
            name="ck_chat_sessions_surface_kind_known",
        ),
        sa.CheckConstraint(
            "row_version >= 1", name="ck_chat_sessions_row_version_positive"
        ),
        sa.CheckConstraint(
            "length(title) <= 200", name="ck_chat_sessions_title_sized"
        ),
        schema=SCHEMA,
    )
    # 列表页按「我的、未归档、最近的在前」翻，这三列正好是它的形状
    op.create_index(
        "ix_chat_sessions_user_id_updated_at",
        "chat_sessions",
        ["user_id", "updated_at"],
        schema=SCHEMA,
    )


def _create_messages() -> None:
    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content_json", postgresql.JSONB(), nullable=False),
        sa.Column("usage_json", postgresql.JSONB(), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name="pk_chat_messages"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            [f"{SCHEMA}.chat_sessions.id"],
            name="fk_chat_messages_session_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "session_id", "seq", name="uq_chat_messages_session_id_seq"
        ),
        sa.CheckConstraint(
            "role IN ('user', 'assistant', 'tool')",
            name="ck_chat_messages_role_known",
        ),
        sa.CheckConstraint("seq >= 1", name="ck_chat_messages_seq_positive"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_chat_messages_session_id",
        "chat_messages",
        ["session_id"],
        schema=SCHEMA,
    )


def _create_steps() -> None:
    op.create_table(
        "chat_steps",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("input_json", postgresql.JSONB(), nullable=True),
        sa.Column("output_json", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id", name="pk_chat_steps"),
        sa.ForeignKeyConstraint(
            ["message_id"],
            [f"{SCHEMA}.chat_messages.id"],
            name="fk_chat_steps_message_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "message_id", "seq", name="uq_chat_steps_message_id_seq"
        ),
        sa.CheckConstraint(
            "kind IN ('model', 'server_tool', 'client_tool')",
            name="ck_chat_steps_kind_known",
        ),
        sa.CheckConstraint(
            "state IN ('running', 'awaiting_client', 'succeeded', "
            "'failed', 'aborted')",
            name="ck_chat_steps_state_known",
        ),
        sa.CheckConstraint("seq >= 1", name="ck_chat_steps_seq_positive"),
        sa.CheckConstraint(
            "length(name) > 0", name="ck_chat_steps_name_nonempty"
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_chat_steps_message_id",
        "chat_steps",
        ["message_id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_table("chat_steps", schema=SCHEMA)
    op.drop_table("chat_messages", schema=SCHEMA)
    op.drop_table("chat_sessions", schema=SCHEMA)

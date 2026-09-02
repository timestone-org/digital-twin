"""加对话的三张表：会话、消息、步骤（docs/KNOWLEDGE_CHAT_DESIGN.md §5）。

纯扩展步：全部新建、**不回填**。旧代码不认识这些表，也不会去读它们。

⚠ 会话表**在 knowledge schema 自己这一份**，不与助手共用（ADR-0037 决策二）：
跨 schema 外键是禁令，共表则把两个服务的发布周期绑死。

⚠ 索引不用 `CONCURRENTLY`：这几张表是这一次新建的、建索引时还是空的
（理由同上一份迁移的文件头）。

Revision ID: b7d2e9f04a15
Revises: a1c4e7b90d23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b7d2e9f04a15"
down_revision: str | None = "a1c4e7b90d23"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "knowledge"

_UUID = postgresql.UUID(as_uuid=True)
_JSONB = postgresql.JSONB(astext_type=sa.Text())

MESSAGE_ROLES = "'user', 'assistant', 'tool'"
STEP_KINDS = "'model', 'server_tool', 'client_tool'"
STEP_STATES = "'running', 'awaiting_client', 'succeeded', 'failed', 'aborted'"


def _timestamps() -> tuple[sa.Column[sa.DateTime], sa.Column[sa.DateTime]]:
    """两列时刻。时刻一律 timestamptz 存 UTC。"""
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


def _create_sessions() -> None:
    op.create_table(
        "kb_chat_sessions",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.Column(
            "title",
            sa.String(length=200),
            server_default=sa.text("''"),
            nullable=False,
        ),
        sa.Column(
            "is_archived",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "row_version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("summary_json", _JSONB, nullable=True),
        *_timestamps(),
        schema=SCHEMA,
    )
    # 列表按归属过滤、按更新时刻排；两列一起才走得了索引
    op.create_index(
        "ix_kb_chat_sessions_user_updated",
        "kb_chat_sessions",
        ["user_id", "updated_at"],
        schema=SCHEMA,
    )


def _create_messages() -> None:
    op.create_table(
        "kb_chat_messages",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        sa.Column("session_id", _UUID, nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content_json", _JSONB, nullable=False),
        sa.Column("usage_json", _JSONB, nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["session_id"],
            [f"{SCHEMA}.kb_chat_sessions.id"],
            name="fk_kb_chat_messages_session_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "session_id", "seq", name="uq_kb_chat_messages_session_id_seq"
        ),
        sa.CheckConstraint(f"role IN ({MESSAGE_ROLES})", name="role_known"),
        sa.CheckConstraint("seq >= 1", name="seq_positive"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_kb_chat_messages_session_id",
        "kb_chat_messages",
        ["session_id"],
        schema=SCHEMA,
    )


def _create_steps() -> None:
    op.create_table(
        "kb_chat_steps",
        sa.Column("id", _UUID, primary_key=True, nullable=False),
        sa.Column("message_id", _UUID, nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("input_json", _JSONB, nullable=True),
        sa.Column("output_json", _JSONB, nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["message_id"],
            [f"{SCHEMA}.kb_chat_messages.id"],
            name="fk_kb_chat_steps_message_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "message_id", "seq", name="uq_kb_chat_steps_message_id_seq"
        ),
        sa.CheckConstraint(f"kind IN ({STEP_KINDS})", name="kind_known"),
        sa.CheckConstraint(f"state IN ({STEP_STATES})", name="state_known"),
        sa.CheckConstraint("seq >= 1", name="seq_positive"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_kb_chat_steps_message_id",
        "kb_chat_steps",
        ["message_id"],
        schema=SCHEMA,
    )


def upgrade() -> None:
    """建三张表。开头必设 lock_timeout（database-standard）。"""
    op.execute("SET lock_timeout = '5s'")
    _create_sessions()
    _create_messages()
    _create_steps()


def downgrade() -> None:
    """按依赖倒序删。"""
    op.execute("SET lock_timeout = '5s'")
    op.drop_table("kb_chat_steps", schema=SCHEMA)
    op.drop_table("kb_chat_messages", schema=SCHEMA)
    op.drop_table("kb_chat_sessions", schema=SCHEMA)

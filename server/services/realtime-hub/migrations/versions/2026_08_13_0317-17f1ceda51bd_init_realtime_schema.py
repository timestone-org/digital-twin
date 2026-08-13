"""建 realtime schema 的初始结构：主题声明与订阅。

schema 由 env.py 在迁移前 CREATE IF NOT EXISTS。

⚠ 两张表都**不含业务字段**，`realtime` schema 永远不长业务列（ADR-0007）。
`topic` 与 `required_code` 都是推送方给的不透明字符串，本服务不解析。

⚠ `seq` 落在主题声明上，推送时在同一条 UPDATE … RETURNING 里原子自增。
进程内计数器一重启就归零、两个副本各自计数必然分叉，两种都会被客户端读成
丢帧（CONTEXT.md §5）。

⚠ 订阅的外键指向主题的**自然键**并 ON DELETE CASCADE：主题注销时订阅必须
跟着走，否则会留下指向不存在主题的订阅——页面上看着一切正常，就是永远收不到
数据。

Revision ID: 17f1ceda51bd
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "17f1ceda51bd"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        "topic_declaration",
        sa.Column("topic", sa.String(length=200), nullable=False),
        sa.Column("required_code", sa.String(length=64), nullable=False),
        sa.Column("publisher", sa.String(length=64), nullable=False),
        sa.Column(
            "seq", sa.BigInteger(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "last_published_at", sa.DateTime(timezone=True), nullable=True
        ),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_topic_declaration")),
        sa.UniqueConstraint("topic", name=op.f("uq_topic_declaration_topic")),
        schema="realtime",
    )
    op.create_table(
        "subscription",
        sa.Column("connection_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("topic", sa.String(length=200), nullable=False),
        sa.Column("replica", sa.String(length=64), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["topic"],
            ["realtime.topic_declaration.topic"],
            name="fk_subscription_topic",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_subscription")),
        sa.UniqueConstraint(
            "connection_id", "topic", name="uq_subscription_connection_topic"
        ),
        schema="realtime",
    )
    op.create_index(
        "ix_subscription_replica",
        "subscription",
        ["replica"],
        unique=False,
        schema="realtime",
    )
    op.create_index(
        "ix_subscription_topic",
        "subscription",
        ["topic"],
        unique=False,
        schema="realtime",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.drop_index(
        "ix_subscription_topic", table_name="subscription", schema="realtime"
    )
    op.drop_index(
        "ix_subscription_replica", table_name="subscription", schema="realtime"
    )
    op.drop_table("subscription", schema="realtime")
    op.drop_table("topic_declaration", schema="realtime")

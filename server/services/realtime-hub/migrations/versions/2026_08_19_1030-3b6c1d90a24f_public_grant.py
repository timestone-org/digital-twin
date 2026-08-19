"""匿名票据授权表，以及订阅的 user_id 放开可空。

⚠ 表里仍然没有业务字段：`ticket_hash` 是一串指纹、`topic` 是不透明键，
本服务不知道票据背后是什么（ADR-0007 / ADR-0021）。存指纹不存票据——票据是
一枚可直接使用的凭据，落到通道服务的库里就等于多一处可被拖走的密钥副本。

⚠ `subscription.user_id` 放开可空是**扩展步**：旧代码永远会带上 user_id，
所以「新结构 + 旧代码」照常可用。匿名连接不属于任何一个人，塞一个编出来的
哨兵 UUID 会让对账把它读成真实用户。

Revision ID: 3b6c1d90a24f
Revises: 17f1ceda51bd
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "3b6c1d90a24f"
down_revision: str | None = "17f1ceda51bd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    op.create_table(
        "public_grant",
        sa.Column("ticket_hash", sa.String(length=64), nullable=False),
        sa.Column("topic", sa.String(length=200), nullable=False),
        sa.Column("publisher", sa.String(length=64), nullable=False),
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
            name="fk_public_grant_topic",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_public_grant")),
        sa.UniqueConstraint(
            "ticket_hash", name=op.f("uq_public_grant_ticket_hash")
        ),
        schema="realtime",
    )
    # ⚠ 建表与建索引都在新表上，不用 CONCURRENTLY：表是空的、也还没有人读它，
    # 而 CONCURRENTLY 不能在事务里跑
    op.create_index(
        "ix_public_grant_publisher",
        "public_grant",
        ["publisher"],
        unique=False,
        schema="realtime",
    )
    op.create_index(
        "ix_public_grant_topic",
        "public_grant",
        ["topic"],
        unique=False,
        schema="realtime",
    )
    op.alter_column(
        "subscription",
        "user_id",
        existing_type=sa.UUID(),
        nullable=True,
        schema="realtime",
    )


def downgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    # ⚠ `user_id` 刻意**不收回** NOT NULL：收回要先删掉匿名订阅行，而迁移里
    # 不许动数据（那会让发布时长变得不可预测、失败还难以续跑）。留着可空对旧
    # 代码没有影响——它每次都会带上 user_id。
    op.drop_index(
        "ix_public_grant_topic", table_name="public_grant", schema="realtime"
    )
    op.drop_index(
        "ix_public_grant_publisher",
        table_name="public_grant",
        schema="realtime",
    )
    op.drop_table("public_grant", schema="realtime")

"""订阅表：某条连接正在收某个主题。

⚠ 连接是**进程内对象**，跨副本不可共享。这张表记的是「谁在订什么」，
用于对账与诊断；真正的扇出走各副本自己的连接注册表（CONTEXT.md §4）。
所以这里存 `connection_id` 而不是任何连接句柄——句柄落库没有意义。
"""

import uuid

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from realtime_hub.apps.channel.models.base import Base
from realtime_hub.apps.channel.models.topic import TOPIC_MAX_LENGTH

# 副本标识，形如容器主机名。⚠ 副本重启后旧行要能被认出来清掉
REPLICA_MAX_LENGTH = 64


class Subscription(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条订阅：连接 × 主题。"""

    __tablename__ = "subscription"
    __table_args__ = (
        # 同一条连接对同一个主题只许有一行——重复订阅是幂等的
        UniqueConstraint(
            "connection_id", "topic", name="uq_subscription_connection_topic"
        ),
        # 扇出与退订都按主题查
        Index("ix_subscription_topic", "topic"),
        # 副本重启后按副本清残留
        Index("ix_subscription_replica", "replica"),
    )

    # 连接的进程内标识，由 hub 在握手时分配
    connection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    topic: Mapped[str] = mapped_column(
        # ⚠ 外键指向主题声明的自然键：主题注销时订阅必须跟着走，否则会留下
        # 指向不存在主题的订阅，而它在页面上看着一切正常、就是永远收不到数据
        ForeignKey(
            "topic_declaration.topic",
            ondelete="CASCADE",
            name="fk_subscription_topic",
        ),
        String(TOPIC_MAX_LENGTH),
        nullable=False,
    )
    replica: Mapped[str] = mapped_column(
        String(REPLICA_MAX_LENGTH), nullable=False
    )

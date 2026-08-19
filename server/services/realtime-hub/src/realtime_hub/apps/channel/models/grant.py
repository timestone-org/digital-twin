"""匿名票据授权表：拿着这枚票据的连接可以订这一个主题。

⚠ 表里仍然**没有业务字段**：`ticket_hash` 是一串指纹、`topic` 是不透明键，
本服务不知道票据背后是一张大屏还是别的什么（ADR-0007 / ADR-0021）。

⚠ 存的是**指纹不是票据本身**：票据是一枚可直接使用的凭据，落到另一个服务的
库里就等于多了一处可以被拖走的密钥副本。握手时现算一次 SHA-256 再比对，
本服务因此永远不持有可用的凭据。
"""

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from realtime_hub.apps.channel.models.base import Base
from realtime_hub.apps.channel.models.topic import (
    PUBLISHER_MAX_LENGTH,
    TOPIC_MAX_LENGTH,
)

# SHA-256 的十六进制串长度，逐字 64
TICKET_HASH_LENGTH = 64


class PublicGrant(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条匿名授权：一枚票据的指纹 → 一个主题。"""

    __tablename__ = "public_grant"
    __table_args__ = (
        # 对账按推送方拉全集
        Index("ix_public_grant_publisher", "publisher"),
        # ⚠ 外键列要自己的索引：主题注销走 ON DELETE CASCADE，没有它每次
        # 注销都要对本表全表扫一遍
        Index("ix_public_grant_topic", "topic"),
    )

    ticket_hash: Mapped[str] = mapped_column(
        String(TICKET_HASH_LENGTH), nullable=False, unique=True
    )
    topic: Mapped[str] = mapped_column(
        String(TOPIC_MAX_LENGTH),
        # ⚠ 指向主题声明的自然键并级联：主题注销时授权必须跟着走，否则会留下
        # 一条指向不存在主题的授权——握手过得去、订上了、永远收不到数据
        ForeignKey(
            "topic_declaration.topic",
            ondelete="CASCADE",
            name="fk_public_grant_topic",
        ),
        nullable=False,
    )
    # 登记它的服务名，对账时按它拉全集
    publisher: Mapped[str] = mapped_column(
        String(PUBLISHER_MAX_LENGTH), nullable=False
    )

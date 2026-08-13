"""主题声明表：这个主题存在、订阅它要哪个码、下一个 seq 是多少。

⚠ 表里**没有一个业务字段**。`topic` 与 `required_code` 都是推送方给的不透明
字符串，本服务不解析、不理解（ADR-0007）。
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, String, text
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from realtime_hub.apps.channel.models.base import Base

# 主题形如 `<域>:<标识>`，域名与 REST 资源名一致（api-contract §10）
TOPIC_MAX_LENGTH = 200
# 权限码形如 `<域>:<动作>`，与 auth-server 目录里的字面量同宽
CODE_MAX_LENGTH = 64
PUBLISHER_MAX_LENGTH = 64


class TopicDeclaration(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条主题声明。推送方登记，注销即删除。"""

    __tablename__ = "topic_declaration"

    topic: Mapped[str] = mapped_column(
        String(TOPIC_MAX_LENGTH), nullable=False, unique=True
    )
    # 订阅它所需的权限码。hub 只做集合包含判断，不判断这个码宽不宽——
    # 它没有判断宽窄的依据，那一截靠权限码目录的评审兜（ADR-0007 §代价）
    required_code: Mapped[str] = mapped_column(
        String(CODE_MAX_LENGTH), nullable=False
    )
    # 登记它的服务名，只为对账与排查用：主题推不动时先看是谁登记的
    publisher: Mapped[str] = mapped_column(
        String(PUBLISHER_MAX_LENGTH), nullable=False
    )
    # ⚠ 权威 seq 在这里，不在内存也不在 Redis：进程内计数器一重启就归零、
    # 两个副本各自计数必然分叉，两种都会被客户端读成丢帧。推送时在同一条
    # UPDATE … RETURNING 里原子自增，见 CONTEXT.md §5。
    seq: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0")
    )
    # 最近一次推送的时刻。主题登记了却从没推过，是对账要找的第一种异常
    last_published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

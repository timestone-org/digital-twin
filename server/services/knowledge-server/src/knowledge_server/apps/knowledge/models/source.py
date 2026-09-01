"""来源表：一个库下的一路知识来源实例。

⚠ 上传那一路**也是一行**，不给它开后门（ADR-0033 决策一）。开了后门的话，
第二路来源要么复制一遍摄取管线，要么把管线改成认两种形状的 `if`——而那个 `if`
会在第三路来源出现时变成三个分支。
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from knowledge_server.apps.knowledge.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

KIND_MAX_LENGTH = 32
NAME_MAX_LENGTH = 120
CURSOR_MAX_LENGTH = 512

# 与 `services/sources/registry.py` 的注册名逐字对齐，由契约测试守着不漂
KINDS = ("upload", "platform")


class KnowledgeSource(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一路来源实例。"""

    __tablename__ = "kb_sources"

    base_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kb_bases.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(KIND_MAX_LENGTH), nullable=False)
    name: Mapped[str] = mapped_column(String(NAME_MAX_LENGTH), nullable=False)
    # 这一路自己的配置，形状由它的 `config_schema()` 定。⚠ 是只自由袋子：
    # 写一个这一路不认识的键既不报错也不生效，所以入库前必须按 schema 校验过
    config_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    # 上一次 `discover` 走到哪。⚠ 增量同步的锚：丢了它就是全量重扫，
    # 而全量重扫在外部系统那一侧可能是几十万次分页
    sync_cursor: Mapped[str | None] = mapped_column(
        String(CURSOR_MAX_LENGTH), nullable=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 上一次同步失败的原因。⚠ 留着而不是清掉：清掉的话界面上是「从没同步过」，
    # 而那与「同步了但一直失败」是两件事
    last_error: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=""
    )

    __table_args__ = (
        CheckConstraint("kind IN ('upload', 'platform')", name="kind_known"),
        CheckConstraint("length(name) > 0", name="name_present"),
        Index("ix_kb_sources_base", "base_id"),
    )

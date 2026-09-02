"""文档表：一路来源里的一个条目。

⚠ 「文档」不一定是文件：上传那一路的一行是一个文件，外部系统那一路的一行
是对方接口里的一条记录（CONTEXT.md §1）。

⚠ `content_hash` 是摄取的**幂等键**。判据是内容哈希而不是文件名——文件名一改
就当成新文档，是最常见的重复来源，而重复的表现是同一段话在检索里出现两次。
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from knowledge_server.orm import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

TITLE_MAX_LENGTH = 300
MEDIA_TYPE_MAX_LENGTH = 128
OBJECT_KEY_MAX_LENGTH = 512
EXTERNAL_REF_MAX_LENGTH = 512
STATUS_MAX_LENGTH = 16
HASH_LENGTH = 64

# 摄取状态机（KNOWLEDGE_BASE_DESIGN §1.2）。⚠ 与消费者的判幂等逐字同源：
# 判据是**当前状态**，不是「有没有查到」——「先查再插」不是幂等
STATUSES = (
    "pending",
    "parsing",
    "chunking",
    "embedding",
    "indexing",
    "ready",
    "failed",
)


class KnowledgeDocument(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一份文档。"""

    __tablename__ = "kb_documents"

    base_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kb_bases.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kb_sources.id", ondelete="CASCADE"),
        nullable=False,
    )
    # 这一路来源里它的身份：上传那一路是对象存储的 key，
    # 外部系统那一路是对方的 id
    external_ref: Mapped[str] = mapped_column(
        String(EXTERNAL_REF_MAX_LENGTH), nullable=False
    )
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH), nullable=False)
    media_type: Mapped[str] = mapped_column(
        String(MEDIA_TYPE_MAX_LENGTH), nullable=False, server_default=""
    )
    # 原件在对象存储里的落点。外部系统那一路没有原件，这一格是空串
    object_key: Mapped[str] = mapped_column(
        String(OBJECT_KEY_MAX_LENGTH), nullable=False, server_default=""
    )
    byte_size: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    # 内容的 sha256（十六进制）。摄取的幂等键
    content_hash: Mapped[str] = mapped_column(
        String(HASH_LENGTH), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(STATUS_MAX_LENGTH), nullable=False, server_default="pending"
    )
    # 失败原因，一句人话。⚠ 不含表名、SQL、内网地址——它会原样上界面
    failure_reason: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=""
    )
    chunk_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    ready_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'parsing', 'chunking', 'embedding', "
            "'indexing', 'ready', 'failed')",
            name="status_known",
        ),
        CheckConstraint("length(title) > 0", name="title_present"),
        CheckConstraint("length(content_hash) = 64", name="hash_sized"),
        CheckConstraint("byte_size >= 0", name="size_non_negative"),
        # ⚠ 同一个库里同一份内容只留一行。挂在 (base_id, content_hash) 而不是
        # (source_id, ...)：同一份手册从两路来源进来仍是同一份知识，
        # 留两行的表现是检索结果里同一段话出现两次
        UniqueConstraint(
            "base_id", "content_hash", name="uq_kb_documents_hash"
        ),
        Index("ix_kb_documents_base_status", "base_id", "status"),
        Index("ix_kb_documents_source", "source_id"),
    )

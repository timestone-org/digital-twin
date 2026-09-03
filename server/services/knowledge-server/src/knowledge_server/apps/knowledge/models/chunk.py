"""块表：检索与引用的最小单位。

⚠ 向量**不在这张表上**，在 `kb_chunk_embeddings`。取数形态完全不同：检索时先按
向量收窄再回表取正文，而列表页永远不需要向量。挂在一起的话，一次「列一下这个库
有哪些块」就把几千条 6 KB 的向量一起拖出来，而它只表现为「列表页有点慢」。
"""

import uuid
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from knowledge_server.orm import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

HEADING_MAX_LENGTH = 500


class KnowledgeChunk(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个块。"""

    __tablename__ = "kb_chunks"

    # ⚠ 冗余存一份 base_id：检索一律先按库收窄，经 document 绕一跳会让每一次
    # 检索都多一个 join，而那个 join 的代价随块数线性涨
    base_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kb_bases.id", ondelete="CASCADE"),
        nullable=False,
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kb_documents.id", ondelete="CASCADE"),
        nullable=False,
    )
    # 在这份文档里的第几块，从 0 起
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # 它在原件里的位置（页码 / 工作表与行号 / 幻灯片序号 / 标题路径）。
    # ⚠ 不是可选项：解析时丢掉它，后面任何一层都补不回来，而表现是答得头头是道
    # 却指不出出处——用户没法核对，这份答案就等于没有（ADR-0033 决策三）
    locator_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    # 这一块所在的标题路径，摊成一句给人看的话（「第 3 章 > 3.2 冷却水系统」）
    heading_path: Mapped[str] = mapped_column(
        String(HEADING_MAX_LENGTH), nullable=False, server_default=""
    )
    # 粗估的 token 数，只用来控批与显示，不参与打分
    token_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )

    __table_args__ = (
        CheckConstraint("ordinal >= 0", name="ordinal_non_negative"),
        CheckConstraint("length(text) > 0", name="text_present"),
        UniqueConstraint("document_id", "ordinal", name="uq_kb_chunks_ordinal"),
        # 检索一律先按库收窄
        Index("ix_kb_chunks_base", "base_id"),
        Index("ix_kb_chunks_document", "document_id"),
    )

"""图表：解析出来的插图与表格截图，以及它挂在哪几块上。

⚠ 字节**不在库里**，在对象存储的 `knowledge/` 前缀下——那个前缀**不匿名可读**
（桶策略只给 `models/`/`images/`/`icons/` 三个前缀开了匿名读）。知识库里可能
有涉密图纸，一条谁拿到谁能看的链接是不能给的。

⚠ 块与图靠联结表而不是按页反查：一页上可能有五张图，而某一块只讲其中一张——
按页反查会把另外四张也贴进引用，而那正是「依据里堆一堆没用的东西」。
"""

import uuid

from sqlalchemy import (
    BigInteger,
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

OBJECT_KEY_MAX_LENGTH = 512
MEDIA_TYPE_MAX_LENGTH = 128
CAPTION_MAX_LENGTH = 1000
HASH_LENGTH = 64

#: 图的两种来路。⚠ 是闭合集合，且由 CHECK 守着（禁原生 ENUM）：
#: `table` 那一档是解析后端顺带给的表格截图，它与 `table_row` 那些文本块并存
FIGURE_KINDS = ("image", "table")


class KnowledgeFigure(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一张图。"""

    __tablename__ = "kb_document_figures"

    # ⚠ 冗余存一份 base_id：删库时按它一把清，不必经 document 绕一跳
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
    # 在这份文档里的第几张，从 0 起
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    # 它在原件的第几页；没有页这个概念的格式留空
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 版面框（归一化到 0–1000 的 x0/y0/x1/y1）。⚠ 现在没有消费方：存它是因为
    # 解析时丢了就只能重新解析才拿得回来，而将来「点引用跳到原文那一页并高亮」
    # 要的正是它
    bbox_json: Mapped[dict[str, int]] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    # 图注。⚠ 它也进块的正文：不进的话「图 1 冷却水回路示意图」这句话在库里
    # 根本不存在，检索不到
    caption: Mapped[str] = mapped_column(
        String(CAPTION_MAX_LENGTH), nullable=False, server_default=""
    )
    object_key: Mapped[str] = mapped_column(
        String(OBJECT_KEY_MAX_LENGTH), nullable=False
    )
    media_type: Mapped[str] = mapped_column(
        String(MEDIA_TYPE_MAX_LENGTH), nullable=False, server_default=""
    )
    byte_size: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    # 内容的 sha256。⚠ 同一份文档里同一张图只留一行，判据是它而不是文件名
    content_hash: Mapped[str] = mapped_column(
        String(HASH_LENGTH), nullable=False
    )

    __table_args__ = (
        CheckConstraint("kind IN ('image', 'table')", name="kind_known"),
        CheckConstraint("ordinal >= 0", name="ordinal_non_negative"),
        CheckConstraint("page IS NULL OR page >= 1", name="page_positive"),
        CheckConstraint("length(object_key) > 0", name="key_present"),
        CheckConstraint("length(content_hash) = 64", name="hash_sized"),
        UniqueConstraint(
            "document_id", "ordinal", name="uq_kb_document_figures_ordinal"
        ),
        # ⚠ 每页都有的图框会被解析出很多份；留重复行的表现是引用里同一张图
        # 贴好几遍
        UniqueConstraint(
            "document_id", "content_hash", name="uq_kb_document_figures_hash"
        ),
        Index("ix_kb_document_figures_document", "document_id"),
    )


class KnowledgeChunkFigure(Base):
    """一块引了一张图。

    ⚠ 没有自己的主键，用 `(chunk_id, figure_id)`：同一块引同一张图两次没有
    意义，而复合主键顺带把它挡掉了。
    """

    __tablename__ = "kb_chunk_figures"

    chunk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kb_chunks.id", ondelete="CASCADE"),
        primary_key=True,
    )
    figure_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kb_document_figures.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # 在这一块里的第几张，从 0 起
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint("ordinal >= 0", name="ordinal_non_negative"),
        # ⚠ 反向那一列也要索引：按 figure_id 反查「哪几块引了这张图」是删图前
        # 的必查，少了它那一查是全表扫描
        Index("ix_kb_chunk_figures_figure", "figure_id"),
    )

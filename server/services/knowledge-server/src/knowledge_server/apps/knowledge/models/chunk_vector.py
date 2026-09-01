"""块向量表：一个块的嵌入结果。

⚠ 这张表存的是**持久真相**，形态是 `BYTEA`（小端 float32），全环境都有。
pgvector 那一路的 `vector(N)` 列与 HNSW 索引是**可选的加速物化**，不由迁移建
（ADR-0034）：目标库装不上扩展时迁移会当场失败，而迁移是 compose 的前置作业——
那意味着整栈起不来。

⚠ 编码钉死成小端 float32。用本机字节序省不了多少，却把「换一台不同字节序的机器
读同一个库」变成一堆读得出来但算不对的数——而那不会报错，只表现为召回忽然全错。

⚠ 双份存储是有意付的代价：换来的是**重建索引不必重新调一遍嵌入 API**。
那是真金白银，而且重建索引这件事一定会发生（换索引参数、修数据、迁库）。
"""

import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from knowledge_server.apps.knowledge.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

EMBEDDING_MODEL_MAX_LENGTH = 128


class KnowledgeChunkVector(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个块的嵌入结果。"""

    __tablename__ = "kb_chunk_vectors"

    # ⚠ 同样冗余存一份 base_id：`BruteForceIndex` 先按库收窄再在应用层算余弦，
    # 少了它就是全表扫描
    base_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kb_bases.id", ondelete="CASCADE"),
        nullable=False,
    )
    chunk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("kb_chunks.id", ondelete="CASCADE"),
        nullable=False,
    )
    embedding: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # 算这条向量的那一路来源与维数。⚠ 必须记下来：库上那两格是「现在用哪一路」，
    # 而行上这两格是「这条当时是哪一路算的」。两者不一致即这条已作废，
    # 而不一致的表现只是「召回忽然变差了」
    embedding_model: Mapped[str] = mapped_column(
        String(EMBEDDING_MODEL_MAX_LENGTH), nullable=False
    )
    dimensions: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint("dimensions > 0", name="dimensions_positive"),
        CheckConstraint("octet_length(embedding) > 0", name="vector_present"),
        # ⚠ 一个块只有一条向量：留两条的话检索会把同一段话召回两次，
        # 而两条里哪一条是新的从外面看不出来
        Index("uq_kb_chunk_vectors_chunk", "chunk_id", unique=True),
        Index("ix_kb_chunk_vectors_base", "base_id"),
    )

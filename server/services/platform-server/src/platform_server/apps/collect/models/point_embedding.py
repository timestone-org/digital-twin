"""点位语义索引的可重建派生表。"""

import uuid

from sqlalchemy import Double, ForeignKeyConstraint, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin
from platform_server.apps.collect.models.base import Base


class CollectPointEmbedding(TimestampMixin, Base):
    """一个点位当前文本与模型身份对应的归一化向量。"""

    __tablename__ = "collect_point_embeddings"

    point_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True
    )
    content_hash: Mapped[str] = mapped_column(Text, nullable=False)
    model_signature: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(
        ARRAY[float](Double()), nullable=True
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["point_id"],
            ["platform.collect_points.id"],
            name="fk_collect_point_embeddings_point_id",
            ondelete="CASCADE",
        ),
    )

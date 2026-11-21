"""来源记录与当前、待摄取文档版本的关系。"""

import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from knowledge_server.orm import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin


class KnowledgeSourceRecord(UuidPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "kb_source_records"

    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "kb_sources.id",
            name="fk_kb_source_records_source",
            ondelete="CASCADE",
        ),
    )
    record_key_hash: Mapped[str] = mapped_column(String(64))
    record_key: Mapped[str] = mapped_column(Text)
    current_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "kb_documents.id",
            name="fk_kb_source_records_current",
            ondelete="SET NULL",
        ),
    )
    pending_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "kb_documents.id",
            name="fk_kb_source_records_pending",
            ondelete="SET NULL",
        ),
    )

    __table_args__ = (
        UniqueConstraint(
            "source_id", "record_key_hash", name="uq_kb_source_records_identity"
        ),
        CheckConstraint(
            "length(record_key_hash) = 64 AND length(record_key) > 0",
            name="record_key",
        ),
        Index("ix_kb_source_records_current_document", "current_document_id"),
        Index("ix_kb_source_records_pending_document", "pending_document_id"),
    )

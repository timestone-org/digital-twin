"""整库重嵌任务及其持久审计。"""

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
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from knowledge_server.orm import Base
from lib.db import UuidPrimaryKeyMixin


class ReembeddingJob(UuidPrimaryKeyMixin, Base):
    """一份可恢复、可取消的重嵌工作。"""

    __tablename__ = "kb_reembeddings"

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    base_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            "knowledge.kb_bases.id",
            ondelete="CASCADE",
            name="fk_reembeddings_base",
        )
    )
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    requested_ip: Mapped[str | None] = mapped_column(Text)
    request_key_hash: Mapped[str] = mapped_column(String(64))
    target_space_id: Mapped[str] = mapped_column(String(64))
    target_model: Mapped[str] = mapped_column(Text)
    target_dimensions: Mapped[int] = mapped_column(Integer)
    expected_revision: Mapped[int] = mapped_column(BigInteger)
    total_documents: Mapped[int] = mapped_column(Integer)
    total_chunks: Mapped[int] = mapped_column(Integer)
    completed_chunks: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0"
    )
    status: Mapped[str] = mapped_column(String(16))
    traceparent: Mapped[str] = mapped_column(String(128))
    lease_token: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    error_message: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        UniqueConstraint(
            "base_id",
            "requested_by",
            "request_key_hash",
            name="uq_kb_reembedding_request",
        ),
        CheckConstraint(
            "status IN ('pending','running','succeeded','failed','cancelled')",
            name=conv("ck_kb_reembedding_status"),
        ),
        CheckConstraint(
            "target_dimensions > 0 AND expected_revision >= 0 AND "
            "total_documents >= 0 AND completed_chunks >= 0 AND "
            "total_chunks >= completed_chunks",
            name=conv("ck_kb_reembedding_progress"),
        ),
        Index(
            "uq_kb_reembeddings_active",
            "base_id",
            unique=True,
            postgresql_where=text("status IN ('pending','running')"),
        ),
        Index(
            "ix_kb_reembeddings_queue",
            "created_at",
            "id",
            postgresql_where=text("status IN ('pending','running')"),
        ),
    )


class ReembeddingAudit(UuidPrimaryKeyMixin, Base):
    """操作历史保留当时的资源身份。"""

    __tablename__ = "kb_reembedding_audits"

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    base_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(16))
    source_ip: Mapped[str | None] = mapped_column(Text)
    prior_space_id: Mapped[str | None] = mapped_column(String(64))
    prior_generation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True)
    )
    trace_id: Mapped[str] = mapped_column(String(32))

    __table_args__ = (
        UniqueConstraint("job_id", "action", name="uq_kb_reembedding_audit"),
        CheckConstraint(
            "action IN ('requested','cancelled','succeeded','failed')",
            name=conv("ck_kb_reembedding_audit_action"),
        ),
    )

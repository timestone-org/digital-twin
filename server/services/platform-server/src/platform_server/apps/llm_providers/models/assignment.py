"""用途分配表：一个用途一行，指向一路供应商上的一个模型。

⚠ 外键 `ON DELETE RESTRICT`：删一路还被指着的供应商，数据库当场拒——放行的话
消费方那一侧解不出端点、静默退回环境变量那一档，而界面上分配还写着它。
"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin
from platform_server.apps.llm_providers.enums import PURPOSE_CODES, sql_values
from platform_server.apps.llm_providers.models.base import Base


class LlmAssignment(TimestampMixin, Base):
    """一个用途此刻走哪一路的哪个模型。"""

    __tablename__ = "llm_assignments"

    purpose: Mapped[str] = mapped_column(Text, primary_key=True)
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.llm_providers.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    model_name: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            f"purpose IN ({sql_values(PURPOSE_CODES)})", name="purpose_known"
        ),
        CheckConstraint("length(model_name) > 0", name="model_name_nonempty"),
    )

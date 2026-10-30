"""平台账号与可信网关声明操作者分开保存的审计。"""

import uuid

from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import UuidPrimaryKeyMixin
from platform_server.apps.modeling.models.base import Base, CreatedAtMixin


class ModelingOperatorAudit(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "modeling_operator_audits"

    account_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    external_operator_id: Mapped[str | None] = mapped_column(Text)
    operation: Mapped[str] = mapped_column(Text)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    command_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("platform.modeling_commands.id", ondelete="RESTRICT"),
        index=True,
    )
    http_status: Mapped[int] = mapped_column(Integer)
    trace_id: Mapped[str] = mapped_column(Text)
    source_ip: Mapped[str | None] = mapped_column(Text)

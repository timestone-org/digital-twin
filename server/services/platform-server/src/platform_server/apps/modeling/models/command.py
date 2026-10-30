"""建模写命令及其成功回执；原始请求与幂等键不持久化。"""

import uuid
from datetime import datetime

from pydantic import JsonValue
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.modeling.models.base import Base


class ModelingCommand(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """同一账号与操作下的一次逻辑写命令。"""

    __tablename__ = "modeling_commands"

    account_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    scope: Mapped[str] = mapped_column(Text)
    key_hash: Mapped[str] = mapped_column(Text)
    request_hash: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(Text)
    http_status: Mapped[int | None] = mapped_column(Integer)
    result_json: Mapped[dict[str, JsonValue] | None] = mapped_column(
        JSONB(none_as_null=True)
    )
    error_json: Mapped[dict[str, JsonValue] | None] = mapped_column(
        JSONB(none_as_null=True)
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    trace_id: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        UniqueConstraint("account_user_id", "scope", "key_hash"),
        CheckConstraint(
            "state IN ('pending', 'succeeded', 'failed')", name="state_valid"
        ),
        CheckConstraint(
            "length(key_hash) = 64 AND length(request_hash) = 64",
            name="hashes_sha256",
        ),
        CheckConstraint(
            "(state = 'pending' AND result_json IS NULL "
            "AND http_status IS NULL AND completed_at IS NULL "
            "AND error_json IS NULL) OR "
            "(state = 'succeeded' AND result_json IS NOT NULL "
            "AND http_status BETWEEN 200 AND 299 AND completed_at IS NOT NULL "
            "AND error_json IS NULL) OR "
            "(state = 'failed' AND result_json IS NULL "
            "AND http_status BETWEEN 400 AND 499 AND completed_at IS NOT NULL "
            "AND error_json IS NOT NULL)",
            name="result_matches_state",
        ),
    )

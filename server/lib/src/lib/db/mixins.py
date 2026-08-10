"""列混入：主键与时间戳。时刻一律 timestamptz 存 UTC。"""

import uuid
from datetime import datetime
from typing import Any, ClassVar

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.utils.ids import uuid7


class UuidPrimaryKeyMixin:
    """UUIDv7 主键：按时间前缀有序，B-tree 插入是追加而非随机页分裂。"""

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid7
    )


class TimestampMixin:
    """创建与更新时刻。`updated_at` 由 ORM 维护。

    ⚠ 必须开 `eager_defaults`：服务端求值的默认值与 `onupdate` 在 flush 后会
    被标记为过期，之后同步访问该属性会触发一次惰性加载——在 asyncio 会话里
    那是 `MissingGreenlet`，且只在「改过这行」的路径上才炸。
    """

    __mapper_args__: ClassVar[dict[str, Any]] = {"eager_defaults": True}

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

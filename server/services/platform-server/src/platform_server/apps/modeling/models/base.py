"""本模块全部表的声明基类，绑定 `platform` schema（ADR-0003 写独占）。

三张执行记录表按 docs/MODELING_DESIGN.md §4 只有创建时刻、没有 `updated_at`，
故它们用这里的两个混入而不是 `lib.db` 的 `TimestampMixin`。
"""

from datetime import datetime
from typing import Any, ClassVar

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import make_declarative_base
from platform_server.settings import DB_SCHEMA

Base = make_declarative_base(DB_SCHEMA)


class EagerDefaultsMixin:
    """带服务端默认值的表。

    ⚠ 必须开 `eager_defaults`：服务端求值的默认值在 flush 之后会被标记为过期，
    之后同步访问该属性会触发一次惰性加载——在 asyncio 会话里那是
    `MissingGreenlet`，且只在「写过这行」的路径上才炸。
    """

    __mapper_args__: ClassVar[dict[str, Any]] = {"eager_defaults": True}


class CreatedAtMixin(EagerDefaultsMixin):
    """只记创建时刻的表。时刻一律 timestamptz 存 UTC。"""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

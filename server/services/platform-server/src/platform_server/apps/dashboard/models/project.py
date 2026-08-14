"""项目表：一组大屏的容器，持有主题与品牌。"""

from typing import Any

from sqlalchemy import CheckConstraint, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.dashboard.models.base import (
    EMPTY_JSON,
    EMPTY_JSON_ARRAY,
    Base,
)


class DashboardProject(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个大屏项目。项目名不唯一：同名的两期工程是现场常态。"""

    __tablename__ = "dashboard_projects"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    theme_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=EMPTY_JSON
    )
    brand_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=EMPTY_JSON
    )
    # 项目自定义主题数组 `{id,name,mode,tokens}[]`。
    # ⚠ 存成 JSONB 数组而不是单开一张表：主题永远整组读、整组写（改一个 token
    # 也要连着 base 一起解析），拆表只会让「读一个项目的主题」多一次 JOIN，
    # 却换不来任何单行更新的好处。删主题时引用它的大屏 resolve 回退，不报错。
    custom_themes_json: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=EMPTY_JSON_ARRAY
    )

    __table_args__ = (
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint(
            "jsonb_typeof(custom_themes_json) = 'array'",
            name="custom_themes_is_array",
        ),
    )

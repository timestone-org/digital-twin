"""项目表：一组大屏的容器，持有主题与品牌。"""

from typing import Any

from sqlalchemy import CheckConstraint, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.dashboard.models.base import EMPTY_JSON, Base


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

    __table_args__ = (
        CheckConstraint("length(name) > 0", name="name_nonempty"),
    )

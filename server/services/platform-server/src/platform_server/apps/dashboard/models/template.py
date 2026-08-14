"""整屏模板表：以一份大屏导出包为载体，全局可见、可实例化到任意项目。

⚠ `source_project_id` 只是出处记录，**刻意不建外键**：模板要活得比来源项目久，
建了外键就会出现「删来源项目，级联把模板一起带走」——而模板本就是拿来跨项目复用的。
"""

import uuid
from typing import Any

from sqlalchemy import CheckConstraint, Index, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.dashboard.models.base import EMPTY_JSON, Base


class DashboardTemplate(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一份整屏模板。`payload_json` 即导出端点的产出整包。"""

    __tablename__ = "dashboard_templates"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 缩略图 data URL，建模板时从源屏拷一份；源屏之后改版不回溯
    thumbnail: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=EMPTY_JSON
    )
    source_project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint(
            "category IS NULL OR length(category) > 0",
            name="category_nonempty",
        ),
        Index("ix_dashboard_templates_category", "category"),
    )

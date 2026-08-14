"""大屏缩略图表：一张屏一行，存客户端截图的 data URL。

⚠ 独立成表而不是给 `dashboards` 加一列：缩略图是几十 KB 的 base64，而列表
查询每次都会把整行读出来——挂在主表上会让「列出 60 张屏」变成拖几 MB。
"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin
from platform_server.apps.dashboard.models.base import Base

# data URL 的长度上限，超了直接拒。1.5 MiB 的 base64 ≈ 1.1 MiB 原图，
# 够一张 JPEG 缩略图用，也拦得住「把原尺寸 PNG 整张塞进来」
MAX_THUMBNAIL_CHARS = 1_572_864


class DashboardThumbnail(TimestampMixin, Base):
    """一张大屏的缩略图。主键即 `dashboard_id`，一屏一张。"""

    __tablename__ = "dashboard_thumbnails"

    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.dashboards.id", ondelete="CASCADE"),
        primary_key=True,
    )
    data: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint(
            f"length(data) BETWEEN 1 AND {MAX_THUMBNAIL_CHARS}",
            name="data_len_in_range",
        ),
    )

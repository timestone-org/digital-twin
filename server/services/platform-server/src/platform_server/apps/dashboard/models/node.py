"""画布节点表：万物皆节点，节点可套节点。

⚠ 这里的 node 是**画布节点**，与采集点位（point）和 OPC UA 地址空间节点
不是一回事，见 docs/DASHBOARD_DESIGN.md §1。
"""

import uuid
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.dashboard.models.base import EMPTY_JSON, Base

MAX_CLIENT_KEY_LENGTH = 128
MAX_MODULE_TYPE_LENGTH = 64


class DashboardNode(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """画布上的一个渲染单元。

    ⚠ 几何四列在库里叫 `x` / `y` / `w` / `h`（对外口径也是这四个名字），
    Python 侧写全名——单字母标识由命名闸拦。

    ⚠ 父子外键是 `(parent_id, dashboard_id)` 的复合键，指向本表的
    `(id, dashboard_id)`：单列外键拦不住「父节点在另一张大屏上」，而那种树
    读出来是断的，画布上表现为整棵子树凭空消失。
    """

    __tablename__ = "dashboard_nodes"

    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.dashboards.id", ondelete="CASCADE"),
        nullable=False,
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    client_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    module_type: Mapped[str] = mapped_column(Text, nullable=False)
    x_px: Mapped[int] = mapped_column("x", Integer, nullable=False)
    y_px: Mapped[int] = mapped_column("y", Integer, nullable=False)
    width_px: Mapped[int] = mapped_column("w", Integer, nullable=False)
    height_px: Mapped[int] = mapped_column("h", Integer, nullable=False)
    z_index: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    is_visible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    config_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=EMPTY_JSON
    )

    __table_args__ = (
        # 撞键 409 而不是先到先得：静默合并会让第二个节点被并进第一个
        UniqueConstraint(
            "dashboard_id",
            "client_key",
            name="uq_dashboard_nodes_dashboard_id_client_key",
        ),
        UniqueConstraint(
            "id", "dashboard_id", name="uq_dashboard_nodes_id_dashboard_id"
        ),
        ForeignKeyConstraint(
            ["parent_id", "dashboard_id"],
            [
                "platform.dashboard_nodes.id",
                "platform.dashboard_nodes.dashboard_id",
            ],
            name="fk_dashboard_nodes_parent_id",
            ondelete="CASCADE",
        ),
        CheckConstraint("w > 0 AND h > 0", name="size_positive"),
        CheckConstraint(
            "parent_id IS NULL OR parent_id <> id", name="no_self_parent"
        ),
        CheckConstraint(
            f"length(module_type) BETWEEN 1 AND {MAX_MODULE_TYPE_LENGTH}",
            name="module_type_sized",
        ),
        CheckConstraint(
            "client_key IS NULL OR "
            f"length(client_key) BETWEEN 1 AND {MAX_CLIENT_KEY_LENGTH}",
            name="client_key_sized",
        ),
        Index("ix_dashboard_nodes_dashboard_id", "dashboard_id"),
        Index("ix_dashboard_nodes_parent_id", "parent_id"),
    )

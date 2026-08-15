"""发布配置表：一个模型往哪台 OPC UA 实例、哪个区域点位下发。

组合各自的时间点位在 `ac_model_set_binding.py`。
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin
from platform_server.apps.hvac.models.base import Base
from platform_server.apps.hvac.publications import PUBLISH_STATUS_VALUES


class AcModelPublication(TimestampMixin, Base):
    """一个模型的预测下发配置。

    ⚠ `opcua_instance_id` 与 `recommendation_node_id` **不是外键，也不可能是**：
    它们是 opcua-server 自己库里的行，跨 schema 禁外键（ADR-0003）。代价是
    实例或节点被删掉时这里会留下悬空的 id——处置在服务层：不清绑定、不停发布，
    把这一拍记成失败并把原因写进 `last_error`（AC_PUBLISH_DESIGN.md §5.5）。
    自动清掉悬空绑定是错的：opcua-server 短暂不可达与「节点真的被删了」在这一层
    分不开，而自动清掉的后果是人回来发现配置空了，还以为自己没配过。

    ⚠ 行存在 **⟺** 已经选定实例。没选实例就没有这一行，不留一行半空的。
    """

    __tablename__ = "hvac_ac_model_publications"

    # 一个模型至多一份发布配置，故直接拿它做主键
    model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_ac_models.id", ondelete="CASCADE"),
        primary_key=True,
    )
    opcua_instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    recommendation_node_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # 节点标识的快照，只为页面与日志好读。⚠ 判等一律用 id
    recommendation_identifier: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    # ---- 最近一拍的去向。⚠ 这是这个功能的心跳，页面据此报「多久没发了」 ----
    last_published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        # 组合绑定靠复合外键指回这里，以此保证两张表说的是同一台实例。
        # ⚠ 与主键重复是**故意的**：复合外键需要一个匹配的唯一约束当靶子
        UniqueConstraint(
            "model_id",
            "opcua_instance_id",
            name="uq_hvac_ac_model_publications_model_instance",
        ),
        # 一个点位只能有一个来源。两个模型同时往一个点位写，上位机读到的值会
        # 在两者之间反复横跳，而两边的日志都报成功。
        # ⚠ 必须由数据库挡：绕开应用直接改库同样能造出双写，而它看起来与
        # 正常配置毫无区别
        UniqueConstraint(
            "opcua_instance_id",
            "recommendation_node_id",
            name="uq_hvac_ac_model_publications_recommendation_node",
        ),
        CheckConstraint(
            f"last_status IS NULL OR last_status IN ({PUBLISH_STATUS_VALUES})",
            name="last_status_known",
        ),
        # 失败必须留人话原因，不许静默失败
        CheckConstraint(
            "last_status <> 'failed' OR last_error IS NOT NULL",
            name="failed_has_error",
        ),
        # 标识快照与节点 id 同生同灭：只留一个的行会让页面显示一个
        # 早已解绑的点位名
        CheckConstraint(
            "(recommendation_node_id IS NULL) = "
            "(recommendation_identifier IS NULL)",
            name="recommendation_pair_complete",
        ),
    )

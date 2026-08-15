"""组合时间点位表：一个服务组合的预测达标分钟数写进哪个数字点位。"""

import uuid

from sqlalchemy import (
    ForeignKeyConstraint,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.hvac.models.base import Base


class AcModelSetBinding(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个服务组合 → 一个数字点位。

    ⚠ 组合用 `set_key`（serial 升序用 `+` 连接）而**不存数组**：数组作唯一键
    要靠排序约定，而 `set_key` 已经是工件里、指标里、页面上到处都在用的那把
    钥匙，再造一把只会有两把不同步的钥匙。

    ⚠ `set_key` 落空（模型改了 `serving_sets`）时**留着不删**：改组合是就地
    重汇总不重训，改回去时绑定还在。页面把落空的那些单列一段。
    """

    __tablename__ = "hvac_ac_model_set_bindings"

    model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # ⚠ 冗余一列实例 id，只为让「一个点位一个来源」那条唯一约束成立——
    # 它跨了两张表，光靠发布配置上的那一列建不出索引。与发布配置的一致性
    # 由下面的复合外键保证，不是靠应用记得同步
    opcua_instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    set_key: Mapped[str] = mapped_column(Text, nullable=False)
    node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # 节点标识的快照，只为页面与日志好读。⚠ 判等一律用 id
    identifier: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        # 复合外键指回发布配置：两张表必须说的是同一台实例。
        # ⚠ 不带 ON UPDATE CASCADE：换实例之后这些 node_id 属于**旧**实例，
        # 跟着改过来只会把一批张冠李戴的绑定悄悄留下。换实例必须先清绑定，
        # 而整份保存的 PUT 正是这么做的
        ForeignKeyConstraint(
            ["model_id", "opcua_instance_id"],
            [
                "platform.hvac_ac_model_publications.model_id",
                "platform.hvac_ac_model_publications.opcua_instance_id",
            ],
            ondelete="CASCADE",
            name="fk_hvac_ac_model_set_bindings_publication",
        ),
        UniqueConstraint(
            "model_id",
            "set_key",
            name="uq_hvac_ac_model_set_bindings_model_set",
        ),
        # 一个点位只能有一个来源，理由同发布配置上的那一条
        UniqueConstraint(
            "opcua_instance_id",
            "node_id",
            name="uq_hvac_ac_model_set_bindings_node",
        ),
    )

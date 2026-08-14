"""绑定表：把节点的一个数据槽接到一个数据来源上。"""

import uuid
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.dashboard.models.base import Base
from platform_server.apps.dashboard.source_kinds import (
    SOURCE_KINDS,
    sql_values,
)

MAX_FIELD_KEY_LENGTH = 128
MAX_NODE_KEY_LENGTH = 256

_SOURCE_KIND_VALUES = sql_values(SOURCE_KINDS)


class DashboardBinding(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条绑定。

    ⚠ `node_id` 是**画布节点**的 id，`node_key` 是**采集点位**的身份
    `{source_id}:{point_code}`——两个 node 不是一回事。
    """

    __tablename__ = "dashboard_bindings"

    node_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.dashboard_nodes.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_key: Mapped[str] = mapped_column(Text, nullable=False)
    source_kind: Mapped[str] = mapped_column(Text, nullable=False)
    node_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    static_value_json: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    compute_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    detail_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    transform_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )

    __table_args__ = (
        # 同一个槽被绑两次时，取哪个就只看行序了
        UniqueConstraint(
            "node_id",
            "field_key",
            name="uq_dashboard_bindings_node_id_field_key",
        ),
        CheckConstraint(
            f"source_kind IN ({_SOURCE_KIND_VALUES})", name="source_kind_known"
        ),
        CheckConstraint(
            f"length(field_key) BETWEEN 1 AND {MAX_FIELD_KEY_LENGTH}",
            name="field_key_sized",
        ),
        CheckConstraint(
            "node_key IS NULL OR "
            f"length(node_key) BETWEEN 1 AND {MAX_NODE_KEY_LENGTH}",
            name="node_key_sized",
        ),
        # 实时来源必须指向点位，否则这条绑定永远产不出数据
        CheckConstraint(
            "source_kind <> 'opcua' OR node_key IS NOT NULL",
            name="opcua_has_node_key",
        ),
        Index("ix_dashboard_bindings_node_id", "node_id"),
    )

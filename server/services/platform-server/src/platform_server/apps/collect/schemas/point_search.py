"""点位混合检索的有限结果与降级状态。"""

import uuid
from typing import Literal

from pydantic import Field

from platform_server.apps.collect.schemas.common import OutputModel


class PointMatchOut(OutputModel):
    """可绑定的点位候选，不含连接凭据或现场地址。"""

    id: uuid.UUID
    source_id: uuid.UUID
    node_key: str
    code: str
    name: str
    description: str | None
    unit: str | None
    source_name: str
    is_enabled: bool
    is_exact: bool
    score: float


class PointMatchesOut(OutputModel):
    """候选及当前语义索引的可用程度。"""

    items: list[PointMatchOut]
    mode: Literal["hybrid", "keyword"]
    pending_count: int = Field(ge=0)
    note: str | None = None

"""平台点位语义检索响应的消费边界，与平台 OpenAPI 对齐。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PointMatch(BaseModel):
    """保留平台排序所需的候选身份和业务说明。"""

    model_config = ConfigDict(strict=True)

    id: str
    node_key: str
    code: str
    name: str
    description: str | None
    source_id: str
    source_name: str
    source_protocol: Literal["modbus_tcp", "opcua"]
    unit: str | None
    is_enabled: bool
    is_exact: bool
    score: float


class PointMatches(BaseModel):
    """语义候选及检索可用状态。"""

    model_config = ConfigDict(strict=True)

    items: list[PointMatch]
    mode: Literal["hybrid", "keyword"]
    pending_count: int = Field(ge=0)
    note: str | None = None

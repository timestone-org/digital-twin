"""空调面的入参与出参。"""

import uuid
from dataclasses import dataclass

from pydantic import Field

from platform_server.apps.hvac.schemas.common import (
    InputModel,
    Label,
    OutputModel,
    RoomRef,
    Utc,
    WorkshopRef,
)

# 一次改派的上限，与分页上限同值：批量入参无上限时一个大数组就是一次 OOM
MAX_RELOCATE_BATCH = 200


@dataclass(frozen=True)
class AcUnitFilters:
    """空调列表的过滤条件。

    可过滤的字段是白名单，不是把 query 参数拼进 SQL——那既是注入面，也是
    「不小心对无索引列过滤」的入口。
    """

    keyword: str | None = None
    room_id: uuid.UUID | None = None
    workshop_id: uuid.UUID | None = None


class AcUnitOut(OutputModel):
    """空调详情。所属位置逐级展开，列表页不必再为每台空调回查一次。"""

    id: uuid.UUID
    serial: str
    name: str
    room: RoomRef
    workshop: WorkshopRef
    created_at: Utc
    updated_at: Utc


class AcUnitCreateIn(InputModel):
    """建空调。房间必填——空调不允许处于没有归属的中间态。"""

    serial: Label
    name: Label
    room_id: uuid.UUID


class AcUnitUpdateIn(InputModel):
    """改空调。缺省的字段表示本次不涉及。"""

    serial: Label | None = None
    name: Label | None = None
    room_id: uuid.UUID | None = None


class AcUnitRelocateIn(InputModel):
    """把一批空调改派到同一个房间。空间配置页的批量摆位走这条。"""

    ac_unit_ids: list[uuid.UUID] = Field(
        min_length=1, max_length=MAX_RELOCATE_BATCH
    )
    room_id: uuid.UUID


class AcUnitRelocateOut(OutputModel):
    """改派结果。`moved_count` 只数真的换了房间的那些。"""

    moved_count: int
    room: RoomRef
    workshop: WorkshopRef

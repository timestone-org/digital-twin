"""房间面的入参与出参。"""

import uuid

from platform_server.apps.hvac.schemas.common import (
    InputModel,
    Label,
    OutputModel,
    Utc,
    WorkshopRef,
)


class RoomOut(OutputModel):
    """房间详情。`ac_unit_count` 是这个热力空间里的空调台数。"""

    id: uuid.UUID
    name: str
    workshop: WorkshopRef
    ac_unit_count: int
    created_at: Utc
    updated_at: Utc


class RoomCreateIn(InputModel):
    """建房间。房间必定属于某个车间。"""

    workshop_id: uuid.UUID
    name: Label


class RoomUpdateIn(InputModel):
    """改房间。给了 `workshop_id` 就是把整间房连同里面的空调挪到别的车间。"""

    name: Label | None = None
    workshop_id: uuid.UUID | None = None

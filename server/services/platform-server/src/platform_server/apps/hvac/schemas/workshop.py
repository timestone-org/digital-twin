"""车间面的入参与出参。"""

import uuid

from platform_server.apps.hvac.schemas.common import (
    InputModel,
    Label,
    OutputModel,
    Utc,
)


class WorkshopOut(OutputModel):
    """车间详情。两个计数用于列表页一眼看出规模，不必再逐个点进去。"""

    id: uuid.UUID
    name: str
    room_count: int
    ac_unit_count: int
    created_at: Utc
    updated_at: Utc


class WorkshopCreateIn(InputModel):
    """建车间。"""

    name: Label


class WorkshopUpdateIn(InputModel):
    """改车间。缺省的字段表示本次不涉及。"""

    name: Label | None = None

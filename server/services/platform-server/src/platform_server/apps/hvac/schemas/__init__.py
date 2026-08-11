"""空调与空间模块的对外模型。任何层都可读。"""

from platform_server.apps.hvac.schemas.ac_unit import (
    MAX_RELOCATE_BATCH,
    AcUnitCreateIn,
    AcUnitFilters,
    AcUnitOut,
    AcUnitRelocateIn,
    AcUnitRelocateOut,
    AcUnitUpdateIn,
)
from platform_server.apps.hvac.schemas.common import (
    InputModel,
    Label,
    OutputModel,
    RoomRef,
    Utc,
    WorkshopRef,
)
from platform_server.apps.hvac.schemas.room import (
    RoomCreateIn,
    RoomOut,
    RoomUpdateIn,
)
from platform_server.apps.hvac.schemas.workshop import (
    WorkshopCreateIn,
    WorkshopOut,
    WorkshopUpdateIn,
)

__all__ = [
    "MAX_RELOCATE_BATCH",
    "AcUnitCreateIn",
    "AcUnitFilters",
    "AcUnitOut",
    "AcUnitRelocateIn",
    "AcUnitRelocateOut",
    "AcUnitUpdateIn",
    "InputModel",
    "Label",
    "OutputModel",
    "RoomCreateIn",
    "RoomOut",
    "RoomRef",
    "RoomUpdateIn",
    "Utc",
    "WorkshopCreateIn",
    "WorkshopOut",
    "WorkshopRef",
    "WorkshopUpdateIn",
]

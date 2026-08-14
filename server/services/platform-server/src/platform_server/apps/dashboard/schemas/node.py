"""画布节点面的入参与出参。

⚠ 几何四列对外叫 `x` / `y` / `w` / `h`（与前端契约逐字对应），Python 侧写全名，
两者由别名连起来。
"""

import uuid
from typing import Any, ClassVar

from pydantic import Field

from platform_server.apps.dashboard.schemas.binding import (
    BindingCreateIn,
    BindingOut,
)
from platform_server.apps.dashboard.schemas.common import (
    InputModel,
    ModuleType,
    OutputModel,
    StableKey,
    UpdateModel,
    Utc,
)

# 设计坐标系的边长上限：再大就不是一张屏而是一次误输入
MAX_DESIGN_EXTENT_PX = 100_000


class NodeOut(OutputModel):
    """一个画布节点。id 一经创建永不改变，整树替换也按 id 三路比对。"""

    id: uuid.UUID
    dashboard_id: uuid.UUID
    parent_id: uuid.UUID | None
    client_key: str | None
    module_type: str
    x_px: int = Field(serialization_alias="x")
    y_px: int = Field(serialization_alias="y")
    width_px: int = Field(serialization_alias="w")
    height_px: int = Field(serialization_alias="h")
    z_index: int
    is_visible: bool
    config_json: dict[str, Any]
    created_at: Utc
    updated_at: Utc
    bindings: list[BindingOut] = Field(default_factory=list[BindingOut])


class NodeCreateIn(InputModel):
    """新增一个节点。"""

    parent_id: uuid.UUID | None = None
    client_key: StableKey | None = None
    module_type: ModuleType
    x_px: int = Field(
        validation_alias="x", ge=-MAX_DESIGN_EXTENT_PX, le=MAX_DESIGN_EXTENT_PX
    )
    y_px: int = Field(
        validation_alias="y", ge=-MAX_DESIGN_EXTENT_PX, le=MAX_DESIGN_EXTENT_PX
    )
    width_px: int = Field(validation_alias="w", ge=1, le=MAX_DESIGN_EXTENT_PX)
    height_px: int = Field(validation_alias="h", ge=1, le=MAX_DESIGN_EXTENT_PX)
    z_index: int = 0
    is_visible: bool = True
    config_json: dict[str, Any] = Field(default_factory=dict[str, Any])


class NodeUpdateIn(UpdateModel):
    """改节点。缺省的字段表示本次不涉及；`parent_id: null` 表示升为顶层。"""

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {
            "module_type",
            "x_px",
            "y_px",
            "width_px",
            "height_px",
            "z_index",
            "is_visible",
            "config_json",
        }
    )

    parent_id: uuid.UUID | None = None
    client_key: StableKey | None = None
    module_type: ModuleType | None = None
    x_px: int | None = Field(
        default=None,
        validation_alias="x",
        ge=-MAX_DESIGN_EXTENT_PX,
        le=MAX_DESIGN_EXTENT_PX,
    )
    y_px: int | None = Field(
        default=None,
        validation_alias="y",
        ge=-MAX_DESIGN_EXTENT_PX,
        le=MAX_DESIGN_EXTENT_PX,
    )
    width_px: int | None = Field(
        default=None, validation_alias="w", ge=1, le=MAX_DESIGN_EXTENT_PX
    )
    height_px: int | None = Field(
        default=None, validation_alias="h", ge=1, le=MAX_DESIGN_EXTENT_PX
    )
    z_index: int | None = None
    is_visible: bool | None = None
    config_json: dict[str, Any] | None = None


class LayoutNodeIn(NodeCreateIn):
    """整树替换里的一个节点。

    `id` 缺省表示新增；给了就按它比对，服务端不重新生成 id。新节点也可以自带
    id，这样同一次替换里的子节点才写得出 `parent_id`。
    """

    id: uuid.UUID | None = None
    bindings: list[BindingCreateIn] = Field(
        default_factory=list[BindingCreateIn]
    )

"""发布面的入参与出参：公开状态，以及匿名可见的那份大屏。

匿名面逐字段列全而不是继承 `DashboardOut`——继承会让日后加进管理面的任何
内部字段自动泄漏到公开链接上，而这件事不会有任何提示。
"""

import uuid
from typing import Any

from pydantic import Field

from platform_server.apps.dashboard.schemas.common import OutputModel, Utc
from platform_server.apps.dashboard.source_kinds import SourceKind


class DashboardShareOut(OutputModel):
    """一次发布或取消发布之后的公开状态。

    ⚠ `public_token` 只在这一处回给调用者：它就是公开链接本身，列表面、
    详情面与日志都拿不到它。
    """

    dashboard_id: uuid.UUID
    is_public: bool
    public_token: str | None
    updated_at: Utc


class PublicBindingOut(OutputModel):
    """公开面的一条绑定。不带 `node_id`——它已经嵌在所属节点下面了。"""

    id: uuid.UUID
    field_key: str
    source_kind: SourceKind
    node_key: str | None
    static_value_json: Any = None
    compute_json: dict[str, Any] | None
    detail_json: dict[str, Any] | None
    transform_json: dict[str, Any] | None


class PublicNodeOut(OutputModel):
    """公开面的一个画布节点。只留渲染要的列。

    ⚠ 几何四列对外仍叫 `x` / `y` / `w` / `h`，与管理面逐字对应——两套名字会
    让前端为公开页另写一套渲染。
    """

    id: uuid.UUID
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
    bindings: list[PublicBindingOut] = Field(
        default_factory=list[PublicBindingOut]
    )


class PublicDashboardOut(OutputModel):
    """按公开令牌读到的一张大屏。

    ⚠ 没有 `id`、没有 `project_id`、没有创建人：公开链接的持有者只该拿到
    渲染这张屏要的东西，拿不到它在库里的位置。

    ⚠ 也没有 `row_version`：那是乐观锁的计数器，公开面要的「变没变」由
    `updated_at` 回答。少发一个字段以后还能补，发出去了就删不掉。
    """

    name: str
    description: str | None
    design_width: int
    design_height: int
    schema_version: int
    theme_json: dict[str, Any]
    chrome_json: dict[str, Any]
    updated_at: Utc
    nodes: list[PublicNodeOut] = Field(default_factory=list[PublicNodeOut])

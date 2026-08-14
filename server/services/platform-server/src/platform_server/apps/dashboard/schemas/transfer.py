"""大屏复制、导出与导入的入参与出参。

⚠ 导出包里不许出现任何 id（大屏/节点/绑定/项目），父子关系一律用 `client_key`
表达：带 id 的包导回同一个库，会让「导入」变成悄悄改掉源屏。
"""

import uuid
from typing import Any

from pydantic import Field

from platform_server.apps.dashboard.schemas.common import (
    FieldKey,
    InputModel,
    Label,
    ModuleType,
    NodeKey,
    OutputModel,
    StableKey,
)
from platform_server.apps.dashboard.schemas.dashboard import (
    MAX_DESIGN_EXTENT_PX,
    MAX_NODES_PER_DASHBOARD,
    MIN_DESIGN_EXTENT_PX,
    DashboardOut,
)
from platform_server.apps.dashboard.schemas.node import (
    MAX_DESIGN_EXTENT_PX as MAX_NODE_EXTENT_PX,
)
from platform_server.apps.dashboard.source_kinds import SourceKind

MAX_DESCRIPTION_LENGTH = 1024
# 复制出来的屏的缺省名后缀，项目内不去重
COPY_NAME_SUFFIX = " 副本"


class ExportBindingIn(InputModel):
    """导出包里的一条绑定。没有 id——id 属于源库，跟着包走就成了改源屏。"""

    field_key: FieldKey
    source_kind: SourceKind
    node_key: NodeKey | None = None
    static_value_json: Any = None
    compute_json: dict[str, Any] | None = None
    detail_json: dict[str, Any] | None = None
    transform_json: dict[str, Any] | None = None


class ExportNodeIn(InputModel):
    """导出包里的一个节点。

    ⚠ `client_key` 在包里是必填且唯一的：它同时是这个节点的身份与父子引用的
    落点，源库里为空的节点由导出侧补一个稳定值。
    """

    client_key: StableKey
    parent_key: StableKey | None = None
    module_type: ModuleType
    # ⚠ 两个别名都要给：只给 serialization_alias 的话导出的包再导回来会因为
    # 缺 `x_px` 而校验失败，而写成 `alias` 又会让 pyright 认不出按字段名构造
    x_px: int = Field(
        validation_alias="x",
        serialization_alias="x",
        ge=-MAX_NODE_EXTENT_PX,
        le=MAX_NODE_EXTENT_PX,
    )
    y_px: int = Field(
        validation_alias="y",
        serialization_alias="y",
        ge=-MAX_NODE_EXTENT_PX,
        le=MAX_NODE_EXTENT_PX,
    )
    width_px: int = Field(
        validation_alias="w",
        serialization_alias="w",
        ge=1,
        le=MAX_NODE_EXTENT_PX,
    )
    height_px: int = Field(
        validation_alias="h",
        serialization_alias="h",
        ge=1,
        le=MAX_NODE_EXTENT_PX,
    )
    z_index: int = 0
    is_visible: bool = True
    config_json: dict[str, Any] = Field(default_factory=dict[str, Any])
    bindings: list[ExportBindingIn] = Field(
        default_factory=list[ExportBindingIn]
    )


class DashboardExportIn(InputModel):
    """一份可移植的大屏文档，导入面按它收货。"""

    schema_version: int = Field(ge=1)
    name: Label
    description: str | None = Field(
        default=None, max_length=MAX_DESCRIPTION_LENGTH
    )
    design_width: int = Field(ge=MIN_DESIGN_EXTENT_PX, le=MAX_DESIGN_EXTENT_PX)
    design_height: int = Field(ge=MIN_DESIGN_EXTENT_PX, le=MAX_DESIGN_EXTENT_PX)
    theme_json: dict[str, Any] = Field(default_factory=dict[str, Any])
    chrome_json: dict[str, Any] = Field(default_factory=dict[str, Any])
    nodes: list[ExportNodeIn] = Field(
        default_factory=list[ExportNodeIn], max_length=MAX_NODES_PER_DASHBOARD
    )


class DashboardExportOut(DashboardExportIn):
    """`:export` 的出参。与导入入参同形，导出的包可原样导回。"""


class DuplicateDashboardIn(InputModel):
    """复制一张大屏。缺省名 = 源名加后缀，缺省项目 = 源项目。"""

    new_name: Label | None = None
    target_project_id: uuid.UUID | None = None


class DashboardImportIn(InputModel):
    """导入一份大屏文档。给了 `target_dashboard_id` 就是覆盖既有屏。"""

    project_id: uuid.UUID
    payload: DashboardExportIn
    new_name: Label | None = None
    target_dashboard_id: uuid.UUID | None = None


class UnresolvedBindingOut(OutputModel):
    """一条指向本部署不存在的点位的绑定。它照常入库，只是取不到数。"""

    node_key: str
    field_key: str
    source_kind: SourceKind
    reason: str


class DashboardImportOut(DashboardOut):
    """导入结果。

    ⚠ `unresolved_bindings` 非空表示这张屏打得开、但列出来的槽产不出数据；
    静默丢掉它们会让用户以为导进来的是一张能用的屏。
    """

    unresolved_bindings: list[UnresolvedBindingOut] = Field(
        default_factory=list[UnresolvedBindingOut]
    )

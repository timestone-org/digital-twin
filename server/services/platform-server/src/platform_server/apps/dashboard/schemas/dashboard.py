"""大屏面的入参与出参。"""

import uuid
from typing import Any, ClassVar

from pydantic import Field

from platform_server.apps.dashboard.models.dashboard import (
    DEFAULT_DESIGN_HEIGHT,
    DEFAULT_DESIGN_WIDTH,
)
from platform_server.apps.dashboard.schemas.common import (
    InputModel,
    Label,
    OutputModel,
    UpdateModel,
    Utc,
)
from platform_server.apps.dashboard.schemas.node import (
    LayoutNodeIn,
    NodeOut,
)

MIN_DESIGN_EXTENT_PX = 320
MAX_DESIGN_EXTENT_PX = 20_000
# 一张屏的节点上限：再多就不是一张大屏，而是一次误生成
MAX_NODES_PER_DASHBOARD = 2000


class DashboardSummaryOut(OutputModel):
    """列表页的大屏条目：不带节点树。"""

    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: str | None
    design_width: int
    design_height: int
    row_version: int
    schema_version: int
    is_public: bool
    node_count: int
    created_at: Utc
    updated_at: Utc


class DashboardOut(DashboardSummaryOut):
    """加载一张大屏。运行时与编辑器共用同一份。

    `nodes` 是**扁平**一维数组，树由 `parent_id` 重建；顺序钉死在
    `(parent_id, z_index, id)`，两次读取逐字节相同。
    """

    theme_json: dict[str, Any]
    chrome_json: dict[str, Any]
    nodes: list[NodeOut] = Field(default_factory=list[NodeOut])


class DashboardCreateIn(InputModel):
    """建大屏。"""

    project_id: uuid.UUID
    name: Label
    description: str | None = Field(default=None, max_length=1024)
    design_width: int = Field(
        default=DEFAULT_DESIGN_WIDTH,
        ge=MIN_DESIGN_EXTENT_PX,
        le=MAX_DESIGN_EXTENT_PX,
    )
    design_height: int = Field(
        default=DEFAULT_DESIGN_HEIGHT,
        ge=MIN_DESIGN_EXTENT_PX,
        le=MAX_DESIGN_EXTENT_PX,
    )
    theme_json: dict[str, Any] = Field(default_factory=dict[str, Any])
    chrome_json: dict[str, Any] = Field(default_factory=dict[str, Any])


class DashboardUpdateIn(UpdateModel):
    """改大屏元数据。节点树不走这里，走 `:replace-layout` 或逐节点端点。"""

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {
            "name",
            "design_width",
            "design_height",
            "theme_json",
            "chrome_json",
            "schema_version",
        }
    )

    name: Label | None = None
    description: str | None = Field(default=None, max_length=1024)
    design_width: int | None = Field(
        default=None, ge=MIN_DESIGN_EXTENT_PX, le=MAX_DESIGN_EXTENT_PX
    )
    design_height: int | None = Field(
        default=None, ge=MIN_DESIGN_EXTENT_PX, le=MAX_DESIGN_EXTENT_PX
    )
    theme_json: dict[str, Any] | None = None
    chrome_json: dict[str, Any] | None = None
    schema_version: int | None = Field(default=None, ge=1)


class ReplaceLayoutIn(InputModel):
    """整树替换。

    ⚠ `expected_version` 必填：不带版本断言的整树替换就是「最后写入者获胜」，
    人与 Agent 同时在场时一方的改动会被静默抹掉（ADR-0012 二）。
    """

    expected_version: int = Field(ge=1)
    schema_version: int | None = Field(default=None, ge=1)
    nodes: list[LayoutNodeIn] = Field(max_length=MAX_NODES_PER_DASHBOARD)


class LayoutIssueOut(OutputModel):
    """自检发现的一处悬空引用。`field` 用点号与方括号表达路径。"""

    field: str
    code: str
    message: str


class ValidationReportOut(OutputModel):
    """一次自检的结果。`is_valid` 为假时 `issues` 列全部问题，不止第一条。"""

    dashboard_id: uuid.UUID
    is_valid: bool
    issues: list[LayoutIssueOut]

"""运行面的入参与出参。"""

import uuid
from typing import Any

from pydantic import Field

from platform_server.apps.modeling.protocols import (
    NodeRunStatus,
    RunStatus,
    RunTrigger,
)
from platform_server.apps.modeling.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph


class RunStartIn(InputModel):
    """发起一次运行。当前没有可调的参数，留着是为了以后加而不破坏契约。"""

    trigger: RunTrigger = "manual"


class NodeRunSummaryOut(OutputModel):
    """一个节点在这次运行里的状态，**不含结果摘要**。

    ⚠ 列表接口不带摘要：一次运行的全部摘要合起来可以到 MB 级，而前端每秒轮询
    的正是这个接口。
    """

    node_id: str
    operator: str
    alias: str | None
    ordinal: int
    status: NodeRunStatus
    duration_ms: int | None
    has_preview: bool
    error_text: str | None


class NodeRunOut(NodeRunSummaryOut):
    """单个节点的详情，含结果摘要。按节点懒加载。"""

    preview: dict[str, Any] = Field(default_factory=dict[str, Any])
    is_preview_truncated: bool


class RunSummaryOut(OutputModel):
    """运行列表里的一条。"""

    id: uuid.UUID
    pipeline_id: uuid.UUID
    status: RunStatus
    trigger: RunTrigger
    started_at: Utc | None
    finished_at: Utc | None
    duration_ms: int | None
    row_count: int | None
    is_source_truncated: bool
    error_text: str | None
    created_by_name: str | None
    created_at: Utc


class RunOut(RunSummaryOut):
    """运行详情：状态 + 节点清单 + 当时那份图。

    ⚠ 带的是**运行时冻结的快照**而不是流水线现在的图：不然历史运行的界面会
    显示当前的参数、配着当时的结果（docs/MODELING_DESIGN.md D6）。
    """

    graph: PipelineGraph
    nodes: list[NodeRunSummaryOut] = Field(
        default_factory=list[NodeRunSummaryOut]
    )

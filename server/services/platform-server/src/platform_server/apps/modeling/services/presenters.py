"""ORM 行 → 对外模型。ORM 实例绝不直接返给 HTTP 层。

⚠ 三处 `cast` 是**库→领域的边界**：状态与触发来源在库里是 `Text` + CHECK
约束，取值集合与这边的 Literal 同源（`protocols.py`），CHECK 保证了库里不可能
有第四种值。两侧漂了由契约测试盯着（docs/MODELING_DESIGN.md §4）。
"""

from typing import Any, cast

from platform_server.apps.modeling.models import (
    ModelingNodeRun,
    ModelingPipeline,
    ModelingRun,
)
from platform_server.apps.modeling.protocols import (
    NodeRunStatus,
    RunStatus,
    RunTrigger,
)
from platform_server.apps.modeling.schemas import (
    NodeRunOut,
    NodeRunSummaryOut,
    PipelineGraph,
    PipelineOut,
    PipelineSummaryOut,
    RunOut,
    RunSummaryOut,
)


def graph_of(raw: dict[str, Any]) -> PipelineGraph:
    """把落库的图还原成线形。认不出来的形状退化成空图。

    ⚠ 退化成空图而不是抛：一条存量流水线的图坏掉时，用户至少还能打开页面把它
    删掉或重存；抛的话整个列表页都打不开。
    Args: raw。
    """
    try:
        return PipelineGraph.model_validate(raw)
    except ValueError:
        return PipelineGraph()


def to_pipeline_summary(row: ModelingPipeline) -> PipelineSummaryOut:
    """流水线列表里的一条。

    Args: row。
    """
    graph = graph_of(row.graph_json)
    return PipelineSummaryOut(
        id=row.id,
        code=row.code,
        name=row.name,
        description=row.description,
        node_count=len(graph.nodes),
        source_table_codes=[str(item) for item in row.source_table_codes],
        created_by_name=row.created_by_name,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def to_pipeline_out(row: ModelingPipeline) -> PipelineOut:
    """流水线详情，带整张图。

    Args: row。
    """
    summary = to_pipeline_summary(row)
    return PipelineOut(**summary.model_dump(), graph=graph_of(row.graph_json))


def to_run_summary(row: ModelingRun) -> RunSummaryOut:
    """运行列表里的一条。

    Args: row。
    """
    return RunSummaryOut(
        id=row.id,
        pipeline_id=row.pipeline_id,
        status=_run_status(row.status),
        trigger=_trigger(row.trigger),
        started_at=row.started_at,
        finished_at=row.finished_at,
        duration_ms=row.duration_ms,
        row_count=row.row_count,
        is_source_truncated=row.source_truncated,
        is_keeping_frames=row.is_keeping_frames,
        error_text=row.error_text,
        created_by_name=row.created_by_name,
        created_at=row.created_at,
    )


def to_run_out(row: ModelingRun, nodes: list[ModelingNodeRun]) -> RunOut:
    """运行详情。

    ⚠ 图取的是**运行时冻结的快照**，不是流水线现在那份：不然历史运行的界面会
    显示当前的参数、配着当时的结果（docs/MODELING_DESIGN.md D6）。
    Args: row, nodes。
    """
    summary = to_run_summary(row)
    return RunOut(
        **summary.model_dump(),
        graph=graph_of(row.graph_snapshot),
        nodes=[to_node_summary(node) for node in nodes],
    )


def to_node_summary(row: ModelingNodeRun) -> NodeRunSummaryOut:
    """节点状态，不含结果摘要。

    Args: row。
    """
    return NodeRunSummaryOut(
        node_id=row.node_id,
        operator=row.operator,
        alias=row.alias,
        ordinal=row.ordinal,
        status=_node_status(row.status),
        duration_ms=row.duration_ms,
        has_preview=bool(row.preview_json),
        error_text=row.error_text,
    )


def to_node_out(row: ModelingNodeRun) -> NodeRunOut:
    """单个节点的详情，含结果摘要。

    Args: row。
    """
    summary = to_node_summary(row)
    return NodeRunOut(
        **summary.model_dump(),
        preview=row.preview_json or {},
        is_preview_truncated=row.preview_truncated,
        exported_ports=sorted(row.frames_json or {}),
    )


def _run_status(raw: str) -> RunStatus:
    return cast("RunStatus", raw)


def _node_status(raw: str) -> NodeRunStatus:
    return cast("NodeRunStatus", raw)


def _trigger(raw: str) -> RunTrigger:
    return cast("RunTrigger", raw)

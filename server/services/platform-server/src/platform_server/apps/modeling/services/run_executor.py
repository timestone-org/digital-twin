"""按拓扑序跑完一张图，逐节点留下状态、耗时与结果摘要。

失败即停：任一节点抛错，该节点落 `failed` + traceback，其余未执行的节点**显式**
落 `skipped`——留空的话界面分不清「没跑」与「记录丢了」
（docs/MODELING_DESIGN.md D18）。
"""

import time
import traceback
from dataclasses import dataclass, field
from typing import Any

from platform_server.apps.modeling.operators import (
    PREFETCHED_KEY,
    Frame,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.protocols import NodeRunStatus, RunStatus
from platform_server.apps.modeling.schemas.graph import GraphNode, PipelineGraph
from platform_server.apps.modeling.services import preview as preview_service
from platform_server.apps.modeling.services.graph_walk import (
    split_plan_of,
    topological_order,
)

# 错误文本落库前的截断长度，与节点记录的列一致
MAX_ERROR_TEXT = 8 * 1024


@dataclass(frozen=True)
class NodeOutcome:
    """一个节点跑完之后要落库的全部东西。"""

    node_id: str
    operator: str
    alias: str
    ordinal: int
    status: NodeRunStatus
    duration_ms: int = 0
    error_text: str = ""
    preview: dict[str, dict[str, Any]] = field(
        default_factory=dict[str, dict[str, Any]]
    )
    is_preview_truncated: bool = False


@dataclass(frozen=True)
class RunOutcome:
    """一次运行的终态与逐节点记录。"""

    status: RunStatus
    nodes: tuple[NodeOutcome, ...]
    row_count: int | None = None
    is_source_truncated: bool = False
    error_text: str = ""


def execute_graph(
    graph: PipelineGraph,
    *,
    prefetched: dict[str, Frame],
    tz_offset_minutes: int,
) -> RunOutcome:
    """跑完一张图。

    ⚠ 上下文键一律是 `(节点 id, 端口名)`，**不用别名**：别名没有唯一约束，
    拿它当键时两个同名节点会静默互相覆盖输出（设计文档 D5）。
    Args: graph, prefetched, tz_offset_minutes。
    """
    nodes = graph.node_by_id()
    order = topological_order(graph)
    context: dict[tuple[str, str], Any] = {}
    outcomes: list[NodeOutcome] = []
    budget = _Budget()
    for ordinal, node_id in enumerate(order):
        node = nodes[node_id]
        outcome = _run_one(
            node,
            _Setting(
                graph=graph,
                nodes=nodes,
                ordinal=ordinal,
                tz_offset_minutes=tz_offset_minutes,
                prefetched=prefetched.get(node_id),
            ),
            context,
            budget,
        )
        outcomes.append(outcome)
        if outcome.status == "failed":
            outcomes += _skipped(order[ordinal + 1 :], nodes, ordinal + 1)
            return _failed(outcomes, outcome, context)
    return _succeeded(outcomes, context)


@dataclass(frozen=True)
class _Setting:
    """跑一个节点要的上下文，打成一包是因为形参上限是 5。"""

    graph: PipelineGraph
    nodes: dict[str, GraphNode]
    ordinal: int
    tz_offset_minutes: int
    prefetched: Frame | None


class _Budget:
    """一次运行里全部摘要合计的字节预算。用光之后的节点只留统计。"""

    def __init__(self) -> None:
        self._used = 0

    def take(
        self, previews: dict[str, dict[str, Any]]
    ) -> tuple[dict[str, dict[str, Any]], bool]:
        """把一组摘要压进预算，回 `(摘要, 是否被截断)`。

        Args: previews。
        """
        kept: dict[str, dict[str, Any]] = {}
        truncated = False
        for port, raw in previews.items():
            if self._used >= preview_service.RUN_PREVIEW_MAX_BYTES:
                kept[port] = {
                    "kind": raw.get("kind", "unknown"),
                    "note": "本次运行的结果摘要已用满预算",
                }
                truncated = True
                continue
            fitted, was_cut = preview_service.fit_budget(raw)
            kept[port] = fitted
            truncated = truncated or was_cut
            self._used += preview_service.PREVIEW_MAX_BYTES
        return kept, truncated


def _run_one(
    node: GraphNode,
    setting: _Setting,
    context: dict[tuple[str, str], Any],
    budget: _Budget,
) -> NodeOutcome:
    """跑一个节点：装参数、注入运行期上下文、拼输入、算、出摘要。

    Args: node, setting, context, budget。
    """
    started = time.monotonic()
    try:
        outputs = run_node(node, setting, context)
    except OperatorError as error:
        return _node_failed(node, setting, started, str(error))
    except Exception:
        return _node_failed(node, setting, started, traceback.format_exc())
    for port, payload in outputs.items():
        context[(node.id, port)] = payload
    previews, truncated = budget.take(
        {
            port: preview_service.summarize(value)
            for port, value in outputs.items()
        }
    )
    return NodeOutcome(
        node_id=node.id,
        operator=node.operator,
        alias=node.alias,
        ordinal=setting.ordinal,
        status="succeeded",
        duration_ms=_elapsed(started),
        preview=previews,
        is_preview_truncated=truncated,
    )


def run_node(
    node: GraphNode,
    setting: _Setting,
    context: dict[tuple[str, str], Any],
) -> dict[str, Any]:
    """跑一个算子实例。**这是将来要整体挪进子进程的那一步。**

    Args: node, setting, context。
    """
    operator, _ = registry.build(node.operator, node.config)
    operator.bind_runtime(
        tz_offset_minutes=setting.tz_offset_minutes,
        split_plan=split_plan_of(setting.graph, setting.nodes, node.id),
    )
    inputs = _inputs_of(node, setting, context)
    return operator.run(inputs)


def _inputs_of(
    node: GraphNode,
    setting: _Setting,
    context: dict[tuple[str, str], Any],
) -> dict[str, Any]:
    """按边把上游的输出摆到自己的输入端口上。

    Args: node, setting, context。
    """
    inputs: dict[str, Any] = {}
    if setting.prefetched is not None:
        inputs[PREFETCHED_KEY] = setting.prefetched
    for edge in setting.graph.edges:
        if edge.to_node != node.id:
            continue
        key = (edge.from_node, edge.from_port)
        if key not in context:
            raise OperatorError("上游这一步没有产出可用的数据")
        inputs[edge.to_port] = context[key]
    return inputs


def _node_failed(
    node: GraphNode, setting: _Setting, started: float, text: str
) -> NodeOutcome:
    return NodeOutcome(
        node_id=node.id,
        operator=node.operator,
        alias=node.alias,
        ordinal=setting.ordinal,
        status="failed",
        duration_ms=_elapsed(started),
        error_text=text[:MAX_ERROR_TEXT],
    )


def _skipped(
    remaining: list[str], nodes: dict[str, GraphNode], first: int
) -> list[NodeOutcome]:
    """上游失败之后没跑的那些节点，显式落 `skipped`。

    ⚠ 序号要接着往下排：从 0 重新数的话，界面按序号排出来的顺序会与拓扑序对
    不上，而两组序号各自看着都正常。
    Args: remaining, nodes, first。
    """
    return [
        NodeOutcome(
            node_id=node_id,
            operator=nodes[node_id].operator,
            alias=nodes[node_id].alias,
            ordinal=first + index,
            status="skipped",
        )
        for index, node_id in enumerate(remaining)
    ]


def _failed(
    outcomes: list[NodeOutcome],
    failure: NodeOutcome,
    context: dict[tuple[str, str], Any],
) -> RunOutcome:
    return RunOutcome(
        status="failed",
        nodes=tuple(outcomes),
        error_text=failure.error_text[:MAX_ERROR_TEXT],
        **_source_facts(context),
    )


def _succeeded(
    outcomes: list[NodeOutcome], context: dict[tuple[str, str], Any]
) -> RunOutcome:
    return RunOutcome(
        status="succeeded",
        nodes=tuple(outcomes),
        **_source_facts(context),
    )


def _source_facts(context: dict[tuple[str, str], Any]) -> dict[str, Any]:
    """取数那一步的两个第一手事实：取了多少行、有没有触顶。

    ⚠ 触顶必须如实往上传：不说的话，用户会拿一段被截过的数据当整段来解释模型。
    Args: context。
    """
    frames = [
        value
        for value in context.values()
        if isinstance(value, Frame) and value.provenance.table_codes
    ]
    if not frames:
        return {"row_count": None, "is_source_truncated": False}
    return {
        "row_count": max(frame.row_count for frame in frames),
        "is_source_truncated": any(
            frame.provenance.is_truncated for frame in frames
        ),
    }


def _elapsed(started: float) -> int:
    return int((time.monotonic() - started) * 1000)

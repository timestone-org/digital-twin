"""按拓扑序跑完一张图，逐节点留下状态、耗时与结果摘要。

失败即停：任一节点抛错，该节点落 `failed` + traceback，其余未执行的节点**显式**
落 `skipped`——留空的话界面分不清「没跑」与「记录丢了」
（docs/MODELING_DESIGN.md D18）。

⚠ 引擎本身不认识 Redis 也不认识进程池：算子怎么跑、取消从哪读、节点记录往哪
写，都是调用方注入的三件协作件。于是单测给一个进程内的假跑法就能验完状态机。
"""

import time
import traceback
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

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
from platform_server.apps.modeling.services.node_task import NodePayload

# 错误文本落库前的截断长度，与节点记录那一列一致
MAX_ERROR_TEXT = 8 * 1024
# 超时被掐断时给用户看的那句话
TIMEOUT_REASON = "这一步超过了单节点时限被掐断"


class NodeRunner(Protocol):
    """把一个算子跑起来的那只手。真实现是进程池，测试用进程内假件。"""

    async def run(self, payload: NodePayload) -> dict[str, Any]: ...


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


@dataclass(frozen=True)
class Sources:
    """取数阶段的产出：取到的帧，与取不到的那些节点各自的原因。"""

    frames: dict[str, Frame]
    failures: dict[str, str] = field(default_factory=dict[str, str])


@dataclass(frozen=True)
class Execution:
    """跑一次运行要的全部协作件。打成一包是因为形参上限是 5。"""

    sources: Sources
    tz_offset_minutes: int
    runner: NodeRunner
    #: 每个节点边界问一次「用户点取消了吗」
    should_cancel: Callable[[], Awaitable[bool]]
    #: 每个节点落一次库。⚠ 必须逐节点落而不是攒到最后：跑到一半的进度要对
    #: 别的副本可见，前端轮询读的就是这些行
    on_node_finished: Callable[[NodeOutcome], Awaitable[None]]


async def execute_graph(
    graph: PipelineGraph, *, execution: Execution
) -> RunOutcome:
    """跑完一张图。

    ⚠ 上下文键一律是 `(节点 id, 端口名)`，**不用别名**：别名没有唯一约束，
    拿它当键时两个同名节点会静默互相覆盖输出（设计文档 D5）。
    Args: graph, execution。
    """
    nodes = graph.node_by_id()
    order = topological_order(graph)
    context: dict[tuple[str, str], Any] = {}
    outcomes: list[NodeOutcome] = []
    budget = _Budget()
    for ordinal, node_id in enumerate(order):
        if await execution.should_cancel():
            skipped = _skipped(order[ordinal:], nodes, ordinal)
            await _persist_all(execution, skipped)
            return _cancelled(outcomes + skipped, context)
        outcome = await _run_one(
            nodes[node_id],
            _setting_of(graph, nodes, ordinal, execution),
            context,
            budget,
        )
        outcomes.append(outcome)
        await execution.on_node_finished(outcome)
        if outcome.status == "failed":
            skipped = _skipped(order[ordinal + 1 :], nodes, ordinal + 1)
            await _persist_all(execution, skipped)
            return _failed(outcomes + skipped, outcome, context)
    return _succeeded(outcomes, context)


async def _persist_all(
    execution: Execution, outcomes: list[NodeOutcome]
) -> None:
    """把一批节点记录落库。

    ⚠ 跳过的节点也要落：留空的话界面分不清「没跑」与「记录丢了」，而取消掉的
    运行整片空白看着像执行器坏了。
    Args: execution, outcomes。
    """
    for item in outcomes:
        await execution.on_node_finished(item)


@dataclass(frozen=True)
class _Setting:
    """跑一个节点要的上下文。"""

    graph: PipelineGraph
    nodes: dict[str, GraphNode]
    ordinal: int
    execution: Execution


def _setting_of(
    graph: PipelineGraph,
    nodes: dict[str, GraphNode],
    ordinal: int,
    execution: Execution,
) -> _Setting:
    return _Setting(
        graph=graph, nodes=nodes, ordinal=ordinal, execution=execution
    )


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


async def _run_one(
    node: GraphNode,
    setting: _Setting,
    context: dict[tuple[str, str], Any],
    budget: _Budget,
) -> NodeOutcome:
    """跑一个节点：装参数、注入运行期上下文、拼输入、算、出摘要。

    Args: node, setting, context, budget。
    """
    started = time.monotonic()
    failure = setting.execution.sources.failures.get(node.id)
    if failure is not None:
        return _node_failed(node, setting, started, failure)
    try:
        outputs = await _run_node(node, setting, context)
    except OperatorError as error:
        return _node_failed(node, setting, started, str(error))
    except TimeoutError:
        return _node_failed(node, setting, started, TIMEOUT_REASON)
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


async def _run_node(
    node: GraphNode,
    setting: _Setting,
    context: dict[tuple[str, str], Any],
) -> dict[str, Any]:
    """把一个算子实例交给注入的跑法。

    Args: node, setting, context。
    """
    registry.get(node.operator)
    execution = setting.execution
    return await execution.runner.run(
        NodePayload(
            operator=node.operator,
            config=dict(node.config),
            inputs=_inputs_of(node, setting, context),
            tz_offset_minutes=execution.tz_offset_minutes,
            split_plan=split_plan_of(setting.graph, setting.nodes, node.id),
        )
    )


def _inputs_of(
    node: GraphNode,
    setting: _Setting,
    context: dict[tuple[str, str], Any],
) -> dict[str, Any]:
    """按边把上游的输出摆到自己的输入端口上。

    Args: node, setting, context。
    """
    inputs: dict[str, Any] = {}
    prefetched = setting.execution.sources.frames.get(node.id)
    if prefetched is not None:
        inputs[PREFETCHED_KEY] = prefetched
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
    """没跑的那些节点，显式落 `skipped`。

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


def _cancelled(
    outcomes: list[NodeOutcome], context: dict[tuple[str, str], Any]
) -> RunOutcome:
    return RunOutcome(
        status="cancelled", nodes=tuple(outcomes), **_source_facts(context)
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

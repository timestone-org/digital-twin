"""发起、读取与取消一次运行。

本期是**同步执行**：`POST :run` 在同一个请求里跑完再返回。队列与进程池在第 2
期接上，接缝就是 `_execute` 这一处（docs/MODELING_DESIGN.md §11 第 2 期）。
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError
from lib.web import Page, PageParams
from platform_server.apps.modeling.crud import node_run_crud, run_crud
from platform_server.apps.modeling.errors import (
    GraphInvalid,
    NodeRunNotFound,
    RunNotCancellable,
    RunNotFound,
)
from platform_server.apps.modeling.models import ModelingNodeRun, ModelingRun
from platform_server.apps.modeling.protocols import ACTIVE_RUN_STATUSES
from platform_server.apps.modeling.schemas import (
    NodeRunOut,
    PipelineGraph,
    RunOut,
    RunStartIn,
    RunSummaryOut,
)
from platform_server.apps.modeling.services import frame_source, presenters
from platform_server.apps.modeling.services.graph_check import check_graph
from platform_server.apps.modeling.services.pipeline_service import (
    Actor,
    require_pipeline,
)
from platform_server.apps.modeling.services.run_executor import (
    NodeOutcome,
    RunOutcome,
    execute_graph,
)


@dataclass(frozen=True)
class RunContext:
    """跑一次运行要的外部条件。时区注入进来，算子不自己读配置。"""

    actor: Actor
    tz_offset_minutes: int
    now: datetime


async def start_run(
    session: AsyncSession,
    *,
    pipeline_id: uuid.UUID,
    payload: RunStartIn,
    context: RunContext,
) -> RunOut:
    """校验图 → 建运行行 → 跑完 → 落终态。

    ⚠ 图快照在建行那一刻冻结：之后流水线被改被删，这次运行依然复现得出当时的
    拓扑与参数（D6）。
    Args: session, pipeline_id, payload, context。
    """
    pipeline = await require_pipeline(session, pipeline_id)
    graph = presenters.graph_of(pipeline.graph_json)
    _require_valid(graph)
    run = await run_crud.add_active(
        session,
        ModelingRun(
            pipeline_id=pipeline.id,
            status="pending",
            graph_snapshot=graph.model_dump(),
            trigger=payload.trigger,
            created_by=context.actor.user_id,
            created_by_name=context.actor.name,
        ),
    )
    await _execute(session, run=run, graph=graph, context=context)
    return await get_run(session, run.id)


async def list_runs(
    session: AsyncSession,
    *,
    pipeline_id: uuid.UUID | None,
    page: PageParams,
) -> Page[RunSummaryOut]:
    """运行列表。

    Args: session, pipeline_id, page。
    """
    rows, total = await run_crud.page(
        session,
        pipeline_id=pipeline_id,
        offset=page.offset,
        limit=page.size,
    )
    return Page[RunSummaryOut](
        items=[presenters.to_run_summary(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_run(session: AsyncSession, run_id: uuid.UUID) -> RunOut:
    """运行详情 + 节点状态清单。前端每秒轮询的就是它，**不带结果摘要**。

    Args: session, run_id。
    """
    run = await require_run(session, run_id)
    return presenters.to_run_out(
        run, await node_run_crud.list_by_run(session, run.id)
    )


async def get_node_run(
    session: AsyncSession, *, run_id: uuid.UUID, node_id: str
) -> NodeRunOut:
    """单个节点的详情，含结果摘要。按节点懒加载。

    ⚠ 取不到就 404 + 明说，**绝不静默返回空**：中间结果丢了却显示「没有详情」
    的话，排查无从下手（§6.4）。
    Args: session, run_id, node_id。
    """
    await require_run(session, run_id)
    row = await node_run_crud.get_node(session, run_id=run_id, node_id=node_id)
    if row is None:
        raise NodeRunNotFound("这次运行里没有这个节点的记录")
    return presenters.to_node_out(row)


async def cancel_run(session: AsyncSession, run_id: uuid.UUID) -> RunOut:
    """请求取消。置旗标并转 `cancelling`，终态在下一个节点边界落。

    ⚠ 不直接写终态：那会出现一段「界面说已取消、子进程其实还在跑」的窗口
    （§6.2）。
    Args: session, run_id。
    """
    run = await require_run(session, run_id)
    if run.status not in ACTIVE_RUN_STATUSES:
        raise RunNotCancellable("这次运行已经结束了，取消不了")
    run.cancel_requested = True
    run.status = "cancelling"
    await session.flush()
    return await get_run(session, run_id)


async def require_run(session: AsyncSession, run_id: uuid.UUID) -> ModelingRun:
    """取运行记录，取不到即 404。

    Args: session, run_id。
    """
    row = await run_crud.get(session, run_id)
    if row is None:
        raise RunNotFound("运行记录不存在")
    return row


def _require_valid(graph: PipelineGraph) -> None:
    """图不合法就带着逐条问题 400。

    Args: graph。
    """
    issues = check_graph(graph)
    if not issues:
        return
    raise GraphInvalid(
        "流水线还有问题，先改好再运行",
        details=tuple(
            FieldError(
                field=item.node_id or item.edge_id or "graph",
                code="graph_invalid",
                message=item.message,
            )
            for item in issues
        ),
    )


async def _execute(
    session: AsyncSession,
    *,
    run: ModelingRun,
    graph: PipelineGraph,
    context: RunContext,
) -> None:
    """跑完一张图并把结果落库。

    Args: session, run, graph, context。
    """
    run.status = "running"
    run.started_at = context.now
    await session.flush()
    prefetched = await frame_source.prefetch(
        session, graph=graph, now=context.now
    )
    outcome = execute_graph(
        graph,
        prefetched=prefetched,
        tz_offset_minutes=context.tz_offset_minutes,
    )
    for node in outcome.nodes:
        node_run_crud.add(session, _node_row(run.id, node))
    _finish(run, outcome)
    await session.flush()


def _node_row(run_id: uuid.UUID, node: NodeOutcome) -> ModelingNodeRun:
    return ModelingNodeRun(
        run_id=run_id,
        node_id=node.node_id,
        operator=node.operator,
        alias=node.alias or None,
        ordinal=node.ordinal,
        status=node.status,
        duration_ms=node.duration_ms,
        error_text=node.error_text or None,
        preview_json=node.preview or None,
        preview_truncated=node.is_preview_truncated,
    )


def _finish(run: ModelingRun, outcome: RunOutcome) -> None:
    """把终态写到运行行上。

    Args: run, outcome。
    """
    finished = datetime.now(UTC)
    run.status = outcome.status
    run.finished_at = finished
    run.row_count = outcome.row_count
    run.source_truncated = outcome.is_source_truncated
    run.error_text = outcome.error_text or None
    if run.started_at is not None:
        run.duration_ms = int(
            (finished - run.started_at).total_seconds() * 1000
        )
    run_crud.touch(run)

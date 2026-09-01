"""发起、读取与取消一次运行。

⚠ 发起只做两件事：建运行行、**提交之后**把 run_id 投进队列，随即 202 返回一个
`pending` 的运行。真正的执行在 worker 角色里（`run_dispatch` / `run_worker`），
所以 API 副本重启不影响在跑的运行，训练的 CPU 也不与业务 API 抢核（D16）。
⚠ 投递必须走 `lib.db.after_commit` 而不是 FastAPI 的 BackgroundTasks——后者在
发响应时就地 await，排在会话提交**之前**，消费者会先于提交读到运行行还不存在。
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import after_commit
from lib.errors.base import FieldError
from lib.stream import StreamGroup, StreamLike
from lib.web import Page, PageParams
from platform_server.apps.modeling.crud import node_run_crud, run_crud
from platform_server.apps.modeling.errors import (
    GraphInvalid,
    NodeRunNotFound,
    RunNotCancellable,
    RunNotFound,
)
from platform_server.apps.modeling.models import ModelingRun
from platform_server.apps.modeling.protocols import ACTIVE_RUN_STATUSES
from platform_server.apps.modeling.schemas import (
    NodeRunOut,
    PipelineGraph,
    RunOut,
    RunStartIn,
    RunSummaryOut,
)
from platform_server.apps.modeling.services import presenters, run_queue
from platform_server.apps.modeling.services.graph_check import check_graph
from platform_server.apps.modeling.services.pipeline_service import (
    Actor,
    require_pipeline,
)


@dataclass(frozen=True)
class RunContext:
    """发起一次运行要的外部条件。"""

    actor: Actor
    stream: StreamLike
    target: StreamGroup
    now: datetime


async def start_run(
    session: AsyncSession,
    *,
    pipeline_id: uuid.UUID,
    payload: RunStartIn,
    context: RunContext,
) -> RunOut:
    """校验图 → 建运行行 → 提交后投队列。返回的是一个 `pending` 的运行。

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
    _enqueue_after_commit(session, run.id, context)
    return await get_run(session, run.id)


def _enqueue_after_commit(
    session: AsyncSession, run_id: uuid.UUID, context: RunContext
) -> None:
    """排一次提交后的投递。

    ⚠ 钩子失败只记日志、不回滚已落库的运行行：那一行的状态是 `pending`，
    在途集合里占着位，保留期清理的心跳判定会把它收成 `failed` 并说明原因。
    比起「响应 500 但运行行已经在库里」，这个方向更容易解释。
    Args: session, run_id, context。
    """
    message = run_queue.new_message(run_id)

    async def publish() -> None:
        await run_queue.publish_run(
            context.stream, target=context.target, message=message
        )

    after_commit(session, publish)


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

"""worker 侧的一次运行编排：认领 → 取数 → 逐节点跑 → 落终态。

⚠ 每个节点一个短事务：跑到一半的进度必须对别的副本可见，前端轮询读的就是
那些行。攒到最后一次性提交的话，一次长运行在界面上会一直显示「零进度」。
⚠ 重投递一律判「执行中断」落终态，**不重放**（docs/MODELING_DESIGN.md D25）：
一次运行会边跑边写节点记录，重放要先清干净再来一遍；而一张会让子进程崩溃的
图会被无限重投，把整个建模面堵死。
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from lib.logging import get_logger
from lib.objectstore import ObjectStore, ObjectStoreError
from platform_server.apps.modeling.crud import node_run_crud, run_crud
from platform_server.apps.modeling.models import ModelingNodeRun, ModelingRun
from platform_server.apps.modeling.protocols import ACTIVE_RUN_STATUSES
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services import (
    artifact_store,
    frame_export,
    frame_source,
    presenters,
)
from platform_server.apps.modeling.services.run_executor import (
    Execution,
    NodeOutcome,
    NodeRunner,
    RunOutcome,
    Sources,
    execute_graph,
)
from platform_server.apps.modeling.services.sessions import Sessions

_logger = get_logger("platform.modeling.dispatch")

# 一次运行的三种去向，日志里必须是三个不同的 event——混成一条的话，
# 「跑完了」与「一直卡着」在日志里长得一模一样
RUN_DONE = "done"
RUN_INTERRUPTED = "interrupted"
RUN_ORPHANED = "orphaned"

INTERRUPTED_REASON = "上一次执行中断了，请重新运行"


@dataclass(frozen=True)
class DispatchOptions:
    """跑一次运行要的外部条件。"""

    runner: NodeRunner
    tz_offset_minutes: int
    #: 二进制产物的落脚处。⚠ 缺省是「没有」而不是必填：纯 JSON 那些算子
    #: 一个字节都不产，没配对象存储的部署照样跑得起来
    store: ObjectStore | None = None


@dataclass(frozen=True)
class DispatchReport:
    """这一次消费的去向。"""

    outcome: str
    status: str = ""
    #: 这次运行属于哪条流水线。消费循环拿它就地收敛这条流水线的老明细
    pipeline_id: uuid.UUID | None = None


async def execute_run(
    sessions: Sessions, *, run_id: uuid.UUID, options: DispatchOptions
) -> DispatchReport:
    """跑一次运行，全程自己开会话。

    Args: sessions, run_id, options。
    """
    claimed = await _claim(sessions, run_id)
    if claimed is None:
        return DispatchReport(outcome=RUN_ORPHANED)
    if claimed.is_redelivery:
        await _finish(sessions, run_id, _interrupted())
        return DispatchReport(
            outcome=RUN_INTERRUPTED,
            status="failed",
            pipeline_id=claimed.pipeline_id,
        )
    sources = await _load_sources(sessions, claimed)
    outcome = await execute_graph(
        claimed.graph,
        execution=Execution(
            sources=sources,
            tz_offset_minutes=options.tz_offset_minutes,
            runner=options.runner,
            should_cancel=lambda: _is_cancelled(sessions, run_id),
            on_node_finished=lambda node: _persist(
                sessions,
                run_id,
                node,
                _Sinks(
                    store=options.store,
                    is_keeping_frames=claimed.is_keeping_frames,
                ),
            ),
        ),
    )
    await _finish(sessions, run_id, outcome)
    return DispatchReport(
        outcome=RUN_DONE,
        status=outcome.status,
        pipeline_id=claimed.pipeline_id,
    )


@dataclass(frozen=True)
class _Claimed:
    """认领下来的一次运行。"""

    graph: PipelineGraph
    is_redelivery: bool
    pipeline_id: uuid.UUID
    #: 这次运行要不要把每个端口的全量帧写成 CSV 存下来（D12）
    is_keeping_frames: bool


async def _claim(sessions: Sessions, run_id: uuid.UUID) -> "_Claimed | None":
    """把运行标成 running 并回它的图快照；已终态或不存在给 None。

    ⚠ `attempt` 在这里 +1，于是「这是第几次被派发」有据可查：第二次拿到同一条
    消息就是重投递，那意味着上一次执行没走完。
    Args: sessions, run_id。
    """
    async with sessions.session() as session:
        run = await run_crud.get(session, run_id)
        if run is None or run.status not in ACTIVE_RUN_STATUSES:
            return None
        redelivery = run.attempt > 0
        run.attempt += 1
        if not redelivery:
            run.status = "running"
            run.started_at = datetime.now(UTC)
            run_crud.touch(run)
        return _Claimed(
            graph=presenters.graph_of(run.graph_snapshot),
            is_redelivery=redelivery,
            pipeline_id=run.pipeline_id,
            is_keeping_frames=run.is_keeping_frames,
        )


async def _load_sources(sessions: Sessions, claimed: _Claimed) -> Sources:
    """取数阶段。取不到的节点带着原因交给引擎，由它落 `failed`。

    Args: sessions, claimed。
    """
    async with sessions.session() as session:
        prefetched = await frame_source.prefetch(
            session, graph=claimed.graph, now=datetime.now(UTC)
        )
    return Sources(frames=prefetched.frames, failures=prefetched.failures)


async def _is_cancelled(sessions: Sessions, run_id: uuid.UUID) -> bool:
    """用户点过取消没有。每个节点边界问一次。

    ⚠ 读不出来时按「没取消」处理：宁可跑完，也不要因为一次数据库抖动把一次
    正常的运行半途停掉。
    Args: sessions, run_id。
    """
    try:
        async with sessions.session() as session:
            run = await run_crud.get(session, run_id)
            return bool(run is not None and run.cancel_requested)
    except Exception as error:
        _logger.warning(
            "modeling_cancel_unreadable", "取消标志读不出来", error=error
        )
        return False


@dataclass(frozen=True)
class _Sinks:
    """落库那一步要往哪儿写字节，以及要不要写全量帧。"""

    store: ObjectStore | None
    is_keeping_frames: bool


async def _persist(
    sessions: Sessions,
    run_id: uuid.UUID,
    node: NodeOutcome,
    sinks: _Sinks,
) -> None:
    """把一个节点的执行记录落库，并记一次心跳；有产物就一并写进对象存储。

    ⚠ 产物**先写存储、再落库**：反过来的话库里会指着一个不存在的键，而那要
    到发布时才发现。写不进去就让这一步失败——一个没有产物的树模型发布出来
    就是个永远算不出数的版本。
    ⚠ 全量帧那一份反过来：写不进去只记日志、不让节点失败。它是附加品，
    为它把一次跑通的训练判成失败是本末倒置（D12）。
    Args: sessions, run_id, node, sinks。
    """
    artifact = (
        None
        if node.artifact is None
        else await _write_artifact(run_id, node, sinks.store)
    )
    frames = (
        await frame_export.write_all(
            sinks.store, str(run_id), node.node_id, node.frames
        )
        if sinks.is_keeping_frames
        else {}
    )
    async with sessions.session() as session:
        node_run_crud.add(
            session, _node_row(run_id, node, artifact, frames or None)
        )
        run = await run_crud.get(session, run_id)
        if run is not None:
            run_crud.touch(run)


async def _write_artifact(
    run_id: uuid.UUID, node: NodeOutcome, store: ObjectStore | None
) -> dict[str, Any] | None:
    """把一份产物写进对象存储，回一份要落库的元信息。写不进去就让这一步失败。

    Args: run_id, node, store。
    """
    if node.artifact is None:  # pragma: no cover —— 调用点已判过
        return None
    if store is None:
        raise ObjectStoreError(
            "这条流水线产出了二进制模型，而本部署没有配对象存储"
        )
    key = artifact_store.run_key(str(run_id), node.node_id)
    await store.put_bytes(
        key,
        node.artifact.payload,
        content_type=artifact_store.CONTENT_TYPE,
    )
    _logger.info(
        "modeling_artifact_written",
        "模型产物已落对象存储",
        run_id=str(run_id),
        node_id=node.node_id,
        size_bytes=node.artifact.size_bytes,
    )
    return artifact_store.meta_of(node.artifact, key)


def _node_row(
    run_id: uuid.UUID,
    node: NodeOutcome,
    artifact: dict[str, Any] | None,
    frames: dict[str, dict[str, object]] | None,
) -> ModelingNodeRun:
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
        fitted_json=node.fitted,
        io_json=node.io or None,
        artifact_json=artifact,
        frames_json=frames,
    )


def _interrupted() -> RunOutcome:
    return RunOutcome(status="failed", nodes=(), error_text=INTERRUPTED_REASON)


async def _finish(
    sessions: Sessions, run_id: uuid.UUID, outcome: RunOutcome
) -> None:
    """把终态写到运行行上。

    ⚠ 终态必须带 `finished_at`：空着会被界面与保留期清理一起当成「还在跑」。
    Args: sessions, run_id, outcome。
    """
    async with sessions.session() as session:
        run = await run_crud.get(session, run_id)
        if run is None:
            return
        _apply_terminal(run, outcome)


def _apply_terminal(run: ModelingRun, outcome: RunOutcome) -> None:
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

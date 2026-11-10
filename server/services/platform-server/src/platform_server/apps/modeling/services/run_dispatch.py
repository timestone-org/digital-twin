"""原子认领并逐节点执行训练；健康重复消息保留待确认，失联执行明确中断。

短事务与队列恢复语义见 docs/MODELING_DESIGN.md D25。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from lib.errors import AppError
from lib.logging import get_logger
from lib.objectstore import ObjectStore, ObjectStoreError
from platform_server.apps.modeling.crud import node_run_crud, run_crud
from platform_server.apps.modeling.models import ModelingNodeRun, ModelingRun
from platform_server.apps.modeling.protocols import ACTIVE_RUN_STATUSES
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services import (
    artifact_store,
    bdm_frame,
    frame_export,
    frame_source,
    presenters,
)
from platform_server.apps.modeling.services.bdm_client import BdmConnection
from platform_server.apps.modeling.services.run_executor import (
    Execution,
    NodeOutcome,
    NodeRunner,
    RunOutcome,
    Sources,
    execute_graph,
)
from platform_server.apps.modeling.services.sessions import Sessions

if TYPE_CHECKING:
    from platform_server.apps.modeling.services.run_pool import NodePool

_logger = get_logger("platform.modeling.dispatch")

# 一次运行的三种去向，日志里必须是三个不同的 event——混成一条的话，
# 「跑完了」与「一直卡着」在日志里长得一模一样
RUN_DONE = "done"
RUN_INTERRUPTED = "interrupted"
RUN_ORPHANED = "orphaned"
RUN_BUSY = "busy"

INTERRUPTED_REASON = "上一次执行中断了，请重新运行"
ORCHESTRATION_REASON = "运行中途出错了，请重新运行"


@dataclass(frozen=True)
class DispatchOptions:
    """跑一次运行要的外部条件。"""

    runner: NodeRunner
    tz_offset_minutes: int
    #: 二进制产物的落脚处。⚠ 缺省是「没有」而不是必填：纯 JSON 那些算子
    #: 一个字节都不产，没配对象存储的部署照样跑得起来
    store: ObjectStore | None = None
    bdm_connection: BdmConnection | None = None
    pool: NodePool | None = None
    stale_after_s: float = 3600


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
    claimed = await _claim(
        sessions, run_id, stale_after_s=options.stale_after_s
    )
    if isinstance(claimed, str):
        return DispatchReport(outcome=RUN_BUSY)
    if claimed is None:
        return DispatchReport(outcome=RUN_ORPHANED)
    if claimed.is_redelivery:
        await _finish(sessions, run_id, _interrupted())
        return DispatchReport(
            outcome=RUN_INTERRUPTED,
            status="failed",
            pipeline_id=claimed.pipeline_id,
        )
    outcome = await _run_claimed(sessions, run_id, claimed, options)
    status = await _finish(sessions, run_id, outcome)
    return DispatchReport(
        outcome=RUN_DONE,
        status=status,
        pipeline_id=claimed.pipeline_id,
    )


async def _run_claimed(
    sessions: Sessions,
    run_id: uuid.UUID,
    claimed: _Claimed,
    options: DispatchOptions,
) -> RunOutcome:
    """取数并跑图，编排层的异常落成一次失败。

    ⚠ 编排层的异常必须在这里变成结论：出错节点的现场就在手上，放出去的话
    只能等重新认领，原因也只剩「上一次执行中断」。
    Args: sessions, run_id, claimed, options。
    """
    try:
        # 认领前已取消的不取数：引擎在第一个节点边界就会把它收成 cancelled
        sources = (
            Sources(frames={})
            if claimed.is_cancel_requested
            else await _load_sources(
                sessions, claimed, options.bdm_connection, pool=options.pool
            )
        )
        return await execute_graph(
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
    except Exception as error:
        _logger.error(
            "modeling_run_orchestration_failed",
            "运行编排抛出异常",
            run_id=str(run_id),
            error=error,
        )
        return _orchestration_failed(error)


def _orchestration_failed(error: Exception) -> RunOutcome:
    """编排失败的结论。只有自带人话的异常才把原文给用户。Args: error。"""
    is_readable = isinstance(error, (AppError, ObjectStoreError))
    return RunOutcome(
        status="failed",
        nodes=(),
        error_text=str(error) if is_readable else ORCHESTRATION_REASON,
    )


@dataclass(frozen=True)
class _Claimed:
    """认领下来的一次运行。"""

    graph: PipelineGraph
    is_redelivery: bool
    pipeline_id: uuid.UUID
    #: 这次运行要不要把每个端口的全量帧写成 CSV 存下来（D12）
    is_keeping_frames: bool
    #: 认领之前用户已经点过取消
    is_cancel_requested: bool = False


async def _claim(
    sessions: Sessions,
    run_id: uuid.UUID,
    *,
    stale_after_s: float = 3600,
    now: datetime | None = None,
) -> _Claimed | str | None:
    """原子认领；Args: sessions, run_id, stale_after_s, now。"""
    async with sessions.session() as session:
        run = await run_crud.get_for_update(session, run_id)
        if run is None or run.status not in ACTIVE_RUN_STATUSES:
            return None
        moment = now or datetime.now(UTC)
        if _is_healthy_execution(run, moment, stale_after_s):
            return RUN_BUSY
        redelivery = run.attempt > 0
        run.attempt += 1
        if not redelivery:
            if not run.cancel_requested:
                run.status = "running"
            run.started_at = moment
            run.heartbeat_at = moment
        return _Claimed(
            graph=presenters.graph_of(run.graph_snapshot),
            is_redelivery=redelivery,
            pipeline_id=run.pipeline_id,
            is_keeping_frames=run.is_keeping_frames,
            is_cancel_requested=run.cancel_requested,
        )


def _is_healthy_execution(
    run: ModelingRun,
    now: datetime,
    stale_after_s: float,
) -> bool:
    heartbeat = run.heartbeat_at or run.started_at
    return (
        run.attempt > 0
        and run.status in {"running", "cancelling"}
        and heartbeat is not None
        and heartbeat >= now - timedelta(seconds=stale_after_s)
    )


async def _load_sources(
    sessions: Sessions,
    claimed: _Claimed,
    connection: BdmConnection | None,
    *,
    pool: NodePool | None = None,
) -> Sources:
    """取数阶段。取不到的节点带着原因交给引擎，由它落 `failed`。

    Args: sessions, claimed。
    """
    now = datetime.now(UTC)
    async with sessions.session() as session:
        prefetched = await frame_source.prefetch(
            session, graph=claimed.graph, now=now
        )
    # ⚠ 外部 HTTP 必须等上面的只读事务释放后再发起。
    external = await bdm_frame.prefetch(
        connection, claimed.graph, now=now, pool=pool
    )
    return Sources(
        frames=prefetched.frames | external.frames,
        failures=prefetched.failures | external.failures,
    )


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
        report_json=node.report,
        io_json=node.io or None,
        artifact_json=artifact,
        frames_json=frames,
    )


def _interrupted() -> RunOutcome:
    return RunOutcome(status="failed", nodes=(), error_text=INTERRUPTED_REASON)


async def _finish(
    sessions: Sessions, run_id: uuid.UUID, outcome: RunOutcome
) -> str:
    """把终态写到运行行上，回真正落下的状态。

    ⚠ 终态必须带 `finished_at`：空着会被界面与保留期清理一起当成「还在跑」。
    ⚠ 取消旗标在行锁内重读：最后一次边界检查之后才到的取消已经答复过用户，
    这里不认的话跑成了的运行还会接着自动发布。
    ⚠ 写不进库就让异常出去：消费循环据此不确认消息，由重新认领来收尾。
    Args: sessions, run_id, outcome。
    """
    async with sessions.session() as session:
        run = await run_crud.get_for_update(session, run_id)
        if run is None:
            return outcome.status
        landed = (
            replace(outcome, status="cancelled")
            if outcome.status == "succeeded" and run.cancel_requested
            else outcome
        )
        _apply_terminal(run, landed)
        return landed.status


def _apply_terminal(run: ModelingRun, outcome: RunOutcome) -> None:
    finished = datetime.now(UTC)
    run.status = outcome.status
    run.finished_at = finished
    run.row_count = outcome.row_count
    run.source_truncated = outcome.is_source_truncated
    run.error_text = outcome.error_text or None
    if outcome.status != "succeeded" and run.publication_status == "pending":
        run.publication_status = "skipped"
        run.publication_error = "训练未成功，已保留现有发布模型"
    if run.started_at is not None:
        run.duration_ms = int(
            (finished - run.started_at).total_seconds() * 1000
        )
    run_crud.touch(run)

"""重算任务本体：一个事务算完 → 提交 → 报脏 → 落终态 → 放锁。

与回填同构（docs/DATASET_DESIGN.md §14.10）：跑在受理 POST 的那个进程里，
单飞锁与回填共用一把，任务态单独一个键。
⚠ 不拆批提交：`PREV`、今日窗与 `*_ALL` 依赖整段内存上文，拆开提交会改结果。
故整趟只有「全写」与「全不写」，也因此没有取消。
"""

import asyncio
import contextlib
import uuid
from collections.abc import Coroutine
from dataclasses import asdict, dataclass, field
from datetime import datetime, tzinfo
from typing import Any

from lib.errors import AppError
from lib.logging import get_logger
from lib.utils.timeutils import format_rfc3339, utcnow
from platform_server.apps.dataset.crud import (
    RecordWindow,
    column_crud,
    table_crud,
)
from platform_server.apps.dataset.errors import (
    DatasetBackfillInvalid,
    DatasetRecomputeLockLost,
)
from platform_server.apps.dataset.formula import FormulaError
from platform_server.apps.dataset.protocols import RecomputeStatus
from platform_server.apps.dataset.services.backfill_jobs import (
    LOCK_TTL_S,
    BackfillJobs,
)
from platform_server.apps.dataset.services.dirty import (
    DatasetDirtyLog,
    mark_dirty,
)
from platform_server.apps.dataset.services.record_compute import (
    MAX_RECOMPUTE_ROWS,
    RecomputeOutcome,
    build_scope,
    log_recompute,
    recompute_range,
)
from platform_server.apps.dataset.services.sessions import Sessions

_logger = get_logger("platform.dataset.compute")

# 任务态键的前缀。⚠ 与回填的前缀不同，而锁与取消标志的键沿用回填那一份
RECOMPUTE_STATE_PREFIX = "platform:dataset:recompute:"
# 整趟的预算（秒）。20 万行上限按每行几毫秒算，留足余量
RECOMPUTE_BUDGET_S = 1800.0
# 心跳续锁的间隔（秒）：锁的有效期内至少续三次，丢一次心跳不至于丢锁
RENEW_EVERY_S = LOCK_TTL_S / 3

STATUS_RUNNING: RecomputeStatus = "running"
STATUS_DONE: RecomputeStatus = "done"
STATUS_FAILED: RecomputeStatus = "failed"

_STOPPED_MESSAGE = "重算中断（服务正在关停），本次一行都没写入，重发即可"
# 出错原文进任务态时的截断长度
_ERROR_LIMIT = 512


@dataclass
class RecomputeJobState:
    """一次重算任务对外可见的全部状态。"""

    table_id: str
    table_code: str
    status: RecomputeStatus
    since: datetime | None
    until: datetime | None
    started_at: datetime
    updated_at: datetime
    recomputed: int = 0
    failed: int = 0
    is_truncated: bool = False
    limit: int = MAX_RECOMPUTE_ROWS
    finished_at: datetime | None = None
    error: str | None = None
    message: str = ""

    def to_payload(self) -> dict[str, Any]:
        """摊成能进 Redis 的 JSON。时刻一律 RFC3339 UTC。"""
        return {
            key: format_rfc3339(value) if isinstance(value, datetime) else value
            for key, value in asdict(self).items()
        }

    def fail(self, error: str, message: str) -> None:
        """落成失败态。

        Args: error, message。
        """
        self.status = STATUS_FAILED
        self.error = error[:_ERROR_LIMIT]
        self.message = message


@dataclass(frozen=True)
class RecomputeContext:
    """一次重算要用的协作者。⚠ `token` 一个任务一个，是单飞锁的持有者标识。"""

    sessions: Sessions
    dirty: DatasetDirtyLog
    jobs: BackfillJobs
    timezone: tzinfo
    token: str


@dataclass
class RecomputeRunner:
    """后台重算的起跑口，兼这些任务的强引用。

    ⚠ 强引用挂在实例上：事件循环只持有任务的弱引用，丢了引用的任务可能随时
    消失，而日志里连一条失败都没有。
    """

    sessions: Sessions
    dirty: DatasetDirtyLog
    #: `state_prefix` 是重算那一份的读写口；锁与回填共用
    jobs: BackfillJobs
    timezone: tzinfo
    #: 本副本的身份，拼进单飞锁的持有者标识
    instance: str
    tasks: dict[uuid.UUID, asyncio.Task[None]] = field(
        default_factory=dict[uuid.UUID, "asyncio.Task[None]"]
    )

    def context(self, token: str) -> RecomputeContext:
        """一个任务的协作者。

        Args: token。
        """
        return RecomputeContext(
            sessions=self.sessions,
            dirty=self.dirty,
            jobs=self.jobs,
            timezone=self.timezone,
            token=token,
        )

    def launch(self, state: RecomputeJobState, *, token: str) -> None:
        """起一个后台重算。POST 立刻返回，进度走 GET。

        Args: state, token。
        """
        self._track(state, run_recompute(self.context(token), state))

    def _track(
        self, state: RecomputeJobState, work: Coroutine[Any, Any, None]
    ) -> None:
        """把协程起成任务并攥住引用。

        Args: state, work。
        """
        table_id = uuid.UUID(state.table_id)
        task = asyncio.create_task(
            work, name=f"dataset-recompute-{table_id.hex}"
        )
        self.tasks[table_id] = task
        task.add_done_callback(lambda _task: self.tasks.pop(table_id, None))

    async def drain(self, timeout_s: float) -> None:
        """等在跑的重算收摊；超时就取消它们并等终态落下。

        ⚠ 取消之后还要再等一次：任务在取消里写终态、放锁，两样都要 Redis，而
        Redis 排在这一步之后才关。
        Args: timeout_s。
        """
        running = [task for task in self.tasks.values() if not task.done()]
        if not running:
            return
        _done, pending = await asyncio.wait(running, timeout=timeout_s)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.wait(pending)


async def run_recompute(
    context: RecomputeContext, state: RecomputeJobState
) -> None:
    """后台重算协程：全程兜底，绝不把异常漏给事件循环。

    Args: context, state。
    """
    try:
        async with asyncio.timeout(RECOMPUTE_BUDGET_S):
            outcome = await _guarded(context, state)
        _record_outcome(state, outcome)
        await _finalize(context, state)
    except asyncio.CancelledError:
        state.fail("进程关停", _STOPPED_MESSAGE)
        await _finalize(context, state)
        raise
    except Exception as error:
        _logger.error(
            "dataset_recompute_failed",
            "重算任务出错，本次没有写入任何一行",
            table_code=state.table_code,
            error_type=type(error).__name__,
        )
        state.fail(_error_text(error), f"重算失败：{_error_text(error)}")
        await _finalize(context, state)
    finally:
        await _release(context, uuid.UUID(state.table_id))


async def _guarded(
    context: RecomputeContext, state: RecomputeJobState
) -> RecomputeOutcome:
    """边算边续锁；续不上就中止重算，事务随之回滚。

    Args: context, state。
    """
    table_id = uuid.UUID(state.table_id)
    keeper = asyncio.create_task(_keep_lock(context, table_id))
    work = asyncio.create_task(_recompute_once(context, state))
    try:
        await asyncio.wait({keeper, work}, return_when=asyncio.FIRST_COMPLETED)
        if work.done():
            return work.result()
        work.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await work
        keeper.result()
        raise DatasetRecomputeLockLost(
            "重算中止：这张台账的锁已经不在本次任务手上"
        )
    finally:
        for task in (keeper, work):
            task.cancel()
        await asyncio.gather(keeper, work, return_exceptions=True)


async def _keep_lock(context: RecomputeContext, table_id: uuid.UUID) -> None:
    """每隔一段 CAS 续一次锁；续不上就抛。

    Args: context, table_id。
    """
    while True:
        await asyncio.sleep(RENEW_EVERY_S)
        if not await context.jobs.renew(table_id, context.token):
            raise DatasetRecomputeLockLost(
                "重算中止：这张台账的锁已经不在本次任务手上"
            )


async def _recompute_once(
    context: RecomputeContext, state: RecomputeJobState
) -> RecomputeOutcome:
    """在一个事务里算完整段；报脏挂在提交之后。

    Args: context, state。
    """
    table_id = uuid.UUID(state.table_id)
    async with context.sessions.session() as session:
        table = await table_crud.get(session, table_id)
        if table is None:
            raise DatasetBackfillInvalid("这张台账已被删除，重算中止")
        columns = await column_crud.list_by_table(session, table.id)
        scope = await build_scope(
            session, columns=columns, timezone=context.timezone
        )
        outcome = await recompute_range(
            session,
            scope,
            table_id=table.id,
            window=RecordWindow(
                table_id=table.id, since=state.since, until=state.until
            ),
        )
        if outcome.recomputed:
            await session.flush()
            mark_dirty(session, context.dirty, table.code)
    log_recompute(table_id, outcome)
    return outcome


def _record_outcome(
    state: RecomputeJobState, outcome: RecomputeOutcome
) -> None:
    """把算完的战果记进任务态。

    Args: state, outcome。
    """
    state.status = STATUS_DONE
    state.recomputed = outcome.recomputed
    state.failed = outcome.failed
    state.is_truncated = outcome.is_truncated
    state.limit = outcome.limit
    state.message = finish_message(state)


def finish_message(state: RecomputeJobState) -> str:
    """终态回执。求值出错与触顶都要说出来。

    Args: state。
    """
    text = f"已重算 {state.recomputed} 行"
    if state.failed:
        text += f"，其中 {state.failed} 行存在求值错误"
    if state.is_truncated:
        text += "；待重算的行数触顶，请缩小时间范围后再算一次"
    return text


async def _finalize(
    context: RecomputeContext, state: RecomputeJobState
) -> None:
    """写终态。⚠ 静默写：为一条写不进去的进度打断收尾，等于连锁都放不掉。

    Args: context, state。
    """
    now = utcnow()
    state.finished_at = now
    await context.jobs.write(state, at=now, is_quiet=True)


async def _release(context: RecomputeContext, table_id: uuid.UUID) -> None:
    """放锁。放不掉只记一条——锁自己会过期。

    Args: context, table_id。
    """
    try:
        await context.jobs.release(table_id, context.token)
    except Exception as error:
        _logger.warning(
            "dataset_recompute_release_failed",
            "重算锁没放掉，等它自己过期",
            table_id=str(table_id),
            error_type=type(error).__name__,
        )


def _error_text(error: Exception) -> str:
    """落进任务态的那句话。

    ⚠ 只有领域异常给原文：别的异常给类名，免得把 SQL 或内网地址抄进一个要
    展示给最终用户的字段。
    Args: error。
    """
    if isinstance(error, AppError):
        return error.message
    if isinstance(error, FormulaError):
        # 公式错误的原文本就是写给写公式的人看的
        return f"公式编译不过：{error}"
    if isinstance(error, TimeoutError):
        return f"超过 {RECOMPUTE_BUDGET_S:g} 秒的预算"
    return type(error).__name__

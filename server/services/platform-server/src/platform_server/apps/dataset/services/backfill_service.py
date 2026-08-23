"""历史回填的起跑、查进度与取消，以及后台任务的强引用。

回填是**用户显式触发的一次性任务**，不受采集总开关影响（§13.1）；它跑在受理
这次 POST 的那个进程里（fire-and-forget），故：

- **同表单飞**靠 Redis 上一把按表的锁，不是进程内的字典——起任务的副本与受理
  取消的副本可以是两个进程（§14.6）；
- **取消是协作式的**：写一个 Redis 标志，worker 在下一个批边界停下。用
  `task.cancel()` 只能停自己这个进程手上那个任务，别的副本上的照跑不误。
"""

import asyncio
import contextlib
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.utils.ids import uuid7
from lib.utils.timeutils import format_rfc3339, utcnow
from platform_server.apps.collect.services import point_service
from platform_server.apps.dataset.crud import column_crud
from platform_server.apps.dataset.errors import (
    DatasetBackfillBusy,
    DatasetBackfillNotRunning,
    DatasetBackfillUnreadable,
)
from platform_server.apps.dataset.models import DatasetTable
from platform_server.apps.dataset.schemas.backfill import (
    BackfillJobOut,
    BackfillStartIn,
)
from platform_server.apps.dataset.services.aggregate import HistoryReader
from platform_server.apps.dataset.services.backfill_jobs import (
    STATUS_RUNNING,
    BackfillJobs,
    BackfillJobState,
)
from platform_server.apps.dataset.services.backfill_plan import (
    RAW_PATH,
    BackfillPlan,
    PlanLimits,
    plan_backfill,
)
from platform_server.apps.dataset.services.backfill_run import (
    BackfillContext,
    run_backfill,
)
from platform_server.apps.dataset.services.collect_run import point_columns
from platform_server.apps.dataset.services.collector import Sessions, knobs_of
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.apps.dataset.services.table_service import require_table
from platform_server.apps.runtime_params.services import (
    SECTION_DATASET,
    param_service,
)
from platform_server.settings import Settings

_logger = get_logger("platform.dataset.backfill")


@dataclass
class BackfillRunner:
    """后台回填的起跑口，兼这些任务的强引用。

    ⚠ 强引用：事件循环只持有任务的弱引用，丢了引用的任务可能随时消失——现象是
    一次回填「起了、但什么都没补」，而日志里连一条失败都没有。
    ⚠ 引用挂在这个实例上而不是模块级：模块级可变状态会跨用例互相串（也就跨
    进程里的两个应用实例串），而这里一个进程一份，随容器一起装配。
    """

    sessions: Sessions
    history: HistoryReader
    dirty: DatasetDirtyLog
    jobs: BackfillJobs
    #: 运行参数的回落底数与本副本的身份。⚠ 每次现取而不是装配时抄一份：
    #: 环境变量是永久默认值，抄一份进内存等于让「恢复默认」永远回不到默认
    settings: Settings
    tasks: dict[uuid.UUID, asyncio.Task[None]] = field(
        default_factory=dict[uuid.UUID, "asyncio.Task[None]"]
    )
    stopped: asyncio.Event = field(default_factory=asyncio.Event)

    def launch(
        self,
        plan: BackfillPlan,
        state: BackfillJobState,
        *,
        token: str,
        batch_timeout_s: float,
    ) -> None:
        """起一个后台回填。POST 立刻返回，进度走 GET。

        Args: plan, state, token, batch_timeout_s。
        """
        table_id = uuid.UUID(state.table_id)
        task = asyncio.create_task(
            run_backfill(
                BackfillContext(
                    sessions=self.sessions,
                    history=self.history,
                    dirty=self.dirty,
                    jobs=self.jobs,
                    token=token,
                    batch_timeout_s=batch_timeout_s,
                    stopped=self.stopped,
                ),
                plan,
                state,
            ),
            name=f"dataset-backfill-{table_id.hex}",
        )
        self.tasks[table_id] = task
        task.add_done_callback(lambda _task: self.tasks.pop(table_id, None))

    def stop(self) -> None:
        """停收新活：在跑的任务补完手上这一批就收摊。⚠ 只置位，不等待。"""
        self.stopped.set()

    async def drain(self, timeout_s: float) -> None:
        """等在跑的回填收摊。超时就不等了，让后面的关停步骤照常进行。

        Args: timeout_s。
        """
        running = [task for task in self.tasks.values() if not task.done()]
        if not running:
            return
        with contextlib.suppress(TimeoutError):
            await asyncio.wait(running, timeout=timeout_s)


async def start_backfill(
    session: AsyncSession,
    runner: BackfillRunner,
    *,
    table_id: uuid.UUID,
    payload: BackfillStartIn,
) -> BackfillJobOut:
    """校验 → 定计划 → 抢锁 → 起后台任务，回初始任务态。

    Args: session, runner, table_id, payload。
    """
    settings = runner.settings
    table = await require_table(session, table_id)
    knobs = await _knobs_of(session, table, settings)
    now = utcnow()
    plan = plan_backfill(
        table,
        since=payload.since,
        until=payload.until,
        now=now,
        limits=knobs.limits,
    )
    # ⚠ 令牌一个任务一个：同一个进程重启之后留下的旧锁，新任务既抢不到也续不
    # 上，它只能等那把锁自己过期——这正是要的，而不是稀里糊涂接管别人的锁
    token = f"{settings.app_instance}:{uuid7().hex}"
    if not await runner.jobs.claim(table_id, token):
        raise DatasetBackfillBusy(
            f"台账「{table.code}」已经有一个回填在跑，"
            "等它结束、或者先取消（DELETE 同一路径）"
        )
    state = initial_state(table, plan, (payload.since, payload.until), now)
    await _record(runner, state, token=token, at=now)
    runner.launch(
        plan, state, token=token, batch_timeout_s=knobs.batch_timeout_s
    )
    _logger.info(
        "dataset_backfill_started",
        "回填任务已起",
        table_code=table.code,
        buckets=plan.total_buckets,
        is_clamped=plan.is_clamped,
    )
    return _to_out(state.to_payload())


async def _record(
    runner: BackfillRunner,
    state: BackfillJobState,
    *,
    token: str,
    at: datetime,
) -> None:
    """清掉上一次的取消标志，并把这一次的任务态落下去。

    ⚠ 抢到锁才清取消标志：上一次任务留下的标志会把这一次刚起的回填在第一个批
    边界直接毙掉，而回执里只说「已取消」，看不出取消的是上一次。
    ⚠ 落不下去就把锁放掉再抛：留着它等于让这张表的下一次回填白等一个 TTL，
    而界面上只会说「已经有一个回填在跑」——其实一个都没起来。
    Args: runner, state, token, at。
    """
    table_id = uuid.UUID(state.table_id)
    try:
        await runner.jobs.clear_cancel(table_id)
        await runner.jobs.write(state, at=at)
    except Exception:
        with contextlib.suppress(Exception):
            await runner.jobs.release(table_id, token)
        raise


async def read_progress(
    session: AsyncSession, jobs: BackfillJobs, *, table_id: uuid.UUID
) -> BackfillJobOut | None:
    """查这张表的回填进度；当前没有任务（或记录已过期）给 None。

    ⚠ 「没有任务」与「读不出来」是两个答案：后者由 `jobs.read` 响亮抛出，
    绝不在这里兜成 None——兜了的话，用户会在读不到的时候又发一次回填，
    而那一次撞上的是仍然握着锁的上一次。
    Args: session, jobs, table_id。
    """
    await require_table(session, table_id)
    found = await jobs.read(table_id)
    return None if found is None else _to_out(found)


async def cancel_backfill(
    session: AsyncSession, jobs: BackfillJobs, *, table_id: uuid.UUID
) -> BackfillJobOut:
    """请求取消：写标志，worker 在下一个批边界停下。没有在跑的任务就 404。

    Args: session, jobs, table_id。
    """
    await require_table(session, table_id)
    found = await jobs.read(table_id)
    if found is None or found.get("status") != STATUS_RUNNING:
        raise DatasetBackfillNotRunning("这张台账当前没有正在跑的回填任务")
    await jobs.request_cancel(table_id)
    _logger.info(
        "dataset_backfill_cancel_requested",
        "回填收到取消请求，当前这批跑完即停",
        table_id=str(table_id),
    )
    return _to_out(found)


@dataclass(frozen=True)
class _Knobs:
    """这一次回填的 clamp 口径与单批预算。"""

    limits: PlanLimits
    batch_timeout_s: float


async def _knobs_of(
    session: AsyncSession, table: DatasetTable, settings: Settings
) -> _Knobs:
    """取这一次回填要用的运行参数有效值与保留期下界。

    ⚠ 尾部避让读的是**运行参数有效值**而不是环境变量：`recompute_tail_buckets`
    是即时档，运维在界面上调大之后，采集器下一拍的射程就跟着变宽——按环境变量
    算出来的让位于是不够，两边开始写同一批桶（§13.2）。
    ⚠ 单批预算沿用「单表一拍」那一档：回填的一批与采集的一拍做的是同一件事
    ——一段桶、一次聚合、一次写入。
    Args: session, table, settings。
    """
    values = await param_service.effective_values(
        session, settings=settings, section=SECTION_DATASET
    )
    knobs = knobs_of(values, settings)
    columns = await column_crud.list_by_table(session, table.id)
    points = [
        (column.source_id, column.point_code)
        for column in point_columns(table, columns)
    ]
    return _Knobs(
        limits=PlanLimits(
            timezone=settings.dataset_bucket_timezone,
            retention_days=await point_service.strictest_retention_days(
                session, points=points
            ),
            recompute_tail_buckets=knobs.limits.recompute_tail_buckets,
        ),
        batch_timeout_s=knobs.table_timeout_s,
    )


def initial_state(
    table: DatasetTable,
    plan: BackfillPlan,
    requested: tuple[datetime, datetime],
    now: datetime,
) -> BackfillJobState:
    """这次回填刚起来时的任务态。

    ⚠ 公开出来是给用例用的：跑一次回填要「计划 + 任务态」两件，而用例要在**起跑
    之前**把取消标志按下去——走 `start_backfill` 的话它会先把标志清掉（那正是
    它该做的），于是那条路径永远测不到批边界上的取消。

    Args: table, plan, requested（用户原样提交的两端）, now。
    """
    since, until = requested
    return BackfillJobState(
        table_id=str(table.id),
        table_code=table.code,
        status=STATUS_RUNNING,
        interval_ms=table.collect_interval_ms,
        since=plan.first,
        until=plan.last,
        requested_since=since,
        requested_until=until,
        is_clamped=plan.is_clamped,
        fast_path=RAW_PATH,
        total_buckets=plan.total_buckets,
        started_at=now,
        updated_at=now,
        notes=list(plan.notes),
        message=(
            f"已开始回填 {plan.total_buckets} 个桶"
            f"（{format_rfc3339(plan.first)} 起）"
        ),
    )


def _to_out(payload: dict[str, object]) -> BackfillJobOut:
    """把 Redis 上那份 JSON 收窄成出参。

    ⚠ 形状对不上时抛「读不出来」而不是硬塞：那说明存着的是上一版的任务态，
    照着旧形状渲染出来的是一屏似是而非的数。
    Args: payload。
    """
    try:
        return BackfillJobOut.model_validate(payload)
    except ValidationError as error:
        raise DatasetBackfillUnreadable(
            "回填进度暂时读不出来，请稍后再看"
        ) from error

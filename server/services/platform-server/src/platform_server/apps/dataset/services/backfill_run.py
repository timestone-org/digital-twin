"""回填任务本体：分批推进 → 收尾重算 → 落终态。

**一批 = 一次聚合 = 一次 upsert = 一个事务**，取消只在批边界生效——半个批次
提交出去的是一段谁也解释不清的历史（docs/DATASET_DESIGN.md §14.5）。

⚠ 折桶、组行、写入一律走向前采集那一份（`services/collect_run.py` 与
`crud/record.py::upsert_collected`）：两份「桶怎么变成行」的实现是这块地方
唯一真正的风险——`row_id` 差一点点，同一个桶就长出第二行，而两行看起来都对。
⚠ 回填**绝不推进 `last_collected_ts`**：水位是向前采集的进度，回填补的是它
身后的历史。推一下的后果是采集器从此跳过中间那一段，而它看起来只是「那几天
没有数据」。
"""

import asyncio
import uuid
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from lib.logging import get_logger
from lib.utils.timeutils import utcnow
from platform_server.apps.dataset.crud import (
    RecordWindow,
    column_crud,
    record_crud,
    table_crud,
)
from platform_server.apps.dataset.errors import DatasetBackfillInvalid
from platform_server.apps.dataset.formula import FormulaError
from platform_server.apps.dataset.models import DatasetColumn
from platform_server.apps.dataset.services.aggregate import (
    HistoryReader,
    PointColumn,
    aggregate_cells,
)
from platform_server.apps.dataset.services.backfill_jobs import (
    STATUS_CANCELLED,
    STATUS_DONE,
    STATUS_FAILED,
    BackfillJobs,
    BackfillJobState,
)
from platform_server.apps.dataset.services.backfill_plan import (
    BackfillBatch,
    BackfillPlan,
    batch_window,
    slice_batches,
)
from platform_server.apps.dataset.services.collect_run import (
    collected_rows,
    manual_defaults,
    manual_keys,
    point_columns,
)
from platform_server.apps.dataset.services.collector import Sessions
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.apps.dataset.services.record_compute import (
    build_scope,
    recompute_range,
)
from platform_server.apps.dataset.services.record_history import ComputeScope

_logger = get_logger("platform.dataset.backfill")

# 进程收摊时那一句。⚠ 与「失败」共用一个状态是有意的：没跑完就是没跑完，
# 而它与用户按下的取消在界面上的处置完全不同
_STOPPED_MESSAGE = "回填中断（服务正在关停）；已写入的部分有效，重发即可续跑"


@dataclass(frozen=True)
class BackfillContext:
    """一次回填要用的协作者与预算。

    ⚠ `token` 一个任务一个：它是单飞锁的持有者标识，两个任务共用一个的话，
    先跑完的那个会把还在跑的那个的锁一起放掉。
    """

    sessions: Sessions
    history: HistoryReader
    dirty: DatasetDirtyLog
    jobs: BackfillJobs
    token: str
    #: 一批的预算，沿用单表一拍那一档（`PLATFORM_DATASET_TABLE_TIMEOUT_S`）
    batch_timeout_s: float
    #: 进程收摊的信号。⚠ 与用户按的取消分开：关停是「这次没跑完」，
    #: 而取消是「不用跑了」——两者在界面上的处置完全不同
    stopped: asyncio.Event


@dataclass(frozen=True)
class _Scope:
    """这张表补的时候要用到的那几件：表标识、全部列、能参与聚合的点位列。"""

    table_id: uuid.UUID
    columns: list[DatasetColumn]
    points: list[PointColumn]


async def run_backfill(
    context: BackfillContext, plan: BackfillPlan, state: BackfillJobState
) -> None:
    """后台回填协程：全程兜底，绝不把异常漏给事件循环。

    Args: context, plan, state。
    """
    try:
        await _run(context, plan, state)
    except asyncio.CancelledError:
        # 进程关停不是用户取消：如实记成失败更容易让人发现「它没跑完」。
        # ⚠ 绝不补写任何数据——已提交的批就是已提交的批，重发一次即可续上
        state.fail("进程关停", _STOPPED_MESSAGE)
        await _finalize(context, state)
        raise
    except Exception as error:
        _logger.error(
            "dataset_backfill_failed",
            "回填任务出错，已写入的部分仍然有效",
            table_code=state.table_code,
            error_type=type(error).__name__,
        )
        state.fail(_error_text(error), f"回填失败：{_error_text(error)}")
        await _finalize(context, state)
    finally:
        await _release(context, uuid.UUID(state.table_id))


async def _run(
    context: BackfillContext, plan: BackfillPlan, state: BackfillJobState
) -> None:
    """校验 → 分批推进 → 收尾重算 → 落终态。

    Args: context, plan, state。
    """
    scope = await _load_scope(context, uuid.UUID(state.table_id))
    if scope is None:
        raise DatasetBackfillInvalid("这张台账已被删除，回填中止")
    if not scope.points:
        state.status = STATUS_DONE
        state.message = "这张台账没有绑定点位的汇总列，没有可回填的内容"
        await _finalize(context, state)
        return
    await _fill_batches(context, plan, state, scope)
    # ⚠ 取消之后也要重算：已提交的批里公式列还空着，停在这里等于留下一批
    # 「原始值有、公式值没有」的行，而它们在表格里与真算出空值一模一样
    await _recompute_tail(context, plan, state, scope.columns)
    # ⚠ 失败态自己那句话不许被收尾文案盖掉：「锁丢了」与「服务正在关停」各有
    # 各的处置，换成一句通用的收尾等于把唯一能指路的那句话抹了
    if state.status != STATUS_FAILED:
        state.message = finish_message(state)
    await _finalize(context, state)
    _logger.info(
        "dataset_backfill_finished",
        "回填收摊",
        table_code=state.table_code,
        status=state.status,
        buckets=state.done_buckets,
        rows=state.written_rows,
        recomputed=state.recomputed,
    )


async def _fill_batches(
    context: BackfillContext,
    plan: BackfillPlan,
    state: BackfillJobState,
    scope: _Scope,
) -> None:
    """逐批补，每批之间看一眼取消标志、续一次锁。

    Args: context, plan, state, scope。
    """
    table_id = uuid.UUID(state.table_id)
    for batch in slice_batches(plan):
        if context.stopped.is_set():
            state.fail("进程关停", _STOPPED_MESSAGE)
            return
        if await context.jobs.is_cancelled(table_id):
            state.status = STATUS_CANCELLED
            return
        rows = await _write_batch(context, plan, batch, scope)
        _advance(state, batch, rows)
        if rows:
            # 逐批报脏，让大屏随进度长出数据而不是最后一次性跳变。
            # ⚠ 自开会话、不经请求级事务，故直接调而不是登记提交后钩子
            await context.dirty.mark(state.table_code)
        await context.jobs.write(state, at=utcnow(), is_quiet=True)
        if not await context.jobs.renew(table_id, context.token):
            state.fail(
                "单飞锁已失去", "回填中止：这张台账的回填锁已经不在本次任务手上"
            )
            return
        # ⚠ 主动让出：一批之间全是 IO，但一段几百批的回填仍会把同进程的
        # /health 与其余 API 顶在后面
        await asyncio.sleep(0)
    state.status = STATUS_DONE


async def _write_batch(
    context: BackfillContext,
    plan: BackfillPlan,
    batch: BackfillBatch,
    scope: _Scope,
) -> int:
    """算一批 → 一次 upsert → 提交，返回写出的行数。

    ⚠ 整批一个事务、一个预算：超时就是这一批整个不算数，绝不留半批。
    Args: context, plan, batch, scope。
    """
    async with asyncio.timeout(context.batch_timeout_s):
        cells = await aggregate_cells(
            context.history,
            columns=scope.points,
            window=batch_window(plan, batch),
        )
        rows = collected_rows(
            scope.table_id, cells, manual_defaults(scope.columns)
        )
        if not rows:
            return 0
        async with context.sessions.session() as session:
            await record_crud.upsert_collected(
                session,
                table_id=scope.table_id,
                rows=rows,
                manual_keys=manual_keys(scope.columns),
            )
    return len(rows)


async def _recompute_tail(
    context: BackfillContext,
    plan: BackfillPlan,
    state: BackfillJobState,
    columns: list[DatasetColumn],
) -> None:
    """重算 `[回填起点, 此刻]` —— **不是**回填区间。

    ⚠ 右界要拖到此刻：补进来的历史行会改变它**之后**每一行的 `PREV`、时间窗
    与整表统计，只重算补的那一段，后面那些行仍按缺了这一段的底数显示。
    ⚠ 重算完要**再报一次脏**：最后一批的 upsert 让新行的 `computed_json` 还
    空着，发布器在这个窗口里读到的是一片空的公式列（§16）。
    Args: context, plan, state, columns。
    """
    if not state.written_rows:
        return
    table_id = uuid.UUID(state.table_id)
    # ⚠ 进重算之前先续一次锁：这一趟可能跑上几分钟且中途没有续锁的缝，
    # 不续的话锁会在半路过期，下一个回填就能插进来跟它同时改写同一段
    await context.jobs.renew(table_id, context.token)
    async with context.sessions.session() as session:
        scope = await _compile(session, columns, plan.timezone, state)
        if scope is None:
            return
        outcome = await recompute_range(
            session,
            scope,
            table_id=table_id,
            window=RecordWindow(
                table_id=table_id, since=plan.first, until=utcnow()
            ),
        )
    _record_recompute(state, outcome.recomputed, outcome.failed)
    state.is_recompute_truncated = outcome.is_truncated
    if outcome.is_truncated:
        state.notes.append(
            f"待重算的行数触顶（{outcome.limit} 行），**重算没做完**，"
            "请对剩下的区间再手动重算一次"
        )
    if outcome.recomputed:
        await context.dirty.mark(state.table_code)


def finish_message(state: BackfillJobState) -> str:
    """终态回执：补了多少、重算了多少、有没有被裁过。

    Args: state。
    """
    head = {
        STATUS_DONE: "回填完成",
        STATUS_CANCELLED: "回填已取消",
    }.get(state.status, "回填结束")
    parts = [
        f"{head}：{state.done_buckets}/{state.total_buckets} 个桶，"
        f"写入 {state.written_rows} 行"
    ]
    if state.recomputed:
        parts.append(f"重算 {state.recomputed} 行")
    if state.is_recompute_truncated:
        parts.append("重算没做完，请手动重算剩余区间")
    if state.is_clamped:
        parts.append("请求的区间被调整过，详见说明")
    return "；".join(parts)


async def _load_scope(
    context: BackfillContext, table_id: uuid.UUID
) -> _Scope | None:
    """取这张表的列定义与能参与聚合的点位列；表已不在给 None。

    Args: context, table_id。
    """
    async with context.sessions.session() as session:
        table = await table_crud.get(session, table_id)
        if table is None:
            return None
        columns = await column_crud.list_by_table(session, table.id)
        return _Scope(
            table_id=table.id,
            columns=columns,
            points=point_columns(table, columns),
        )


async def _compile(
    session: AsyncSession,
    columns: list[DatasetColumn],
    timezone: str,
    state: BackfillJobState,
) -> ComputeScope | None:
    """编一份求值计划；没有公式列、或整表成环时给 None 并留一条说明。

    ⚠ 环不该把整次回填变成失败：原始值已经补进去了，界面该看到的是「补完了，
    但公式没算」，而不是一句「回填失败」——后者会让人以为行也没写进去。
    Args: session, columns, timezone, state。
    """
    try:
        scope = await build_scope(
            session, columns=columns, timezone=ZoneInfo(timezone)
        )
    except FormulaError as error:
        state.notes.append(f"公式编译不过，本次没有重算：{error}")
        return None
    return None if scope.plan.is_empty else scope


def _advance(state: BackfillJobState, batch: BackfillBatch, rows: int) -> None:
    """把这一批的战果记进任务态。

    Args: state, batch, rows。
    """
    state.done_buckets += batch.count
    state.written_rows += rows
    state.cursor = batch.last
    state.message = (
        f"回填中：{state.done_buckets}/{state.total_buckets} 个桶，"
        f"已写 {state.written_rows} 行"
    )


def _record_recompute(
    state: BackfillJobState, recomputed: int, failed: int
) -> None:
    """把重算的战果记进任务态。

    Args: state, recomputed, failed。
    """
    state.recomputed = recomputed
    state.recompute_failed = failed
    if failed:
        state.notes.append(
            f"重算时有 {failed} 行求值出错，那几格的公式值是空的，请检查公式"
        )


async def _finalize(context: BackfillContext, state: BackfillJobState) -> None:
    """写终态。

    ⚠ 静默写：数据早已落库，为了一条写不进去的进度把收尾链条打断，
    等于连锁都放不掉。
    Args: context, state。
    """
    now = utcnow()
    state.finished_at = now
    await context.jobs.write(state, at=now, is_quiet=True)


async def _release(context: BackfillContext, table_id: uuid.UUID) -> None:
    """放锁并清取消标志。放不掉只记一条——锁自己会过期。

    Args: context, table_id。
    """
    try:
        await context.jobs.release(table_id, context.token)
    except Exception as error:
        _logger.warning(
            "dataset_backfill_release_failed",
            "回填锁没放掉，等它自己过期",
            table_id=str(table_id),
            error_type=type(error).__name__,
        )


def _error_text(error: Exception) -> str:
    """落进任务态的那句话。

    ⚠ 只有领域异常给原文：别的异常给类名，免得把 SQL、表名或内网地址抄进一个
    要展示给最终用户的字段（api-contract §4.2）。
    Args: error。
    """
    if isinstance(error, AppError):
        return error.message
    if isinstance(error, TimeoutError):
        return "这一批超出了预算"
    return type(error).__name__

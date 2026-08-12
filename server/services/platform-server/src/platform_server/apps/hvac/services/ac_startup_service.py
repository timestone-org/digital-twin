"""抽取批次的生命周期：入队、跑一片、全部跑完后原子切换。

事务边界在这一层，crud 不提交。运行时口径见 docs/AC_STARTUP_DESIGN.md §5。
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.logging import get_logger
from lib.utils.timeutils import format_rfc3339
from platform_server.apps.hvac.crud import (
    ac_startup_batch_crud,
    ac_startup_episode_crud,
    ac_startup_exclusion_crud,
    ac_startup_shard_crud,
    room_crud,
)
from platform_server.apps.hvac.errors import (
    RoomNotFound,
    StartupRebuildInProgress,
    StartupSourceUnbound,
    TimeRangeInvalid,
)
from platform_server.apps.hvac.models import (
    AcStartupBatch,
    AcStartupExclusion,
    AcStartupShard,
)
from platform_server.apps.hvac.schemas import (
    StartupExclusionIn,
    StartupRebuildIn,
    TimeWindow,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_extract import (
    resolve_source_extent,
)
from platform_server.apps.hvac.services.ac_startup_queue import (
    ShardMessage,
    current_traceparent,
    publish_shards,
)
from platform_server.apps.hvac.services.ac_startup_rules import (
    LOGIC_VERSION,
    ExtractionRules,
)
from platform_server.apps.hvac.services.ac_startup_shards import (
    plan_months,
)
from platform_server.apps.hvac.startups import (
    BATCH_RETENTION,
    BATCH_STATUS_FAILED,
    BATCH_STATUS_READY,
    BATCH_STATUS_RUNNING,
    SHARD_STATUS_DONE,
    SHARD_STATUS_FAILED,
)
from platform_server.stream import StreamGroup, StreamLike

_logger = get_logger("platform.hvac.ac_startup")

# 与分片表的 CHECK 同口径
_MAX_REASON = 500


@dataclass(frozen=True)
class RebuildPlan:
    """一次重算的入队计划。

    ⚠ 消息**必须等事务提交之后再投**：提交前投出去，消费者可能先于提交读到
    批次行还不存在，而那是一个取决于调度时机的间歇性缺陷。
    """

    batch: AcStartupBatch
    messages: tuple[ShardMessage, ...]

    def dispatch(self) -> "ShardDispatch":
        """摘出投递要用的那点东西。

        ⚠ 与 ORM 实体解耦：投递发生在事务提交之后，那时实体已经脱离会话。
        """
        return ShardDispatch(batch_id=self.batch.id, messages=self.messages)


@dataclass(frozen=True)
class ShardDispatch:
    """要投出去的一批分片任务，不含任何 ORM 实体。"""

    batch_id: uuid.UUID
    messages: tuple[ShardMessage, ...]


@dataclass(frozen=True)
class ResolvedWindow:
    """定下来的抽取区间，以及它是不是被数据范围裁过。"""

    window: TimeWindow
    is_clamped: bool


async def resolve_window(
    session: AsyncSession,
    reader: AcSourceReader,
    *,
    room_id: uuid.UUID,
    asked: StartupRebuildIn,
) -> ResolvedWindow:
    """把入参的区间补齐并裁进数据范围。

    ⚠ 省掉的那一端按数据源里的实际范围算，不写死任何日期：今天的起点是 2023
    年只是当下的事实，现场会继续产出数据，也可能补录更早的。
    Args: session, reader, room_id, asked。
    """
    await _require_room(session, room_id)
    if asked.window_start is not None and asked.window_end is not None:
        _require_ordered(asked.window_start, asked.window_end)
    extent = await resolve_source_extent(session, reader, room_id=room_id)
    if extent is None:
        raise StartupSourceUnbound(
            "这个房间还没有可用的原始数据：先给空调绑定数据源，再重算"
        )
    start = max(asked.window_start or extent.start, extent.start)
    end = min(asked.window_end or extent.end, extent.end)
    if start >= end:
        raise TimeRangeInvalid(
            "这一段里没有数据；数据范围是 "
            f"{format_rfc3339(extent.start)} 到 {format_rfc3339(extent.end)}"
        )
    return ResolvedWindow(
        window=TimeWindow(start=start, end=end),
        is_clamped=_is_clamped(asked, start, end),
    )


def _is_clamped(
    asked: StartupRebuildIn, start: datetime, end: datetime
) -> bool:
    """要的那一段有没有被数据范围裁掉一截。省掉的一端不算被裁。

    Args: asked, start, end。
    """
    trimmed_start = (
        asked.window_start is not None and asked.window_start < start
    )
    trimmed_end = asked.window_end is not None and asked.window_end > end
    return trimmed_start or trimmed_end


def _require_ordered(start: datetime, end: datetime) -> None:
    """区间左端必须早于右端。

    Args: start, end。
    """
    if start >= end:
        raise TimeRangeInvalid("区间左端必须早于右端")


async def request_rebuild(
    session: AsyncSession,
    *,
    room_id: uuid.UUID,
    window: TimeWindow,
    rules: ExtractionRules,
) -> RebuildPlan:
    """建一个新批次并登记它的分片。只入队，不在这里抽取。

    ⚠ 新批次的 `is_current` 是假：先算、校验通过再原子切换，重算期间页面显示
    的仍然是上一批次的完整数据。
    Args: session, room_id, window, rules。
    """
    await _require_room(session, room_id)
    await _require_no_running_batch(session, room_id)
    months = plan_months(window.start, window.end)
    if not months:
        # ⚠ 空区间会切出零片，而零片的批次在收尾时「全都跑完了」当场成立：
        # 它会带着 0 条事件被切成当前批次，把这个房间的数据从页面上抹掉
        raise TimeRangeInvalid("抽取区间为空，无法切出任何分片")
    batch = _new_batch(room_id, window=window, rules=rules, shards=len(months))
    session.add(batch)
    await session.flush()
    await ac_startup_shard_crud.seed(session, batch.id, months)
    traceparent = current_traceparent()
    _logger.info(
        "ac_startup_batch_requested",
        "抽取批次已入队",
        room_id=str(room_id),
        batch_id=str(batch.id),
        shard_total=len(months),
    )
    return RebuildPlan(
        batch=batch,
        messages=tuple(
            ShardMessage(
                batch_id=batch.id,
                room_id=room_id,
                month=month,
                traceparent=traceparent,
            )
            for month in months
        ),
    )


def _new_batch(
    room_id: uuid.UUID,
    *,
    window: TimeWindow,
    rules: ExtractionRules,
    shards: int,
) -> AcStartupBatch:
    """造一个待跑的批次行。

    Args: room_id, window, rules, shards。
    """
    return AcStartupBatch(
        room_id=room_id,
        params_fingerprint=rules.fingerprint(),
        logic_version=LOGIC_VERSION,
        window_start=window.start,
        window_end=window.end,
        status=BATCH_STATUS_RUNNING,
        is_current=False,
        shard_total=shards,
        shard_done=0,
    )


async def finalize_if_complete(
    session: AsyncSession, batch_id: uuid.UUID
) -> AcStartupBatch | None:
    """全部分片跑完就收尾：校验、套用人工排除、原子切换、清理。

    ⚠ 先锁批次行：最后两片可能由两个 worker 同时跑完，两边都会看到「全都完成
    了」，不加锁就会各自收尾一次。
    Args: session, batch_id。
    """
    batch = await ac_startup_batch_crud.lock(session, batch_id)
    if batch is None or batch.status != BATCH_STATUS_RUNNING:
        return None
    counts = await ac_startup_shard_crud.count_by_status(session, batch_id)
    batch.shard_done = counts.get(SHARD_STATUS_DONE, 0)
    if counts.get(SHARD_STATUS_FAILED, 0):
        return await _fail(session, batch)
    if batch.shard_done < batch.shard_total:
        return None
    return await _publish(session, batch)


async def _fail(session: AsyncSession, batch: AcStartupBatch) -> AcStartupBatch:
    """把批次判成失败。

    ⚠ 上一批次一动不动：它仍然是当前批次，页面继续显示完整的旧数据。
    Args: session, batch。
    """
    batch.status = BATCH_STATUS_FAILED
    await session.flush()
    _logger.error(
        "ac_startup_batch_failed",
        "抽取批次有分片失败，当前批次保持不变",
        room_id=str(batch.room_id),
        batch_id=str(batch.id),
    )
    return batch


async def _publish(
    session: AsyncSession, batch: AcStartupBatch
) -> AcStartupBatch:
    """校验通过后把新批次切换成当前批次，并清理更老的。

    Args: session, batch。
    """
    episodes = await ac_startup_episode_crud.count_by_outcome(session, batch.id)
    batch.episode_count = sum(episodes.values())
    batch.unmatched_exclusion_count = (
        await ac_startup_exclusion_crud.count_unmatched(
            session, room_id=batch.room_id, batch_id=batch.id
        )
    )
    batch.status = BATCH_STATUS_READY
    await ac_startup_batch_crud.promote_current(session, batch)
    pruned = await ac_startup_batch_crud.prune(
        session, batch.room_id, keep=BATCH_RETENTION
    )
    _logger.info(
        "ac_startup_batch_ready",
        "抽取批次已切换为当前批次",
        room_id=str(batch.room_id),
        batch_id=str(batch.id),
        episode_count=batch.episode_count,
        unmatched_exclusions=batch.unmatched_exclusion_count,
        pruned=len(pruned),
    )
    return batch


async def fail_shard(
    session: AsyncSession, message: ShardMessage, *, reason: str
) -> None:
    """把一片记成失败，并让整批止步于失败。

    ⚠ 不重试：这条链路上没有任何一层在重试，逐层重试会相乘成雪崩。失败要看得
    见——批次判失败、上一批次照常服务，人看到了再重新触发。
    Args: session, message, reason。
    """
    await ac_startup_shard_crud.mark(
        session,
        AcStartupShard(batch_id=message.batch_id, month=message.month),
        status=SHARD_STATUS_FAILED,
        error=reason[:_MAX_REASON],
    )
    _logger.error(
        "ac_startup_shard_failed",
        "分片抽取失败",
        batch_id=str(message.batch_id),
        month=message.month,
        reason=reason[:_MAX_REASON],
    )


async def _require_room(session: AsyncSession, room_id: uuid.UUID) -> None:
    if await room_crud.get(session, room_id) is None:
        raise RoomNotFound("房间不存在")


async def _require_no_running_batch(
    session: AsyncSession, room_id: uuid.UUID
) -> None:
    """同一个房间同时只允许一次抽取在跑。

    ⚠ 不拦的话，连点几次按钮就是几份分片同时读同一段外库数据，最后只有一份
    能切成当前批次，其余全是白算——而外库是厂商的，白算的代价落在别人身上。
    Args: session, room_id。
    """
    if await ac_startup_batch_crud.find_running(session, room_id) is not None:
        raise StartupRebuildInProgress("这个房间已经有一次抽取在跑，请稍候")


async def dispatch_shards(
    stream: StreamLike,
    database: Database,
    *,
    target: StreamGroup,
    plan: ShardDispatch,
) -> None:
    """把分片任务投进队列。**必须在事务提交之后跑**。

    ⚠ 投递失败就把批次判失败：否则批次会永远停在「跑中」，进度停在 0/N，而
    没有任何一条消息在路上——页面看起来还在算，其实永远算不完。
    Args: stream, database, target, plan。
    """
    try:
        await publish_shards(
            stream, target=target, messages=list(plan.messages)
        )
    # 队列不可达时不重试：这条链路上没有任何一层在重试，失败要看得见
    except Exception as error:
        _logger.error(
            "ac_startup_dispatch_failed",
            "分片任务未能入队，批次判失败",
            batch_id=str(plan.batch_id),
            error=error,
        )
        await _open_and_fail(database, plan.batch_id)


async def fail_batch(
    session: AsyncSession, batch_id: uuid.UUID
) -> AcStartupBatch | None:
    """把还在跑的批次判失败；已经不在跑就什么都不做。

    ⚠ 先锁行再判状态：收尾与判失败可能同时发生，不锁就会把一个刚切换成功的
    批次改回失败。
    Args: session, batch_id。
    """
    batch = await ac_startup_batch_crud.lock(session, batch_id)
    if batch is None or batch.status != BATCH_STATUS_RUNNING:
        return None
    return await _fail(session, batch)


async def _open_and_fail(database: Database, batch_id: uuid.UUID) -> None:
    """另开一个事务把批次判失败——原来那个事务早已提交。

    Args: database, batch_id。
    """
    try:
        async with database.session() as session:
            await fail_batch(session, batch_id)
    # 连失败都记不下来时只剩日志
    except Exception as error:  # pragma: no cover - 依赖库同时不可用
        _logger.error(
            "ac_startup_batch_failure_unrecorded",
            "批次失败状态未能落库",
            batch_id=str(batch_id),
            error=error,
        )


async def put_exclusion(
    session: AsyncSession,
    *,
    room_id: uuid.UUID,
    started_at: datetime,
    payload: StartupExclusionIn,
    excluded_by: str,
) -> AcStartupExclusion:
    """按自然键写一条人工排除，重复调用是覆盖。

    ⚠ 不校验「这个时刻确实有一条事件」：排除挂在自然键上，重算后某些事件的
    起始时刻会平移，落空的那些由批次摘要里的计数报出来，而不是在这里拦下。
    Args: session, room_id, started_at, payload, excluded_by。
    """
    await _require_room(session, room_id)
    await ac_startup_exclusion_crud.upsert(
        session,
        AcStartupExclusion(
            room_id=room_id,
            started_at=started_at,
            reason=payload.reason,
            excluded_by=excluded_by,
        ),
    )
    await session.flush()
    _logger.info(
        "ac_startup_exclusion_set",
        "开机事件已人工排除",
        room_id=str(room_id),
        started_at=started_at.isoformat(),
    )
    found = await ac_startup_exclusion_crud.find(
        session, room_id=room_id, started_at=started_at
    )
    if found is None:  # pragma: no cover - 刚写完必然取得到
        raise RoomNotFound("人工排除写入后未能取回")
    return found


async def delete_exclusion(
    session: AsyncSession, *, room_id: uuid.UUID, started_at: datetime
) -> None:
    """取消一条人工排除。没排除过也算成功——DELETE 必须幂等。

    Args: session, room_id, started_at。
    """
    await _require_room(session, room_id)
    removed = await ac_startup_exclusion_crud.delete_by_key(
        session, room_id, started_at
    )
    if removed:
        _logger.info(
            "ac_startup_exclusion_cleared",
            "人工排除已取消",
            room_id=str(room_id),
            started_at=started_at.isoformat(),
        )

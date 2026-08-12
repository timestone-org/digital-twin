"""抽取批次的生命周期：入队、跑一片、全部跑完后原子切换。

事务边界在这一层，crud 不提交。运行时口径见 docs/AC_STARTUP_DESIGN.md §5。
"""

import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.hvac.crud import (
    ac_startup_batch_crud,
    ac_startup_episode_crud,
    ac_startup_exclusion_crud,
    ac_startup_shard_crud,
)
from platform_server.apps.hvac.datasets import (
    DATASET_RAW_MINUTE,
    find_dataset,
    metric_keys,
)
from platform_server.apps.hvac.errors import TimeRangeInvalid
from platform_server.apps.hvac.models import (
    AcDataBinding,
    AcMetricLimit,
    AcStartupBatch,
    AcStartupEpisode,
    AcStartupShard,
    AcUnit,
)
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_frames import (
    MetricBand,
    RoomUnit,
    build_frames,
)
from platform_server.apps.hvac.services.ac_startup_queue import (
    ShardMessage,
    current_traceparent,
)
from platform_server.apps.hvac.services.ac_startup_rules import (
    LOGIC_VERSION,
    Episode,
    ExtractionRules,
    extract_episodes,
)
from platform_server.apps.hvac.services.ac_startup_shards import (
    ShardRange,
    plan_months,
    shard_range,
)
from platform_server.apps.hvac.startups import (
    BATCH_RETENTION,
    BATCH_STATUS_FAILED,
    BATCH_STATUS_READY,
    BATCH_STATUS_RUNNING,
    SHARD_STATUS_DONE,
    SHARD_STATUS_FAILED,
)

_logger = get_logger("platform.hvac.ac_startup")

# 与分片表的 CHECK 同口径
_MAX_REASON = 500

# 抽取要读的指标列：判定只用三个，读数留档要全量
_RAW_DATASET = find_dataset(DATASET_RAW_MINUTE)
_RAW_COLUMNS = metric_keys(_RAW_DATASET) if _RAW_DATASET else ()


@dataclass(frozen=True)
class BoundUnit:
    """一台空调加上它读哪个数据源对象。"""

    unit: RoomUnit
    source_object: str


@dataclass(frozen=True)
class ExtractionContext:
    """跑一片要用的协作对象与参数。"""

    reader: AcSourceReader
    rules: ExtractionRules
    max_rows: int


@dataclass(frozen=True)
class RebuildPlan:
    """一次重算的入队计划。

    ⚠ 消息**必须等事务提交之后再投**：提交前投出去，消费者可能先于提交读到
    批次行还不存在，而那是一个取决于调度时机的间歇性缺陷。
    """

    batch: AcStartupBatch
    messages: tuple[ShardMessage, ...]


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


async def run_shard(
    session: AsyncSession,
    context: ExtractionContext,
    message: ShardMessage,
) -> int:
    """跑一片：取数、抽取、按归属区间写事件。返回写了多少条。

    ⚠ 全片幂等：事件按 `(batch_id, started_at)` upsert，分片状态按
    `(batch_id, month)` 覆盖。同一条消息重放多少次，结果都一样。
    Args: session, context, message。
    """
    batch = await ac_startup_batch_crud.get(session, message.batch_id)
    if batch is None or batch.status != BATCH_STATUS_RUNNING:
        # 批次已被清理或已判失败：这条消息迟到了，静默跳过而不是造一批孤儿行
        return 0
    window = shard_range(
        message.month,
        window_start=batch.window_start,
        window_end=batch.window_end,
        rules=context.rules,
    )
    episodes = await _extract(session, context, batch=batch, window=window)
    await ac_startup_episode_crud.upsert_many(
        session,
        [_to_row(batch, episode) for episode in episodes],
    )
    await ac_startup_shard_crud.mark(
        session,
        AcStartupShard(batch_id=batch.id, month=message.month),
        status=SHARD_STATUS_DONE,
    )
    return len(episodes)


async def _extract(
    session: AsyncSession,
    context: ExtractionContext,
    *,
    batch: AcStartupBatch,
    window: ShardRange,
) -> list[Episode]:
    """把一片的取数区间跑成事件，并只留归本片写的那些。

    Args: session, context, batch, window。
    """
    units = await load_bound_units(session, batch.room_id)
    if not units:
        return []
    rows = {
        bound.unit.serial: await context.reader.fetch_samples(
            source_object=bound.source_object,
            columns=_RAW_COLUMNS,
            window=TimeWindow(start=window.read_start, end=window.read_end),
            row_limit=context.max_rows,
        )
        for bound in units
    }
    frames = build_frames([bound.unit for bound in units], rows)
    found = extract_episodes(frames, rules=context.rules)
    # ⚠ 只写归属区间内的：取数越了界，事件也会多出来，不过滤就会与相邻分片
    # 各写一份同一次开机
    return [item for item in found if window.owns(item.started_at)]


def _to_row(batch: AcStartupBatch, episode: Episode) -> AcStartupEpisode:
    """抽取结果 → 事件行。

    Args: batch, episode。
    """
    return AcStartupEpisode(
        batch_id=batch.id,
        room_id=batch.room_id,
        started_at=episode.started_at,
        running_set=list(episode.running_set),
        complied_at=episode.complied_at,
        duration_minutes=episode.duration_minutes,
        outcome=episode.outcome,
        readings={
            serial: dict(values) for serial, values in episode.readings.items()
        },
    )


async def load_bound_units(
    session: AsyncSession, room_id: uuid.UUID
) -> list[BoundUnit]:
    """房间里绑定了原始数据的空调，连同它们各自的达标范围。

    ⚠ 没绑数据源的空调整台跳过：它一分钟数据都没有，留在房间清单里只会让
    每一帧都因「少一台」而作废。
    Args: session, room_id。
    """
    rows = await session.execute(
        select(AcUnit.id, AcUnit.serial, AcDataBinding.source_object)
        .join(AcDataBinding, AcDataBinding.ac_unit_id == AcUnit.id)
        .where(
            AcUnit.room_id == room_id,
            AcDataBinding.dataset == DATASET_RAW_MINUTE,
        )
        .order_by(AcUnit.serial.asc())
    )
    found = list(rows.all())
    bands = await _load_bands(
        session, frozenset(unit_id for unit_id, _, _ in found)
    )
    return [
        BoundUnit(
            unit=RoomUnit(serial=serial, bands=bands.get(unit_id, {})),
            source_object=source_object,
        )
        for unit_id, serial, source_object in found
    ]


async def _load_bands(
    session: AsyncSession, unit_ids: frozenset[uuid.UUID]
) -> dict[uuid.UUID, dict[str, MetricBand]]:
    """批量取一组空调的达标范围，逐台回查就是 N+1。

    Args: session, unit_ids。
    """
    if not unit_ids:
        return {}
    rows = await session.execute(
        select(
            AcMetricLimit.ac_unit_id,
            AcMetricLimit.metric,
            AcMetricLimit.lower_limit,
            AcMetricLimit.upper_limit,
        ).where(AcMetricLimit.ac_unit_id.in_(unit_ids))
    )
    found: dict[uuid.UUID, dict[str, MetricBand]] = {}
    for unit_id, metric, lower, upper in rows.all():
        found.setdefault(unit_id, {})[metric] = MetricBand(
            lower=_as_decimal(lower), upper=_as_decimal(upper)
        )
    return found


def _as_decimal(value: object) -> Decimal | None:
    return value if isinstance(value, Decimal) else None


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

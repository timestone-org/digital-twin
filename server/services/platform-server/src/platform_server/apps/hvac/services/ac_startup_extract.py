"""跑一片：取数、抽取、按归属区间写事件。

批次生命周期在 `ac_startup_service.py`。
"""

import uuid
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.crud import (
    ac_startup_batch_crud,
    ac_startup_episode_crud,
    ac_startup_shard_crud,
)
from platform_server.apps.hvac.datasets import (
    DATASET_RAW_MINUTE,
    find_dataset,
    metric_keys,
)
from platform_server.apps.hvac.models import (
    AcDataBinding,
    AcMetricLimit,
    AcStartupBatch,
    AcStartupEpisode,
    AcStartupShard,
    AcUnit,
)
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_source_reader import (
    AcSourceReader,
    SourceExtent,
)
from platform_server.apps.hvac.services.ac_startup_frames import (
    MetricBand,
    RoomUnit,
    build_frames,
)
from platform_server.apps.hvac.services.ac_startup_queue import ShardMessage
from platform_server.apps.hvac.services.ac_startup_rules import (
    Episode,
    ExtractionRules,
    extract_episodes,
)
from platform_server.apps.hvac.services.ac_startup_shards import (
    ExtractRange,
    shard_range,
)
from platform_server.apps.hvac.startups import (
    BATCH_STATUS_RUNNING,
    SHARD_STATUS_DONE,
    SHARD_STATUS_SKIPPED,
)

# 抽取要读的指标列：判定只用三个，读数留档要全量
_RAW_DATASET = find_dataset(DATASET_RAW_MINUTE)
_RAW_COLUMNS = metric_keys(_RAW_DATASET) if _RAW_DATASET else ()

# 一片跑完之后的去向
SHARD_RUN_EXTRACTED = "extracted"
SHARD_RUN_SKIPPED = "skipped"
SHARD_RUN_ORPHANED = "orphaned"


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
class ShardRun:
    """一片跑完之后的去向：抽了就是抽了，跳过了就是跳过了。

    ⚠ 调用方按 `outcome` 记日志，不许一律报成功：把跳过说成「分片抽取完成」，
    等于让日志替一件没发生的事作证——线上正是这样，43/45 卡了两轮而日志全绿。
    """

    outcome: str
    episode_count: int = 0
    reason: str | None = None


async def run_shard(
    session: AsyncSession,
    context: ExtractionContext,
    message: ShardMessage,
) -> ShardRun:
    """跑一片：取数、抽取、按归属区间写事件。返回这一片的去向。

    ⚠ 全片幂等：事件按 `(batch_id, started_at)` upsert，分片状态按
    `(batch_id, month)` 覆盖。同一条消息重放多少次，结果都一样。
    Args: session, context, message。
    """
    batch = await ac_startup_batch_crud.get(session, message.batch_id)
    if batch is None:
        # 批次行连同它的分片行一起被清理了：没有可落状态的地方，只能报出来
        return ShardRun(outcome=SHARD_RUN_ORPHANED, reason="批次已不存在")
    if batch.status != BATCH_STATUS_RUNNING:
        return await _skip(
            session, batch=batch, month=message.month, status=batch.status
        )
    window = shard_range(
        message.month,
        window_start=batch.window_start,
        window_end=batch.window_end,
        rules=context.rules,
    )
    episodes = await extract_window(
        session, context, room_id=batch.room_id, window=window
    )
    await ac_startup_episode_crud.upsert_many(
        session,
        [_to_row(batch, episode) for episode in episodes],
    )
    await ac_startup_shard_crud.mark(
        session,
        AcStartupShard(batch_id=batch.id, month=message.month),
        status=SHARD_STATUS_DONE,
    )
    return ShardRun(outcome=SHARD_RUN_EXTRACTED, episode_count=len(episodes))


async def _skip(
    session: AsyncSession, *, batch: AcStartupBatch, month: str, status: str
) -> ShardRun:
    """批次已经不在跑了：把这一片记成跳过，并说清为什么。

    ⚠ 必须落一个终态：消息马上就要被确认，分片行再停在 pending 就永远没人会
    回来跑它——批次于是卡在 43/45，而队列里一条消息都没有。
    Args: session, batch, month, status。
    """
    reason = f"批次已不在跑（{status}），这一片不再抽取"
    await ac_startup_shard_crud.mark(
        session,
        AcStartupShard(batch_id=batch.id, month=month),
        status=SHARD_STATUS_SKIPPED,
        error=reason,
    )
    return ShardRun(outcome=SHARD_RUN_SKIPPED, reason=reason)


async def extract_window(
    session: AsyncSession,
    context: ExtractionContext,
    *,
    room_id: uuid.UUID,
    window: ExtractRange,
) -> list[Episode]:
    """把一个取数区间跑成事件，并只留归这个区间写的那些。

    ⚠ 抽取的核心只有这一份：月分片与每日增量共用它，两边各写一份的话，
    「向两侧越界取数、按起始时刻归属」这条口径迟早只在一边成立。

    Args: session, context, room_id, window。
    """
    units = await load_bound_units(session, room_id)
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
        idle_minutes=episode.idle_minutes,
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


async def resolve_source_extent(
    session: AsyncSession, reader: AcSourceReader, *, room_id: uuid.UUID
) -> SourceExtent | None:
    """房间里全部绑定对象合起来覆盖的时间跨度；一台都没绑就给 None。

    ⚠ 取并集不取交集：某台空调是后装的、数据从去年才有，按交集算会把前面几年
    的历史整段切掉，而那正是样本最多的一段。
    Args: session, reader, room_id。
    """
    units = await load_bound_units(session, room_id)
    if not units:
        return None
    found = [
        extent
        for extent in [
            await reader.fetch_extent(bound.source_object) for bound in units
        ]
        if extent is not None
    ]
    if not found:
        return None
    return SourceExtent(
        start=min(extent.start for extent in found),
        end=max(extent.end for extent in found),
    )

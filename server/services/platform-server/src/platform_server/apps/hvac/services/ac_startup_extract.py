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
    ShardRange,
    shard_range,
)
from platform_server.apps.hvac.startups import (
    BATCH_STATUS_RUNNING,
    SHARD_STATUS_DONE,
)

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

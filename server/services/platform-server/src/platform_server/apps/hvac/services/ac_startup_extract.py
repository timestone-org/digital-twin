"""跑一片：取数、抽取、按归属区间写事件。

批次生命周期在 `ac_startup_service.py`。
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from functools import partial

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
    AcStartupBatch,
    AcStartupEpisode,
    AcStartupShard,
)
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_room_configuration import (
    BoundUnit,
    RoomConfiguration,
    restore_configuration,
)
from platform_server.apps.hvac.services.ac_source_reader import (
    AcSourceReader,
    SourceExtent,
    SourceRow,
)
from platform_server.apps.hvac.services.ac_startup_frames import (
    build_frames,
    compliant_at,
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
from platform_server.apps.hvac.services.sessions import Sessions
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
class ExtractionContext:
    """跑一片要用的协作对象与参数。"""

    reader: AcSourceReader
    rules: ExtractionRules
    max_rows: int
    configuration: RoomConfiguration | None = None


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
    sessions: Sessions, context: ExtractionContext, message: ShardMessage
) -> ShardRun:
    """在库外抽取并锁定批次结算。Args: sessions, context, message。"""
    async with sessions.session() as read:
        batch = await ac_startup_batch_crud.get(read, message.batch_id)
        if batch is None or batch.status != BATCH_STATUS_RUNNING:
            return await _inactive(read, batch, message.month)
        frozen = batch_context(batch, context)
        window = shard_range(
            message.month,
            window_start=batch.window_start,
            window_end=batch.window_end,
            rules=context.rules,
        )
    episodes = await extract_window(frozen, window=window)
    async with sessions.session() as write:
        current = await ac_startup_batch_crud.lock(write, message.batch_id)
        if current is None or current.status != BATCH_STATUS_RUNNING:
            return await _inactive(write, current, message.month)
        settled = await ac_startup_shard_crud.settle_pending(
            write,
            AcStartupShard(batch_id=current.id, month=message.month),
            status=SHARD_STATUS_DONE,
        )
        if not settled:
            return ShardRun(outcome=SHARD_RUN_SKIPPED, reason="分片已结算")
        await ac_startup_episode_crud.upsert_many(
            write, [to_episode_row(current, item) for item in episodes]
        )
    return ShardRun(outcome=SHARD_RUN_EXTRACTED, episode_count=len(episodes))


async def _inactive(
    session: AsyncSession, batch: AcStartupBatch | None, month: str
) -> ShardRun:
    """跳过抽取，只结算待处理的分片。Args: session, batch, month。"""
    if batch is None:
        return ShardRun(outcome=SHARD_RUN_ORPHANED, reason="批次已不存在")
    reason = f"批次已不在跑（{batch.status}），这一片不再抽取"
    await ac_startup_shard_crud.settle_pending(
        session,
        AcStartupShard(batch_id=batch.id, month=month),
        status=SHARD_STATUS_SKIPPED,
        error=reason,
    )
    return ShardRun(outcome=SHARD_RUN_SKIPPED, reason=reason)


async def extract_window(
    context: ExtractionContext,
    *,
    window: ExtractRange,
) -> list[Episode]:
    """把一个取数区间跑成事件，并只留归这个区间写的那些。

    ⚠ 抽取的核心只有这一份：月分片与每日增量共用它，两边各写一份的话，
    「向两侧越界取数、按起始时刻归属」这条口径迟早只在一边成立。

    Args: context, window。
    """
    if context.configuration is None:
        raise ValueError("批次缺少配置快照，请全量重算")
    units = context.configuration.units
    if not units:
        return []
    rows = {
        bound.unit.serial: _require_untruncated(
            bound.unit.serial,
            await context.reader.fetch_samples(
                source_object=bound.source_object,
                columns=_RAW_COLUMNS,
                window=TimeWindow(start=window.read_start, end=window.read_end),
                row_limit=context.max_rows,
            ),
            max_rows=context.max_rows,
        )
        for bound in units
    }
    room_units = [bound.unit for bound in units]
    timezone = context.reader.timezone
    frames = build_frames(room_units, rows, timezone=timezone)
    found = extract_episodes(
        frames,
        rules=context.rules,
        compliance=partial(compliant_at, units=room_units, timezone=timezone),
    )
    # ⚠ 只写归属区间内的：取数越了界，事件也会多出来，不过滤就会与相邻分片
    # 各写一份同一次开机
    return [item for item in found if window.owns(item.started_at)]


def _require_untruncated(
    serial: str, rows: list[SourceRow], *, max_rows: int
) -> list[SourceRow]:
    """取回的行数撞上上限就判失败。

    ⚠ 取数是升序 TOP，撞上上限意味着区间尾部被截掉了：照常抽取的话，月末
    那几天的开机会静默消失，而分片照样报「跑完了」。
    Args: serial, rows, max_rows。
    """
    if len(rows) >= max_rows:
        raise ValueError(f"{serial} 取数达到上限 {max_rows} 行，结果会被截断")
    return rows


def to_episode_row(batch: AcStartupBatch, episode: Episode) -> AcStartupEpisode:
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


async def merge_extents(
    reader: AcSourceReader, units: Sequence[BoundUnit]
) -> SourceExtent | None:
    """逐个对象问外库跨度再取并集；只碰外库，不碰会话。

    Args: reader, units。
    """
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


def batch_context(
    batch: AcStartupBatch, context: ExtractionContext
) -> ExtractionContext:
    """固定批次快照；缺失或不兼容时要求重算。Args: batch, context。"""
    if batch.configuration_snapshot is None:
        raise ValueError("批次缺少季节配置快照，请全量重算")
    configuration = restore_configuration(batch.configuration_snapshot)
    if (
        configuration.rules_fingerprint != context.rules.fingerprint()
        or configuration.timezone != context.reader.timezone
    ):
        raise ValueError("抽取规则或业务时区已变更，请全量重算")
    if configuration.fingerprint() != batch.params_fingerprint:
        raise ValueError("批次配置快照与指纹不一致，请全量重算")
    return replace(context, configuration=configuration)

"""开机事件面的读侧：事件列表、批次摘要与组合覆盖度。

写侧与生命周期在 `ac_startup_service.py`。口径见 docs/AC_STARTUP_DESIGN.md §7。
"""

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import FieldError, ValidationFailed
from lib.logging import get_logger
from lib.utils.timeutils import format_rfc3339
from lib.web import CursorPage, CursorParams, decode_cursor, encode_cursor
from platform_server.apps.hvac.crud import (
    EpisodePage,
    ac_startup_batch_crud,
    ac_startup_episode_crud,
    ac_startup_exclusion_crud,
    ac_startup_shard_crud,
    room_crud,
)
from platform_server.apps.hvac.errors import RoomNotFound, SourceUnavailable
from platform_server.apps.hvac.models import (
    AcStartupBatch,
    AcStartupEpisode,
    AcStartupExclusion,
)
from platform_server.apps.hvac.schemas import (
    MAX_FILTER_SERIALS,
    CombinationCoverageOut,
    SourceRangeOut,
    StartupBatchesOut,
    StartupBatchOut,
    StartupEpisodeOut,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_extract import (
    resolve_source_extent,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.startups import (
    BATCH_RETENTION,
    OUTCOMES,
    SHARD_STATUS_DONE,
)

_logger = get_logger("platform.hvac.ac_startup_query")

# 游标里锚点字段的名字，客户端不许解析
CURSOR_TIME_FIELD = "before"


async def list_episodes(
    session: AsyncSession,
    *,
    room_id: uuid.UUID,
    cursor: CursorParams,
    filters: EpisodePage,
) -> CursorPage[StartupEpisodeOut]:
    """当前批次里的开机事件，最新的在前，游标翻页。

    ⚠ 房间还没有当前批次是**合法的空状态**而不是错误：抽取还没跑过的房间，
    页面该显示「还没算过」，而不是一个红色的 404。
    Args: session, room_id, cursor, filters。
    """
    await _require_room(session, room_id)
    current = await ac_startup_batch_crud.find_current(session, room_id)
    if current is None:
        return CursorPage[StartupEpisodeOut](
            items=[], next=None, has_more=False
        )
    window = EpisodePage(
        limit=cursor.limit,
        before=_anchor_of(cursor.after),
        outcome=filters.outcome,
        running_set=filters.running_set,
    )
    rows = await ac_startup_episode_crud.page_by_batch(
        session, current.id, window=window
    )
    excluded = await ac_startup_exclusion_crud.map_by_room(session, room_id)
    return _to_page(rows, limit=cursor.limit, excluded=excluded)


def parse_filters(outcome: str | None, running_set: str | None) -> EpisodePage:
    """把两个 query 参数收成过滤条件；取值不在目录内直接 422。

    ⚠ 组合按 serial 升序归一：入参写成什么顺序都对得上库里那份排好序的数组，
    否则「K12,K11」会一条都查不到而看起来像没有数据。
    Args: outcome, running_set。
    """
    if outcome is not None and outcome not in OUTCOMES:
        raise _rejected("outcome", "结果取值不在目录内")
    serials = _parse_serials(running_set)
    return EpisodePage(limit=0, outcome=outcome, running_set=serials)


def _parse_serials(raw: str | None) -> tuple[str, ...] | None:
    if raw is None:
        return None
    serials = [item.strip() for item in raw.split(",") if item.strip()]
    if not serials:
        raise _rejected("running_set", "运行组合不能为空")
    if len(serials) > MAX_FILTER_SERIALS:
        raise _rejected("running_set", "运行组合里的空调台数超出上限")
    return tuple(sorted(set(serials)))


def _rejected(field: str, message: str) -> ValidationFailed:
    return ValidationFailed(
        message,
        details=(
            FieldError(field=field, code="invalid_filter", message=message),
        ),
    )


def _anchor_of(after: str | None) -> datetime | None:
    """游标解回锚点时刻；首页没有锚点。

    ⚠ 游标是客户端可以随手改的入参，任何一条解析失败的路径漏成异常就是 500。
    Args: after。
    """
    if after is None:
        return None
    payload = decode_cursor(after)
    moment = payload.get(CURSOR_TIME_FIELD)
    if moment is None:
        raise _rejected("after", "游标不可解析，请从上一页响应里原样带回")
    try:
        return datetime.fromisoformat(moment)
    except ValueError as error:
        raise _rejected(
            "after", "游标不可解析，请从上一页响应里原样带回"
        ) from error


def _to_page(
    rows: list[AcStartupEpisode],
    *,
    limit: int,
    excluded: dict[datetime, AcStartupExclusion],
) -> CursorPage[StartupEpisodeOut]:
    """多取的那一行只用来判断还有没有下一页。

    Args: rows, limit, excluded。
    """
    has_more = len(rows) > limit
    visible = rows[:limit]
    next_cursor = (
        encode_cursor(
            {CURSOR_TIME_FIELD: format_rfc3339(visible[-1].started_at)}
        )
        if has_more and visible
        else None
    )
    return CursorPage[StartupEpisodeOut](
        items=[_to_episode(row, excluded) for row in visible],
        next=next_cursor,
        has_more=has_more,
    )


def _to_episode(
    row: AcStartupEpisode, excluded: dict[datetime, AcStartupExclusion]
) -> StartupEpisodeOut:
    """事件行 → 对外模型，顺带套上人工排除。

    Args: row, excluded。
    """
    exclusion = excluded.get(row.started_at)
    return StartupEpisodeOut(
        started_at=row.started_at,
        running_set=list(row.running_set),
        complied_at=row.complied_at,
        outcome=row.outcome,
        readings=dict(row.readings),
        idle_minutes=row.idle_minutes,
        is_excluded=exclusion is not None,
        exclusion_reason=exclusion.reason if exclusion else None,
    )


async def list_batches(
    session: AsyncSession,
    reader: AcSourceReader,
    *,
    room_id: uuid.UUID,
    rules: ExtractionRules,
) -> StartupBatchesOut:
    """批次列表、当前批次、组合覆盖度、数据范围与「该不该重算」。

    Args: session, reader, room_id, rules。
    """
    await _require_room(session, room_id)
    rows = await ac_startup_batch_crud.list_by_room(
        session, room_id, limit=BATCH_RETENTION
    )
    current = await ac_startup_batch_crud.find_current(session, room_id)
    expected = rules.fingerprint()
    return StartupBatchesOut(
        items=[await _to_batch(session, row) for row in rows],
        current=(
            await _to_batch(session, current) if current is not None else None
        ),
        coverage=await _coverage(session, current),
        expected_fingerprint=expected,
        # ⚠ 没有当前批次时不算「过期」：那是「还没算过」，要人做的事不一样
        is_stale=current is not None and current.params_fingerprint != expected,
        source_range=await _source_range(session, reader, room_id),
    )


async def _source_range(
    session: AsyncSession, reader: AcSourceReader, room_id: uuid.UUID
) -> SourceRangeOut | None:
    """外库里实际有数据的那一段；没绑或外库不可达都给 None。

    ⚠ 外库抖一下不该让整页 503：这一页的主体是我们自己的批次数据，只有这一个
    字段依赖厂商库（CONTEXT §5）。取不到就说不知道，不返回陈旧值。
    Args: session, reader, room_id。
    """
    try:
        extent = await resolve_source_extent(session, reader, room_id=room_id)
    except SourceUnavailable as error:
        _logger.warning(
            "ac_startup_source_range_unavailable",
            "外库不可达，批次页不预设抽取范围",
            room_id=str(room_id),
            error=error,
        )
        return None
    if extent is None:
        return None
    return SourceRangeOut(start=extent.start, end=extent.end)


async def _coverage(
    session: AsyncSession, current: AcStartupBatch | None
) -> list[CombinationCoverageOut]:
    """当前批次里每个运行组合攒了多少条可用样本。

    Args: session, current。
    """
    if current is None:
        return []
    rows = await ac_startup_episode_crud.coverage(session, current.id)
    return [
        CombinationCoverageOut(running_set=running_set, usable_count=total)
        for running_set, total in rows
    ]


async def _to_batch(
    session: AsyncSession, row: AcStartupBatch
) -> StartupBatchOut:
    """批次行 → 对外模型。进度由分片行数出来，不信批次上的计数器。

    ⚠ 计数器可能落后：最后一片刚落库、批次还没收尾时，页面该看到 3/3 而不是
    2/3，否则进度条会停在 99% 不动。
    Args: session, row。
    """
    counts = await ac_startup_shard_crud.count_by_status(session, row.id)
    return StartupBatchOut(
        id=row.id,
        status=row.status,
        is_current=row.is_current,
        params_fingerprint=row.params_fingerprint,
        logic_version=row.logic_version,
        window_start=row.window_start,
        window_end=row.window_end,
        shard_total=row.shard_total,
        shard_done=counts.get(SHARD_STATUS_DONE, 0),
        episode_count=row.episode_count,
        unmatched_exclusion_count=row.unmatched_exclusion_count,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _require_room(session: AsyncSession, room_id: uuid.UUID) -> None:
    if await room_crud.get(session, room_id) is None:
        raise RoomNotFound("房间不存在")

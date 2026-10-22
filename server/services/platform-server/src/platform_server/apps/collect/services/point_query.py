"""点位状态查询：按批读配置与快照，在筛选后分页。见 COLLECT_DESIGN §9。"""

import asyncio
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import DependencyUnavailable
from lib.web import Page, PageParams
from platform_server.apps.collect.crud import point_crud
from platform_server.apps.collect.crud.point import PointCandidate, PointCursor
from platform_server.apps.collect.schemas import PointOut
from platform_server.apps.collect.schemas.point_query import PointStatus
from platform_server.apps.collect.services import point_service
from platform_server.apps.collect.services.presenters import to_point_out
from platform_server.apps.collect.services.snapshot_source import (
    PointReading,
    SnapshotSource,
)
from platform_server.apps.collect.services.state_source import (
    UNKNOWN,
    SourceRuntime,
    SourceStateSource,
)
from platform_server.apps.collect.services.transactions import (
    release_read_transaction,
)
from timeseries import compose_node_key

STATUS_QUERY_BATCH_SIZE = 500
STATUS_QUERY_TIMEOUT_S = 10.0


@dataclass(frozen=True)
class PointFilters:
    """点位配置与状态的组合条件。"""

    source_id: uuid.UUID | None
    keyword: str | None
    status: PointStatus


@dataclass(frozen=True)
class PointQueryContext:
    """状态查询依赖的旁路读侧与总预算。"""

    snapshots: SnapshotSource
    states: SourceStateSource
    timeout_s: float = STATUS_QUERY_TIMEOUT_S


@dataclass
class _Selection:
    """全量匹配计数与当前结果页的身份。"""

    page: PageParams
    ids: list[uuid.UUID] = field(default_factory=list[uuid.UUID])
    total: int = 0

    def include(self, point_id: uuid.UUID) -> None:
        """计数并保留当前页。Args: point_id。"""
        if self.page.offset <= self.total < self.page.offset + self.page.size:
            self.ids.append(point_id)
        self.total += 1


async def list_points(
    session: AsyncSession,
    context: PointQueryContext,
    *,
    filters: PointFilters,
    page: PageParams,
) -> Page[PointOut]:
    """先筛选全部候选，再返回匹配页。Args: session, context, filters, page。"""
    if filters.status == "all":
        return await point_service.list_points(
            session,
            source_id=filters.source_id,
            keyword=filters.keyword,
            page=page,
            sort=None,
        )
    try:
        async with asyncio.timeout(context.timeout_s):
            return await _filtered_page(session, context, filters, page)
    except TimeoutError as error:
        raise DependencyUnavailable(
            "点位状态查询超时，请缩小查询范围后重试"
        ) from error


async def _filtered_page(
    session: AsyncSession,
    context: PointQueryContext,
    filters: PointFilters,
    page: PageParams,
) -> Page[PointOut]:
    selection = _Selection(page)
    states: dict[uuid.UUID, SourceRuntime] = {}
    after: PointCursor | None = None
    while True:
        candidates = await point_crud.list_candidates(
            session,
            filters=(filters.source_id, filters.keyword),
            after=after,
            limit=STATUS_QUERY_BATCH_SIZE,
        )
        # ⚠ 只保留值对象，释放事务之后才能读取快照和采集运行态。
        await release_read_transaction(session)
        if not candidates:
            break
        await _load_states(context, candidates, states)
        readings = await context.snapshots.read(
            [
                compose_node_key(point.source_id, point.code)
                for point in candidates
            ]
        )
        _select_candidates(
            selection, candidates, readings, states, filters.status
        )
        after = candidates[-1].cursor
        if len(candidates) < STATUS_QUERY_BATCH_SIZE:
            break
    points = await point_crud.list_by_ids(session, selection.ids)
    return Page[PointOut](
        items=[to_point_out(point) for point in points],
        total=selection.total,
        page=page.page,
        size=page.size,
    )


async def _load_states(
    context: PointQueryContext,
    candidates: Sequence[PointCandidate],
    states: dict[uuid.UUID, SourceRuntime],
) -> None:
    """每个源只读一次运行态。Args: context, candidates, states。"""
    missing = sorted({point.source_id for point in candidates} - states.keys())
    if missing:
        found = await context.states.read(missing, is_strict=True)
        states.update(
            (source_id, found.get(source_id, UNKNOWN)) for source_id in missing
        )


def _select_candidates(
    selection: _Selection,
    candidates: Sequence[PointCandidate],
    readings: Mapping[str, PointReading],
    states: Mapping[uuid.UUID, SourceRuntime],
    wanted: PointStatus,
) -> None:
    """累计匹配点位并保留当前页。

    Args: selection, candidates, readings, states, wanted。
    """
    for point in candidates:
        reading = readings.get(compose_node_key(point.source_id, point.code))
        status = point_status(reading, states[point.source_id])
        if status == wanted or (wanted == "abnormal" and status != "good"):
            selection.include(point.id)


def point_status(
    reading: PointReading | None, source: SourceRuntime
) -> PointStatus:
    """按快照存在性、源运行态及质量分类。Args: reading, source。"""
    if reading is None:
        return "waiting"
    if source.state != "online":
        return "stale"
    if reading.quality != "good":
        return "abnormal"
    return "good"

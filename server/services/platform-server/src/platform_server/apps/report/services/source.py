"""报告的台账取数适配，只经台账公开服务面。"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import (
    ColumnSpec,
    EffectiveRow,
    EffectiveWindow,
    column_service,
    record_read,
    table_service,
)

MAX_ROWS = 20_000
_EPSILON = timedelta(microseconds=1)


@dataclass(frozen=True)
class SourceWindow:
    """有界取数请求。"""

    table: str
    since: datetime | None
    until: datetime
    limit: int = MAX_ROWS
    is_stale: bool = False


@dataclass(frozen=True)
class SourceData:
    """生效值与列清单。"""

    rows: tuple[EffectiveRow, ...]
    columns: tuple[ColumnSpec, ...]
    is_truncated: bool
    is_stale: bool = False


async def read_window(
    session: AsyncSession, wanted: SourceWindow
) -> SourceData:
    """读取半开区间，转换当前台账的闭区间上界。Args: session, wanted。"""
    table_id = await table_service.resolve_table_code(session, wanted.table)
    columns = await column_service.list_column_specs(session, table_id=table_id)
    scan = await record_read.scan_effective(
        session,
        window=EffectiveWindow(
            table_id=table_id, since=wanted.since, until=wanted.until - _EPSILON
        ),
        limit=wanted.limit,
    )
    return SourceData(
        rows=scan.rows,
        columns=columns,
        is_truncated=scan.is_truncated,
        is_stale=wanted.is_stale,
    )


async def latest_stamp(
    session: AsyncSession, table: str, until: datetime
) -> datetime | None:
    """取报告期末之前的最新时刻。Args: session, table, until。"""
    found = await read_window(
        session, SourceWindow(table=table, since=None, until=until, limit=1)
    )
    return found.rows[-1].ts if found.rows else None

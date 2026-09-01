"""记录的读侧：游标翻页、最新一行、时间序列。

⚠ 时序集合一律游标分页：页码分页在持续写入的表上会静默重复与漏行
（api-contract §5.1）。
⚠ 截断口径只有一份（§6.2）：留下的是**最新**那批，触顶靠多查一行判定而不是
拿 `len(rows) == limit` 猜——恰好只有上限那么多行时数据其实是完整的，猜法会
把它误报成截断，用户于是被劝去缩小一个根本不需要缩的时间范围。
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError, ValidationFailed
from lib.utils.timeutils import format_rfc3339, to_utc
from lib.web import CursorPage, CursorParams, decode_cursor, encode_cursor
from platform_server.apps.dataset.crud import RecordWindow, record_crud
from platform_server.apps.dataset.models import DatasetRecord
from platform_server.apps.dataset.schemas import (
    DatasetSeriesPointOut,
    LatestOut,
    RecordOut,
    SeriesOut,
)
from platform_server.apps.dataset.schemas.record import MAX_SERIES_ROWS
from platform_server.apps.dataset.services.effective import (
    effective_merged,
    effective_values,
)
from platform_server.apps.dataset.services.presenters import to_record_out
from platform_server.apps.dataset.services.table_service import require_table

# 游标里的两个锚点键。⚠ 两个都要——同一个 ts 上可以有多行，只锚 ts 会在翻页
# 时重复或漏掉其中一行
_CURSOR_TS = "ts"
_CURSOR_ROW = "row_id"


@dataclass(frozen=True)
class RecordFilters:
    """记录列表的时间过滤。两端都留空就是不限。"""

    since: datetime | None = None
    until: datetime | None = None


@dataclass(frozen=True)
class WindowScan:
    """一次窗口扫描的结果。

    `rows` 是 **ts 倒序**（最新在前）：反扫是截断口径的一部分而不是实现细节，
    触顶时留下的必须是最新那批。要正序的调用方自己反转。
    """

    rows: list[DatasetRecord]
    is_truncated: bool
    limit: int


def parse_filters(*, since: str | None, until: str | None) -> RecordFilters:
    """把两个时间过滤参数解成时刻。写错格式当场 400，不静默当成不限。

    Args: since, until。
    """
    return RecordFilters(
        since=_parse_moment(since, "since"),
        until=_parse_moment(until, "until"),
    )


def _parse_moment(raw: str | None, field: str) -> datetime | None:
    """把 query 里的时刻串解成 UTC aware 的时刻。

    ⚠ 解不动就是 400 而不是当成没给：当成没给的话，一个写错了格式的时间范围
    会静默退化成「不限」，而用户以为自己筛过了。
    Args: raw, field。
    """
    if raw is None:
        return None
    try:
        return to_utc(datetime.fromisoformat(raw))
    except ValueError as error:
        raise ValidationFailed(
            "时刻格式不合法",
            details=(
                FieldError(
                    field=field,
                    code="invalid_moment",
                    message="应为 RFC3339 时刻，例如 2026-08-23T10:00:00Z",
                ),
            ),
        ) from error


async def list_records(
    session: AsyncSession,
    *,
    table_id: uuid.UUID,
    filters: RecordFilters,
    page: CursorParams,
) -> CursorPage[RecordOut]:
    """按数据时间倒序翻一页。

    Args: session, table_id, filters, page。
    """
    table = await require_table(session, table_id)
    window = RecordWindow(
        table_id=table.id,
        since=filters.since,
        until=filters.until,
        after_key=_anchor_of(page.after),
    )
    scan = await scan_window(session, window=window, limit=page.limit)
    return CursorPage[RecordOut](
        items=[to_record_out(row) for row in scan.rows],
        next=_next_cursor(scan),
        has_more=scan.is_truncated,
    )


async def scan_window(
    session: AsyncSession, *, window: RecordWindow, limit: int
) -> WindowScan:
    """窗口扫描的**唯一**实现：反扫取最新的 `limit` 行，多查一行判触顶。

    Args: session, window, limit。
    """
    fetched = await record_crud.scan_newest(session, window=window, limit=limit)
    return WindowScan(
        rows=fetched[:limit], is_truncated=len(fetched) > limit, limit=limit
    )


@dataclass(frozen=True)
class EffectiveRow:
    """一行的生效值，纯数据。跨模块取数只经这个形状，ORM 实例不出本模块。"""

    ts: datetime
    source: str
    values: dict[str, object]


@dataclass(frozen=True)
class EffectiveScan:
    """一段时间窗上的生效值。`rows` 按 ts **正序**，最早的在前。"""

    rows: tuple[EffectiveRow, ...]
    is_truncated: bool


@dataclass(frozen=True)
class EffectiveWindow:
    """整段取数的边界。`sources` 空元组表示不限来源。"""

    table_id: uuid.UUID
    since: datetime | None = None
    until: datetime | None = None
    sources: tuple[str, ...] = ()


async def scan_effective(
    session: AsyncSession, *, window: EffectiveWindow, limit: int
) -> EffectiveScan:
    """按时间窗取一段行的**生效值**，供台账之外的模块整段取数用。

    ⚠ 取的是 `effective_merged`：人工修正优先、公式结果覆盖同名键。跨模块自己
    拼一份 `values ∪ overrides` 的现象是「拿去算的是原值、界面上看的是修正值」，
    两边各自自洽，排查时几乎不会怀疑到取值口径上（§11.2 D8）。
    ⚠ 触顶时留下的是**最新**那批，与 `scan_window` 同一口径；`is_truncated`
    必须被调用方如实往上传，不许吞掉。
    Args: session, window, limit。
    """
    table = await require_table(session, window.table_id)
    scan = await scan_window(
        session,
        window=RecordWindow(
            table_id=table.id,
            since=window.since,
            until=window.until,
            sources=window.sources,
        ),
        limit=limit,
    )
    return EffectiveScan(
        rows=tuple(
            EffectiveRow(
                ts=row.ts, source=row.source, values=effective_merged(row)
            )
            for row in reversed(scan.rows)
        ),
        is_truncated=scan.is_truncated,
    )


async def read_latest(
    session: AsyncSession, *, table_id: uuid.UUID
) -> LatestOut:
    """最后一行的值。一行都没有时 `ts` 为空、两份值都是空字典。

    ⚠ 给的是 effective：大屏上显示的必须是人工修正之后的那个数。
    Args: session, table_id。
    """
    table = await require_table(session, table_id)
    record = await record_crud.latest(session, table.id)
    if record is None:
        return LatestOut(ts=None, values={}, computed={})
    return LatestOut(
        ts=record.ts,
        values=effective_values(record),
        computed=dict(record.computed_json or {}),
    )


async def read_series(
    session: AsyncSession,
    *,
    table_id: uuid.UUID,
    keys: list[str],
    filters: RecordFilters,
) -> SeriesOut:
    """若干列的时间序列，按 ts 升序。

    Args: session, table_id, keys, filters。
    """
    table = await require_table(session, table_id)
    wanted = _require_keys(keys)
    scan = await scan_window(
        session,
        window=RecordWindow(
            table_id=table.id, since=filters.since, until=filters.until
        ),
        limit=MAX_SERIES_ROWS,
    )
    series: dict[str, list[DatasetSeriesPointOut]] = {key: [] for key in wanted}
    # 反扫取的是最新 N 行，对外契约按时刻升序
    for record in reversed(scan.rows):
        merged = effective_merged(record)
        for key in wanted:
            value = merged.get(key)
            if value is not None:
                series[key].append(
                    DatasetSeriesPointOut(ts=record.ts, value=value)
                )
    return SeriesOut(
        series=series, is_truncated=scan.is_truncated, limit=scan.limit
    )


def _require_keys(keys: list[str]) -> list[str]:
    """列 key 至少要点名一个。

    Args: keys。
    """
    wanted = [item.strip() for item in keys if item.strip()]
    if wanted:
        return wanted
    raise ValidationFailed(
        "至少要点名一列",
        details=(
            FieldError(
                field="keys",
                code="empty_keys",
                message="用逗号分隔要取的列 key",
            ),
        ),
    )


def _next_cursor(scan: WindowScan) -> str | None:
    """下一页的锚点；没有下一页给 None。

    Args: scan。
    """
    if not scan.is_truncated or not scan.rows:
        return None
    last = scan.rows[-1]
    return encode_cursor(
        {_CURSOR_TS: format_rfc3339(last.ts), _CURSOR_ROW: str(last.row_id)}
    )


def _anchor_of(after: str | None) -> tuple[datetime, uuid.UUID] | None:
    """把不透明游标解回锚点。

    ⚠ 游标是客户端可以随手改的入参，任何一条解析失败的路径漏成异常就是 500。
    Args: after。
    """
    if after is None:
        return None
    payload = decode_cursor(after)
    try:
        return (
            datetime.fromisoformat(payload[_CURSOR_TS]),
            uuid.UUID(payload[_CURSOR_ROW]),
        )
    except (KeyError, ValueError) as error:
        raise ValidationFailed(
            "游标不可解析",
            details=(
                FieldError(
                    field="after",
                    code="invalid_cursor",
                    message="游标不可解析，请从上一页响应里原样带回",
                ),
            ),
        ) from error

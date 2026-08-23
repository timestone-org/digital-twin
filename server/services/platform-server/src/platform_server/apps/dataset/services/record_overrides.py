"""人工修正的写、撤与按列批量清除。

⚠ 只认 `source='point'` 的列：人工录入列该直接编辑原始值、公式列该改公式，
两者都当场报错而不是静默忽略（§8.4）。
⚠ 某一格提交为空 = **撤销**那一格的修正，不是「把它改成空」——回执必须把这
两件事分开说，否则用户撤了一格却看到「已修正 1 格」。
"""

import asyncio
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.utils.timeutils import utcnow
from platform_server.apps.dataset.crud import (
    RecordWindow,
    column_crud,
    record_crud,
)
from platform_server.apps.dataset.models import DatasetColumn, DatasetRecord
from platform_server.apps.dataset.schemas import (
    OverrideBulkClearIn,
    OverrideBulkClearOut,
    OverrideClearIn,
    OverrideWriteIn,
    OverrideWriteOut,
)
from platform_server.apps.dataset.services.dirty import mark_dirty
from platform_server.apps.dataset.services.record_compute import (
    MAX_RECOMPUTE_ROWS,
    YIELD_EVERY,
    RecomputeOutcome,
    build_scope,
    recompute_range,
)
from platform_server.apps.dataset.services.record_history import ComputeScope
from platform_server.apps.dataset.services.record_values import (
    Actor,
    coerce,
    make_override,
    rejected,
)
from platform_server.apps.dataset.services.record_write import (
    RecordLocator,
    RecordWriter,
    recompute_row,
    require_record,
    write_out,
)
from platform_server.apps.dataset.services.table_service import require_table

_logger = get_logger("platform.dataset.override")


async def write_overrides(
    session: AsyncSession,
    writer: RecordWriter,
    *,
    locator: RecordLocator,
    payload: OverrideWriteIn,
) -> OverrideWriteOut:
    """把一行里若干格改成人工判断的值。

    改的是 `overrides_json`，`values_json` 里的采集原值一个字都不动——于是
    「原值是多少」与「谁在什么时候改成了什么」两笔账同时留着，聚合采集器重算
    时也知道该绕开哪些格。
    Args: session, writer, locator, payload。
    """
    table = await require_table(session, locator.table_id)
    record = await require_record(session, locator)
    columns = await column_crud.list_by_table(session, table.id)
    before = set(record.overrides_json or {})
    entries, dropped = _entries_of(
        payload.values, columns, actor=writer.actor, reason=payload.reason
    )
    record.overrides_json = _merged(record, entries, dropped) or None
    scope = await build_scope(
        session, columns=columns, timezone=writer.timezone
    )
    await recompute_row(session, scope, record)
    await session.flush()
    mark_dirty(session, writer.dirty, table.code)
    cleared = sorted(before - set(record.overrides_json or {}))
    _log_write(table.id, record, written=sorted(entries), cleared=cleared)
    return await _override_out(session, scope, record, cleared)


async def clear_overrides(
    session: AsyncSession,
    writer: RecordWriter,
    *,
    locator: RecordLocator,
    payload: OverrideClearIn | None,
) -> OverrideWriteOut:
    """撤销一行的人工修正。`keys` 缺省即整行全撤。

    撤掉之后这些格回落到 `values_json` 里的原值，公式随之重算。
    Args: session, writer, locator, payload。
    """
    table = await require_table(session, locator.table_id)
    record = await require_record(session, locator)
    columns = await column_crud.list_by_table(session, table.id)
    existing = dict(record.overrides_json or {})
    keys = None if payload is None else payload.keys
    remaining = (
        {}
        if keys is None
        else {
            key: entry
            for key, entry in existing.items()
            if key not in set(keys)
        }
    )
    scope = await build_scope(
        session, columns=columns, timezone=writer.timezone
    )
    cleared = sorted(set(existing) - set(remaining))
    if cleared:
        record.overrides_json = remaining or None
        await recompute_row(session, scope, record)
        await session.flush()
        mark_dirty(session, writer.dirty, table.code)
    return await _override_out(session, scope, record, cleared)


async def clear_overrides_in_range(
    session: AsyncSession,
    writer: RecordWriter,
    *,
    table_id: uuid.UUID,
    payload: OverrideBulkClearIn,
) -> OverrideBulkClearOut:
    """按列 + 时间范围批量撤销修正，随后重算受影响的区间。

    ⚠ 用到整表聚合时必须整表重算：`*_ALL` 一变，比被清区间更早的行也过期了。
    Args: session, writer, table_id, payload。
    """
    table = await require_table(session, table_id)
    columns = await column_crud.list_by_table(session, table.id)
    _require_known(payload.column_keys, columns)
    scope = await build_scope(
        session, columns=columns, timezone=writer.timezone
    )
    swept = await _sweep(session, table.id, payload)
    if not swept.rows:
        return _bulk_out(swept, RecomputeOutcome(0, 0, False, 0))
    await session.flush()
    mark_dirty(session, writer.dirty, table.code)
    outcome = await recompute_range(
        session,
        scope,
        table_id=table.id,
        window=RecordWindow(
            table_id=table.id,
            since=None if scope.plan.needs_whole else swept.earliest,
        ),
    )
    _log_bulk(table.id, swept, outcome)
    return _bulk_out(swept, outcome)


@dataclass
class _Swept:
    """一次批量撤销扫过之后的账。"""

    rows: int = 0
    cells: int = 0
    is_truncated: bool = False
    #: 最早被清掉修正的那一行的时刻——随后的重算从它开始
    earliest: datetime | None = None


async def _sweep(
    session: AsyncSession, table_id: uuid.UUID, payload: OverrideBulkClearIn
) -> _Swept:
    """把范围内这几列的修正逐行摘掉。

    ⚠ 只扫真有修正的行（`has_overrides`），并按 ts 升序推进：随后的重算要从
    最早被清的那一行开始。
    Args: session, table_id, payload。
    """
    fetched = await record_crud.scan_oldest(
        session,
        window=RecordWindow(
            table_id=table_id,
            since=payload.since,
            until=payload.until,
            has_overrides=True,
        ),
        limit=MAX_RECOMPUTE_ROWS,
    )
    swept = _Swept()
    swept.is_truncated = len(fetched) > MAX_RECOMPUTE_ROWS
    wanted = set(payload.column_keys)
    for position, record in enumerate(fetched[:MAX_RECOMPUTE_ROWS]):
        _strip(record, wanted, swept)
        # ⚠ 纯内存的长循环要主动让出：几万行连着摘会把同进程的 /health 与
        # 其余请求一起卡住几十秒
        if (position + 1) % YIELD_EVERY == 0:
            await asyncio.sleep(0)
    return swept


def _strip(record: DatasetRecord, wanted: set[str], swept: _Swept) -> None:
    """摘掉一行里点名的那几格修正。

    Args: record, wanted, swept。
    """
    existing = dict(record.overrides_json or {})
    hit = wanted & set(existing)
    if not hit:
        return
    for key in hit:
        del existing[key]
    record.overrides_json = existing or None
    swept.rows += 1
    swept.cells += len(hit)
    if swept.earliest is None:
        swept.earliest = record.ts


def _entries_of(
    raw: dict[str, Any],
    columns: Sequence[DatasetColumn],
    *,
    actor: Actor,
    reason: str | None,
) -> tuple[dict[str, Any], set[str]]:
    """把提交的一批值翻成修正条目，顺带记下要撤销的那几列。

    Args: raw, columns, actor, reason。
    """
    by_key = {column.key: column for column in columns}
    moment = utcnow()
    entries: dict[str, Any] = {}
    dropped: set[str] = set()
    for key, value in raw.items():
        column = _writable(key, by_key.get(key))
        coerced = coerce(value, column)
        if coerced is None:
            dropped.add(key)
            continue
        entries[key] = make_override(
            coerced, actor=actor, reason=reason, at=moment
        )
    return entries, dropped


def _writable(key: str, column: DatasetColumn | None) -> DatasetColumn:
    """这一列收不收人工修正。

    Args: key, column。
    """
    if column is None:
        raise rejected(key, f"列「{key}」不存在")
    if column.source != "point":
        raise rejected(
            key,
            f"列「{column.name}」不是点位汇总列，不能写人工修正："
            "人工录入列请直接编辑原始值，公式列请改公式",
        )
    return column


def _merged(
    record: DatasetRecord, entries: dict[str, Any], dropped: set[str]
) -> dict[str, Any]:
    """既有修正 + 本次提交：显式提交为空的删掉，其余保留。

    Args: record, entries, dropped。
    """
    merged = {
        key: entry
        for key, entry in (record.overrides_json or {}).items()
        if key not in dropped
    }
    merged.update(entries)
    return merged


def _require_known(
    keys: Sequence[str], columns: Sequence[DatasetColumn]
) -> None:
    """点名的列必须都存在。

    Args: keys, columns。
    """
    known = {column.key for column in columns}
    unknown = sorted(set(keys) - known)
    if unknown:
        raise rejected(unknown[0], f"列不存在：{'、'.join(unknown)}")


async def _override_out(
    session: AsyncSession,
    scope: ComputeScope,
    record: DatasetRecord,
    cleared: list[str],
) -> OverrideWriteOut:
    """修正面的回执 = 写入回执 + 本次撤掉了哪几格。

    Args: session, scope, record, cleared。
    """
    written = await write_out(session, scope, record)
    return OverrideWriteOut(
        record=written.record,
        has_stale_downstream=written.has_stale_downstream,
        cleared=cleared,
    )


def _bulk_out(swept: _Swept, outcome: RecomputeOutcome) -> OverrideBulkClearOut:
    """批量撤销的回执。

    Args: swept, outcome。
    """
    return OverrideBulkClearOut(
        cleared_rows=swept.rows,
        cleared_cells=swept.cells,
        recomputed=outcome.recomputed,
        failed=outcome.failed,
        is_truncated=swept.is_truncated or outcome.is_truncated,
        limit=MAX_RECOMPUTE_ROWS,
    )


def _log_write(
    table_id: uuid.UUID,
    record: DatasetRecord,
    *,
    written: list[str],
    cleared: list[str],
) -> None:
    _logger.info(
        "dataset_overrides_written",
        "台账人工修正已写入",
        table_id=str(table_id),
        row_id=str(record.row_id),
        written=len(written),
        cleared=len(cleared),
    )


def _log_bulk(
    table_id: uuid.UUID, swept: _Swept, outcome: RecomputeOutcome
) -> None:
    _logger.info(
        "dataset_overrides_cleared",
        "台账人工修正已批量撤销",
        table_id=str(table_id),
        cleared_rows=swept.rows,
        cleared_cells=swept.cells,
        recomputed=outcome.recomputed,
    )

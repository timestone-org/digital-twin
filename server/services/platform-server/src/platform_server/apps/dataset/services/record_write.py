"""记录的写侧：录入、编辑、删除，以及写完之后的重算与报脏。

⚠ 改 `ts` 必须**先删后插**：`ts` 是分区键，就地 UPDATE 不合法（§4.3b）。
行标识与录入署名原样带过去，前端持有的引用不会失效。
⚠ 两份 JSONB 都是**合并写**而不是整体覆盖：只覆盖本次显式提交过的录入列，
点位汇总列的采集原值与已删列的残值一律留着（§4.3a）。
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, tzinfo
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.utils.ids import uuid7
from lib.utils.timeutils import to_utc, utcnow
from platform_server.apps.dataset.crud import (
    RecordWindow,
    column_crud,
    record_crud,
)
from platform_server.apps.dataset.errors import DatasetRecordNotFound
from platform_server.apps.dataset.models import DatasetRecord
from platform_server.apps.dataset.schemas import (
    RecomputeIn,
    RecomputeOut,
    RecordCreateIn,
    RecordDeleteOut,
    RecordUpdateIn,
    RecordWriteOut,
)
from platform_server.apps.dataset.services.dirty import (
    DatasetDirtyLog,
    mark_dirty,
)
from platform_server.apps.dataset.services.effective import (
    apply_overrides,
    effective_values,
)
from platform_server.apps.dataset.services.presenters import to_record_out
from platform_server.apps.dataset.services.record_compute import (
    build_scope,
    compute_row,
    log_recompute,
    recompute_range,
)
from platform_server.apps.dataset.services.record_history import (
    ComputeScope,
    RowTarget,
)
from platform_server.apps.dataset.services.record_values import (
    Actor,
    SanitizedValues,
    merge_overrides,
    merge_values,
    sanitize,
)
from platform_server.apps.dataset.services.table_service import (
    require_table,
)

_logger = get_logger("platform.dataset.record")


@dataclass(frozen=True)
class RecordWriter:
    """一次记录写入要带的三件协作者：报脏口、业务时区、操作人。

    ⚠ 打成一个对象而不是逐个透传：函数的形参上限是 5，而写路径天然还要带上
    会话、路径参数与请求体。
    """

    dirty: DatasetDirtyLog
    timezone: tzinfo
    actor: Actor


@dataclass(frozen=True)
class RecordLocator:
    """一行的定位：台账 + 行标识 + 数据时间。

    ⚠ 带上 `ts` 才能直接命中 chunk；不带就是跨 chunk 扫描（§6.1）。
    """

    table_id: uuid.UUID
    row_id: uuid.UUID
    ts: datetime | None = None


async def create_record(
    session: AsyncSession,
    writer: RecordWriter,
    *,
    table_id: uuid.UUID,
    payload: RecordCreateIn,
) -> RecordWriteOut:
    """录入一行。新建不做合并——没有既有值可留。

    Args: session, writer, table_id, payload。
    """
    table = await require_table(session, table_id)
    columns = await column_crud.list_by_table(session, table.id)
    scope = await build_scope(
        session, columns=columns, timezone=writer.timezone
    )
    values = sanitize(payload.values, columns, actor=writer.actor)
    stamp = _stamp(payload.ts)
    computed, errors = await compute_row(
        session,
        scope,
        RowTarget(table_id=table.id, ts=stamp, current_values=values.effective),
    )
    record = _new_record(table.id, stamp, values, writer.actor)
    record.computed_json = computed
    record.compute_error = errors or None
    record_crud.add(session, record)
    await session.flush()
    mark_dirty(session, writer.dirty, table.code)
    _logger.info(
        "dataset_record_created",
        "台账数据行已录入",
        table_id=str(table.id),
        row_id=str(record.row_id),
    )
    return await write_out(session, scope, record)


async def update_record(
    session: AsyncSession,
    writer: RecordWriter,
    *,
    locator: RecordLocator,
    payload: RecordUpdateIn,
) -> RecordWriteOut:
    """改一行的原始值，公式列随之重算。

    Args: session, writer, locator, payload。
    """
    table = await require_table(session, locator.table_id)
    record = await require_record(session, locator)
    columns = await column_crud.list_by_table(session, table.id)
    scope = await build_scope(
        session, columns=columns, timezone=writer.timezone
    )
    values = sanitize(payload.values, columns, actor=writer.actor)
    merged = merge_values(record.values_json, values)
    overrides = merge_overrides(record.overrides_json, values)
    stamp = record.ts if payload.ts is None else to_utc(payload.ts)
    saved = await _persist(
        session,
        scope,
        record,
        _Draft(ts=stamp, values=merged, overrides=overrides),
    )
    mark_dirty(session, writer.dirty, table.code)
    _logger.info(
        "dataset_record_updated",
        "台账数据行已更新",
        table_id=str(table.id),
        row_id=str(saved.row_id),
    )
    return await write_out(session, scope, saved)


async def delete_record(
    session: AsyncSession, writer: RecordWriter, *, locator: RecordLocator
) -> RecordDeleteOut:
    """删一行。删之前先探一次下游过期——删掉之后就问不出来了。

    Args: session, writer, locator。
    """
    table = await require_table(session, locator.table_id)
    record = await require_record(session, locator)
    columns = await column_crud.list_by_table(session, table.id)
    scope = await build_scope(
        session, columns=columns, timezone=writer.timezone
    )
    has_stale = await _detect_stale(session, scope, record)
    await record_crud.delete_one(session, record)
    mark_dirty(session, writer.dirty, table.code)
    _logger.info(
        "dataset_record_deleted",
        "台账数据行已删除",
        table_id=str(table.id),
        row_id=str(record.row_id),
    )
    return RecordDeleteOut(
        deleted_row_id=record.row_id, has_stale_downstream=has_stale
    )


async def recompute_table(
    session: AsyncSession,
    writer: RecordWriter,
    *,
    table_id: uuid.UUID,
    payload: RecomputeIn,
) -> RecomputeOut:
    """按时间范围重算公式列。只写计算值，不碰任何原始录入值。

    Args: session, writer, table_id, payload。
    """
    table = await require_table(session, table_id)
    columns = await column_crud.list_by_table(session, table.id)
    scope = await build_scope(
        session, columns=columns, timezone=writer.timezone
    )
    outcome = await recompute_range(
        session,
        scope,
        table_id=table.id,
        window=RecordWindow(
            table_id=table.id,
            since=_moment(payload.since),
            until=_moment(payload.until),
        ),
    )
    if outcome.recomputed:
        await session.flush()
        mark_dirty(session, writer.dirty, table.code)
    log_recompute(table.id, outcome)
    return RecomputeOut(
        recomputed=outcome.recomputed,
        failed=outcome.failed,
        is_truncated=outcome.is_truncated,
        limit=outcome.limit,
    )


async def recompute_row(
    session: AsyncSession, scope: ComputeScope, record: DatasetRecord
) -> None:
    """就地重算一行的公式列。

    ⚠ 改完人工修正必须跟着重算：不重算的话，表格会同时显示「修正后的原始值」
    与「按修正前的值算出来的公式值」。
    Args: session, scope, record。
    """
    if scope.plan.is_empty:
        return
    computed, errors = await compute_row(
        session,
        scope,
        RowTarget(
            table_id=record.table_id,
            ts=record.ts,
            exclude_row_id=record.row_id,
            current_values=effective_values(record),
        ),
    )
    record.computed_json = computed
    record.compute_error = errors or None


@dataclass(frozen=True)
class _Draft:
    """编辑之后这一行该长什么样。"""

    ts: datetime
    values: dict[str, Any]
    overrides: dict[str, Any]


async def _persist(
    session: AsyncSession,
    scope: ComputeScope,
    record: DatasetRecord,
    draft: _Draft,
) -> DatasetRecord:
    """把草稿落库：`ts` 变了走先删后插，没变就地改。

    Args: session, scope, record, draft。
    """
    computed, errors = await compute_row(
        session,
        scope,
        RowTarget(
            table_id=record.table_id,
            ts=draft.ts,
            exclude_row_id=record.row_id,
            current_values=apply_overrides(draft.values, draft.overrides),
        ),
    )
    if draft.ts == record.ts:
        record.values_json = draft.values
        record.overrides_json = draft.overrides or None
        record.computed_json = computed
        record.compute_error = errors or None
        await session.flush()
        return record
    moved = _moved_record(record, draft)
    moved.computed_json = computed
    moved.compute_error = errors or None
    await record_crud.delete_one(session, record)
    # ⚠ 删完要把旧实例摘出会话：它还在身份映射里，之后任何一次 flush 都可能
    # 为它发一条 UPDATE，而那一行已经不在了
    session.expunge(record)
    record_crud.add(session, moved)
    await session.flush()
    return moved


def _moved_record(record: DatasetRecord, draft: _Draft) -> DatasetRecord:
    """搬到新时刻上的那一行。

    ⚠ `row_id` 与录入署名原样带过去：前端持有的引用不失效，而「谁录的」这笔账
    也不该因为改了一次数据时间就换人。
    Args: record, draft。
    """
    return DatasetRecord(
        table_id=record.table_id,
        ts=draft.ts,
        row_id=record.row_id,
        values_json=draft.values,
        overrides_json=draft.overrides or None,
        samples_json=record.samples_json,
        source=record.source,
        created_by=record.created_by,
        created_by_name=record.created_by_name,
        created_at=record.created_at,
    )


def _new_record(
    table_id: uuid.UUID,
    stamp: datetime,
    values: SanitizedValues,
    actor: Actor,
) -> DatasetRecord:
    """按清洗结果装出一行。

    Args: table_id, stamp, values, actor。
    """
    return DatasetRecord(
        table_id=table_id,
        ts=stamp,
        row_id=uuid7(),
        values_json=values.values,
        overrides_json=values.overrides or None,
        source="manual",
        created_by=actor.user_id,
        created_by_name=actor.name,
    )


async def write_out(
    session: AsyncSession, scope: ComputeScope, record: DatasetRecord
) -> RecordWriteOut:
    """一次写入的回执，带上「有没有让别的行过期」。

    Args: session, scope, record。
    """
    return RecordWriteOut(
        record=to_record_out(record),
        has_stale_downstream=await _detect_stale(session, scope, record),
    )


async def _detect_stale(
    session: AsyncSession, scope: ComputeScope, record: DatasetRecord
) -> bool:
    """这次写入会不会让别的行的公式结果失真。

    ⚠ 整表聚合（`*_ALL`）过期不能只看「之后」：改一行会改掉整列的
    min/max/sum，比它更早的行同样不准了（§5.10）。
    Args: session, scope, record。
    """
    if scope.plan.needs_whole:
        return await record_crud.has_other_rows(
            session, table_id=record.table_id, row_id=record.row_id
        )
    if scope.plan.needs_history:
        return await record_crud.has_rows_after(
            session, table_id=record.table_id, ts=record.ts
        )
    return False


async def require_record(
    session: AsyncSession, locator: RecordLocator
) -> DatasetRecord:
    """取这张台账下的一行，取不到即 404。

    Args: session, locator。
    """
    record = await record_crud.get_one(
        session,
        table_id=locator.table_id,
        row_id=locator.row_id,
        ts=locator.ts,
    )
    if record is None:
        raise DatasetRecordNotFound("这张台账下没有这一行")
    return record


def _moment(given: datetime | None) -> datetime | None:
    """把一个可选的时刻归一到 UTC aware。

    Args: given。
    """
    return None if given is None else to_utc(given)


def _stamp(given: datetime | None) -> datetime:
    """数据时间：给了就用给的，没给取此刻。

    ⚠ 一律归一到 UTC aware：客户端可能送上来一个不带时区的串，而 `ts` 是
    `timestamptz` 列——naive 值进不去，报的是驱动层的类型错误。
    Args: given。
    """
    return utcnow() if given is None else to_utc(given)

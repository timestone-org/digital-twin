"""台账管理面。事务边界在这一层：crud 不提交，api 不写业务。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError
from lib.logging import get_logger
from lib.web import Page, PageParams
from platform_server.apps.dataset.crud import (
    column_crud,
    record_crud,
    table_crud,
)
from platform_server.apps.dataset.crud.table import (
    DEFAULT_ORDER,
    SORTABLE,
)
from platform_server.apps.dataset.errors import (
    DatasetTableCodeTaken,
    DatasetTableNotEmpty,
    DatasetTableNotFound,
)
from platform_server.apps.dataset.models import DatasetTable
from platform_server.apps.dataset.schemas import (
    TableCreateIn,
    TableOut,
    TableSummaryOut,
    TableUpdateIn,
)
from platform_server.apps.dataset.services.changes import given_changes
from platform_server.apps.dataset.services.presenters import (
    to_table_out,
    to_table_summary_out,
)

_logger = get_logger("platform.dataset.table")


async def list_tables(
    session: AsyncSession,
    *,
    keyword: str | None,
    page: PageParams,
    sort: str | None,
) -> Page[TableSummaryOut]:
    """台账列表。列数批量查，不逐行发查询。

    Args: session, keyword, page, sort。
    """
    statement = table_crud.order_by_whitelist(
        table_crud.build_query(keyword=keyword),
        sort=sort,
        allowed=dict(SORTABLE),
        default=DEFAULT_ORDER,
    )
    rows, total = await table_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    counts = await table_crud.column_counts(
        session, frozenset(row.id for row in rows)
    )
    return Page[TableSummaryOut](
        items=[
            to_table_summary_out(row, column_count=counts.get(row.id, 0))
            for row in rows
        ],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_table(session: AsyncSession, table_id: uuid.UUID) -> TableOut:
    """台账详情，连列定义一起给。

    Args: session, table_id。
    """
    table = await require_table(session, table_id)
    return to_table_out(
        table, columns=await column_crud.list_by_table(session, table.id)
    )


async def create_table(
    session: AsyncSession, *, payload: TableCreateIn
) -> TableOut:
    """建台账。编码撞了就 409，不静默改名。

    Args: session, payload。
    """
    if await table_crud.get_by_code(session, payload.code) is not None:
        raise DatasetTableCodeTaken(f"台账编码已被占用：{payload.code}")
    table = DatasetTable(
        code=payload.code,
        name=payload.name,
        description=payload.description,
        collect_mode=payload.collect_mode,
        collect_interval_ms=payload.collect_interval_ms,
        retention_days=payload.retention_days,
        is_enabled=payload.is_enabled,
    )
    table_crud.add(session, table)
    await session.flush()
    _logger.info("dataset_table_created", "台账已创建", table_id=str(table.id))
    return to_table_out(table, columns=[])


async def update_table(
    session: AsyncSession, *, table_id: uuid.UUID, payload: TableUpdateIn
) -> TableOut:
    """改台账。缺省的字段不动。

    Args: session, table_id, payload。
    """
    table = await require_table(session, table_id)
    table_crud.apply_changes(table, given_changes(payload))
    await session.flush()
    _logger.info("dataset_table_updated", "台账已更新", table_id=str(table.id))
    return to_table_out(
        table, columns=await column_crud.list_by_table(session, table.id)
    )


async def delete_table(
    session: AsyncSession, *, table_id: uuid.UUID, is_forced: bool = False
) -> None:
    """删台账。下面还有数据行时拒绝；`is_forced` 连历史一起删。

    ⚠ 默认不连坐历史：台账定义没了，行还在也查不出来，而删除操作本身看起来
    完全成功。要连历史一起删就显式 `force`，界面必须在二次确认里说清这一句。
    Args: session, table_id, is_forced。
    """
    table = await require_table(session, table_id)
    record_count = await record_crud.count_by_table(session, table.id)
    if record_count > 0 and not is_forced:
        raise DatasetTableNotEmpty(
            f"这张台账下还有 {record_count} 行数据",
            details=(
                FieldError(
                    field="records",
                    code="table_not_empty",
                    message=f"共 {record_count} 行历史数据会被一并删除",
                ),
            ),
        )
    _logger.info(
        "dataset_table_deleted",
        "台账已删除",
        table_id=str(table.id),
        record_count=record_count,
        is_forced=is_forced,
    )
    await record_crud.delete_by_table(session, table.id)
    await table_crud.delete(session, table)


async def resolve_table_code(session: AsyncSession, code: str) -> uuid.UUID:
    """按编码取台账 id；取不到即 404。

    ⚠ 只回 id 不回整行：这是给台账之外的模块用的入口，ORM 实例不出本模块。
    Args: session, code。
    """
    table = await table_crud.get_by_code(session, code)
    if table is None:
        raise DatasetTableNotFound("台账不存在")
    return table.id


async def require_table(
    session: AsyncSession, table_id: uuid.UUID
) -> DatasetTable:
    """取台账，取不到即 404。

    Args: session, table_id。
    """
    table = await table_crud.get(session, table_id)
    if table is None:
        raise DatasetTableNotFound("台账不存在")
    return table

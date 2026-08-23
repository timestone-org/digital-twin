"""列管理面。事务边界在这一层：crud 不提交，api 不写业务。"""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError
from lib.logging import get_logger
from platform_server.apps.dataset.crud import column_crud
from platform_server.apps.dataset.errors import (
    DatasetColumnInUse,
    DatasetColumnKeyTaken,
    DatasetColumnNotFound,
)
from platform_server.apps.dataset.models import DatasetColumn
from platform_server.apps.dataset.protocols import (
    ColumnSource,
    as_column_source,
)
from platform_server.apps.dataset.schemas import (
    ColumnCreateIn,
    ColumnOut,
    ColumnReorderIn,
    ColumnUpdateIn,
)
from platform_server.apps.dataset.services.changes import given_changes
from platform_server.apps.dataset.services.column_rules import (
    check_point_binding,
)
from platform_server.apps.dataset.services.presenters import to_column_out
from platform_server.apps.dataset.services.table_service import require_table

_logger = get_logger("platform.dataset.column")


async def list_columns(
    session: AsyncSession, *, table_id: uuid.UUID
) -> list[ColumnOut]:
    """一张台账的全部列。集合有界（一张表的列数有限），故不分页。

    Args: session, table_id。
    """
    table = await require_table(session, table_id)
    rows = await column_crud.list_by_table(session, table.id)
    return [to_column_out(row) for row in rows]


async def create_column(
    session: AsyncSession, *, table_id: uuid.UUID, payload: ColumnCreateIn
) -> ColumnOut:
    """新增一列。key 撞了就 409，点位汇总列必须绑一个形状合法的点位。

    Args: session, table_id, payload。
    """
    table = await require_table(session, table_id)
    if await column_crud.get_by_key(session, table.id, payload.key) is not None:
        raise DatasetColumnKeyTaken(f"这张台账下已有同名列：{payload.key}")
    check_point_binding(source=payload.source, node_key=payload.node_key)
    column = _new_column(
        table.id, payload, await _order_of(session, payload, table.id)
    )
    column_crud.add(session, column)
    await session.flush()
    _logger.info(
        "dataset_column_created", "台账列已创建", column_id=str(column.id)
    )
    return to_column_out(column)


async def update_column(
    session: AsyncSession,
    *,
    table_id: uuid.UUID,
    column_id: uuid.UUID,
    payload: ColumnUpdateIn,
) -> ColumnOut:
    """改一列。缺省的字段不动。

    Args: session, table_id, column_id, payload。
    """
    column = await require_column(
        session, table_id=table_id, column_id=column_id
    )
    changes = given_changes(payload)
    source, node_key = _merged_binding(column, changes)
    check_point_binding(source=source, node_key=node_key)
    column_crud.apply_changes(column, changes)
    await session.flush()
    _logger.info(
        "dataset_column_updated", "台账列已更新", column_id=str(column.id)
    )
    return to_column_out(column)


async def delete_column(
    session: AsyncSession,
    *,
    table_id: uuid.UUID,
    column_id: uuid.UUID,
    is_forced: bool = False,
) -> None:
    """删一列。还被别的列的公式引用着就 409 并列出那些列；`force` 跳过守卫。

    ⚠ `is_forced` 是显式跳过这道守卫：引用它的那几列会就此算不出数，界面要在
    二次确认里把这句话说出来。
    Args: session, table_id, column_id, is_forced。
    """
    column = await require_column(
        session, table_id=table_id, column_id=column_id
    )
    dependents = await column_crud.dependents_of(
        session, table_id=table_id, key=column.key
    )
    if dependents and not is_forced:
        raise DatasetColumnInUse(
            f"还有 {len(dependents)} 列的公式引用着这一列，请先改公式",
            details=tuple(_dependent_detail(item) for item in dependents),
        )
    _logger.info(
        "dataset_column_deleted",
        "台账列已删除",
        column_id=str(column.id),
        dependent_count=len(dependents),
        is_forced=is_forced,
    )
    await column_crud.delete(session, column)


async def reorder_columns(
    session: AsyncSession, *, table_id: uuid.UUID, payload: ColumnReorderIn
) -> list[ColumnOut]:
    """按给定顺序整体重排。名单外的列静默保持原样。

    Args: session, table_id, payload。
    """
    table = await require_table(session, table_id)
    ranks = {
        column_id: rank for rank, column_id in enumerate(payload.column_ids)
    }
    for column in await column_crud.list_by_table(session, table.id):
        rank = ranks.get(column.id)
        if rank is not None:
            column.order_index = rank
    await session.flush()
    _logger.info(
        "dataset_columns_reordered",
        "台账列已重排",
        table_id=str(table.id),
        column_count=len(ranks),
    )
    return await list_columns(session, table_id=table.id)


async def require_column(
    session: AsyncSession, *, table_id: uuid.UUID, column_id: uuid.UUID
) -> DatasetColumn:
    """取这张台账下的一列，取不到即 404。

    ⚠ 列属于别的台账时同样报 404 而不是 403：拿 403 回答等于告诉调用方
    「这个 id 存在，只是不在你说的那张表下」（api-contract §3.3）。
    Args: session, table_id, column_id。
    """
    column = await column_crud.get(session, column_id)
    if column is None or column.table_id != table_id:
        raise DatasetColumnNotFound("这张台账下没有这一列")
    return column


async def _order_of(
    session: AsyncSession, payload: ColumnCreateIn, table_id: uuid.UUID
) -> int:
    """新列的排序号：给了就用给的，没给就排到最后。

    Args: session, payload, table_id。
    """
    if payload.order_index is not None:
        return payload.order_index
    return await column_crud.next_order_index(session, table_id)


def _new_column(
    table_id: uuid.UUID, payload: ColumnCreateIn, order_index: int
) -> DatasetColumn:
    """按入参装出一行列定义。

    Args: table_id, payload, order_index。
    """
    return DatasetColumn(
        table_id=table_id,
        key=payload.key,
        name=payload.name,
        unit=payload.unit,
        decimals=payload.decimals,
        data_type=payload.data_type,
        source=payload.source,
        agg=payload.agg,
        node_key=payload.node_key,
        formula=payload.formula,
        order_index=order_index,
        is_required=payload.is_required,
        default_value=payload.default_value,
    )


def _merged_binding(
    column: DatasetColumn, changes: dict[str, Any]
) -> tuple[ColumnSource, str | None]:
    """把本次变更叠到现值上，得到要校验的那一对。

    ⚠ 只看入参会漏掉「改 source 不改 node_key」这一路：一列从人工录入改成
    点位汇总却没给点位，入参层看不出任何问题。
    Args: column, changes。
    """
    source = changes.get("source")
    node_key = changes.get("node_key", column.node_key)
    return (
        as_column_source(source if isinstance(source, str) else column.source),
        node_key if isinstance(node_key, str) else None,
    )


def _dependent_detail(column: DatasetColumn) -> FieldError:
    """把一列引用者摊成字段级说明。

    Args: column。
    """
    return FieldError(
        field=f"columns[{column.key}]",
        code="column_referenced",
        message=f"{column.name} 的公式引用了这一列",
    )

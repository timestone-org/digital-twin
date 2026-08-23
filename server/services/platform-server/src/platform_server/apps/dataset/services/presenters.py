"""ORM 模型 → 对外模型。转换只在这一处发生，HTTP 层拿不到 ORM 对象。"""

from collections.abc import Sequence

from platform_server.apps.dataset.models import DatasetColumn, DatasetTable
from platform_server.apps.dataset.protocols import (
    as_agg_func,
    as_collect_mode,
    as_column_source,
    as_column_type,
)
from platform_server.apps.dataset.schemas import (
    ColumnOut,
    TableOut,
    TableSummaryOut,
)


def to_column_out(column: DatasetColumn) -> ColumnOut:
    """一列的对外形态。

    Args: column。
    """
    return ColumnOut(
        id=column.id,
        table_id=column.table_id,
        key=column.key,
        name=column.name,
        unit=column.unit,
        decimals=column.decimals,
        data_type=as_column_type(column.data_type),
        source=as_column_source(column.source),
        agg=as_agg_func(column.agg),
        node_key=column.node_key,
        formula=column.formula,
        formula_deps=column.formula_deps,
        order_index=column.order_index,
        is_required=column.is_required,
        default_value=column.default_value,
        created_at=column.created_at,
        updated_at=column.updated_at,
    )


def to_table_summary_out(
    table: DatasetTable, *, column_count: int
) -> TableSummaryOut:
    """列表页的台账条目。

    Args: table, column_count。
    """
    return TableSummaryOut(
        id=table.id,
        code=table.code,
        name=table.name,
        description=table.description,
        collect_mode=as_collect_mode(table.collect_mode),
        collect_interval_ms=table.collect_interval_ms,
        retention_days=table.retention_days,
        last_collected_ts=table.last_collected_ts,
        is_enabled=table.is_enabled,
        column_count=column_count,
        created_at=table.created_at,
        updated_at=table.updated_at,
    )


def to_table_out(
    table: DatasetTable, *, columns: Sequence[DatasetColumn]
) -> TableOut:
    """台账详情，连列定义一起给。列数由列定义自己数出来。

    Args: table, columns。
    """
    return TableOut(
        id=table.id,
        code=table.code,
        name=table.name,
        description=table.description,
        collect_mode=as_collect_mode(table.collect_mode),
        collect_interval_ms=table.collect_interval_ms,
        retention_days=table.retention_days,
        last_collected_ts=table.last_collected_ts,
        is_enabled=table.is_enabled,
        column_count=len(columns),
        created_at=table.created_at,
        updated_at=table.updated_at,
        columns=[to_column_out(column) for column in columns],
    )

"""ORM 模型 → 对外模型。转换只在这一处发生，HTTP 层拿不到 ORM 对象。"""

from collections.abc import Sequence
from typing import Any, cast

from pydantic import ValidationError

from lib.logging import get_logger
from platform_server.apps.dataset.models import (
    DatasetColumn,
    DatasetRecord,
    DatasetTable,
)
from platform_server.apps.dataset.protocols import (
    as_agg_func,
    as_collect_mode,
    as_column_source,
    as_column_type,
    as_record_source,
)
from platform_server.apps.dataset.schemas import (
    ColumnOut,
    FormulaDepsOut,
    OverrideOut,
    RecordOut,
    TableOut,
    TableSummaryOut,
)
from platform_server.apps.dataset.services.effective import (
    OVERRIDE_VALUE_KEY,
    effective_values,
)

_logger = get_logger("platform.dataset.presenter")


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
        formula_deps=to_deps_out(column.formula_deps),
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


def to_deps_out(blob: dict[str, Any] | None) -> FormulaDepsOut | None:
    """落库的依赖 blob → 对外形态；读不动就当没有。

    ⚠ 读不动只可能是有人绕过接口直接改了库。给 null 而不是 500：那一列的公式
    原文还在，界面照常显示得出来，只是少一份依赖清单。
    Args: blob。
    """
    if not isinstance(blob, dict):
        return None
    try:
        return FormulaDepsOut.model_validate(blob)
    except ValidationError:
        _logger.warning(
            "dataset_formula_deps_unreadable", "列的依赖 blob 读不动"
        )
        return None


def to_record_out(record: DatasetRecord) -> RecordOut:
    """一行的对外形态。

    ⚠ `values` 给的是 **effective**（人工修正优先），与公式求值同一口径；
    「谁改的、改成什么」另由 `overrides` 原样带出，界面据此给格子打修正角标。
    Args: record。
    """
    return RecordOut(
        row_id=record.row_id,
        ts=record.ts,
        values=effective_values(record),
        overrides=_override_traces(record.overrides_json) or None,
        samples=_sample_counts(record.samples_json) or None,
        computed=dict(record.computed_json or {}),
        compute_error=_reasons(record.compute_error) or None,
        source=as_record_source(record.source),
        created_by_name=record.created_by_name,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


def _override_traces(blob: dict[str, Any] | None) -> dict[str, OverrideOut]:
    """修正痕迹的对外形态。

    ⚠ 缺 `v` 或缺 `at` 的条目**不往外发**：那种半截条目只可能是有人直接改了
    库，而让它把整页列表打成 500 是拿一格脏数据毁掉整张台账（取值本身另有
    兜底，见 `effective.apply_overrides`）。
    Args: blob。
    """
    if not isinstance(blob, dict):
        return {}
    traces: dict[str, OverrideOut] = {}
    for key, entry in blob.items():
        trace = _one_trace(entry)
        if trace is not None:
            traces[key] = trace
    return traces


def _one_trace(entry: Any) -> OverrideOut | None:
    """一条修正痕迹；形状不对就当没有。

    Args: entry。
    """
    if not isinstance(entry, dict):
        return None
    fields = cast("dict[str, Any]", entry)
    try:
        return OverrideOut(
            value=fields[OVERRIDE_VALUE_KEY],
            by=_text(fields.get("by")),
            by_name=_text(fields.get("by_name")),
            at=fields["at"],
            reason=_text(fields.get("reason")),
        )
    except (KeyError, ValidationError):
        _logger.warning(
            "dataset_override_entry_unreadable", "一条人工修正痕迹读不动"
        )
        return None


def _sample_counts(blob: dict[str, Any] | None) -> dict[str, int]:
    """样本数只留真能当整数读的项。

    Args: blob。
    """
    if not isinstance(blob, dict):
        return {}
    return {
        key: int(value)
        for key, value in blob.items()
        if isinstance(value, int) and not isinstance(value, bool)
    }


def _reasons(blob: dict[str, Any] | None) -> dict[str, str]:
    """求值失败的原因只留字符串项。

    Args: blob。
    """
    if not isinstance(blob, dict):
        return {}
    return {key: value for key, value in blob.items() if isinstance(value, str)}


def _text(value: Any) -> str | None:
    """把一个可能是任意类型的值收成字符串或空。

    Args: value。
    """
    return value if isinstance(value, str) else None

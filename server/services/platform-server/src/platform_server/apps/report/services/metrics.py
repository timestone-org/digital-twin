"""按窗口合并取数，再按依赖顺序求值报告指标。"""

from dataclasses import dataclass, field, replace
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from platform_server.apps.dataset.services import report_formula
from platform_server.apps.report.schemas.document import MetricDef
from platform_server.apps.report.schemas.preview import MetricValue
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.aggregation import (
    aggregate,
    decimal_value,
    formula_values,
    value_kind,
    wire_value,
)
from platform_server.apps.report.services.document import metric_order
from platform_server.apps.report.services.period import (
    WindowOptions,
    resolve_window,
)
from platform_server.apps.report.services.source import (
    SourceData,
    SourceWindow,
    latest_stamp,
    read_window,
)

MAX_TOTAL_ROWS = 50_000
MAX_OUTPUT_VALUES = 50_000


@dataclass
class PreviewContext:
    """一次试算内的缓存，不跨请求保存台账数据。"""

    template: TemplateBody
    period: str
    timezone: str
    output_values: int = 0
    windows: dict[SourceWindow, SourceData] = field(
        default_factory=dict[SourceWindow, SourceData]
    )
    latest: dict[tuple[str, datetime], datetime | None] = field(
        default_factory=dict[tuple[str, datetime], datetime | None]
    )

    async def read(
        self, session: AsyncSession, window: SourceWindow
    ) -> SourceData:
        """相同窗口只读一次。Args: session, window。"""
        if window not in self.windows:
            remaining = MAX_TOTAL_ROWS - sum(
                len(found.rows) for found in self.windows.values()
            )
            if remaining <= 0:
                raise ValueError("本次报告取数总量已达到上限，请缩小时间窗")
            bounded = replace(window, limit=min(window.limit, remaining))
            self.windows[window] = await read_window(session, bounded)
        return self.windows[window]


async def metric_window(
    session: AsyncSession, context: PreviewContext, metric: MetricDef
) -> SourceWindow:
    """确定取数边界，latest 也不越过报告期。Args: session, context, metric。"""
    zone = ZoneInfo(context.timezone)
    options = WindowOptions(offset=metric.offset, window=metric.window)
    since, until = resolve_window(
        context.period, context.template.granularity, zone, options
    )
    nominal_until = until
    table = metric.table or ""
    if metric.anchor == "latest":
        cache_key = (table, until)
        if cache_key not in context.latest:
            context.latest[cache_key] = await latest_stamp(
                session, table, until
            )
        since, until = resolve_window(
            context.period,
            context.template.granularity,
            zone,
            WindowOptions(
                offset=metric.offset,
                window=metric.window,
                latest=context.latest[cache_key],
            ),
        )
    return SourceWindow(
        table=table,
        since=since,
        until=until,
        is_stale=until < nominal_until,
    )


async def resolve_metrics(
    session: AsyncSession, context: PreviewContext
) -> list[MetricValue]:
    """求出所有指标并记录缺失、截断及错误。Args: session, context。"""
    by_name = {metric.name: metric for metric in context.template.metrics}
    found: dict[str, MetricValue] = {}
    for name in metric_order(context.template.metrics):
        metric = by_name[name]
        try:
            found[name] = (
                _evaluate_expression(metric, found)
                if metric.mode == "expr"
                else await _resolve_source(session, context, metric)
            )
        except (AppError, ValueError, report_formula.FormulaError) as error:
            message = (
                error.message if isinstance(error, AppError) else str(error)
            )
            found[name] = MetricValue(name=name, value=None, error=message)
    return [found[metric.name] for metric in context.template.metrics]


def _evaluate_expression(
    metric: MetricDef, found: dict[str, MetricValue]
) -> MetricValue:
    expression = metric.expr or ""
    references = report_formula.metric_references(expression)
    if any(found[name].error for name in references):
        return MetricValue(
            name=metric.name, value=None, error="所引用指标取数失败"
        )
    values = formula_values(list(found.values()))
    result = report_formula.evaluate_metrics(expression, values)
    return MetricValue(
        name=metric.name,
        value=wire_value(result),
        value_kind=value_kind(result),
        is_stale=any(found[name].is_stale for name in references),
        is_truncated=any(found[name].is_truncated for name in references),
    )


async def _resolve_source(
    session: AsyncSession, context: PreviewContext, metric: MetricDef
) -> MetricValue:
    window = await metric_window(session, context, metric)
    found = await context.read(session, window)
    if metric.key not in {column.key for column in found.columns}:
        raise ValueError("指标引用的台账列不存在")
    values = [row.values.get(metric.key or "") for row in found.rows]
    mode = "last" if metric.mode in ("latest", "at_bucket") else metric.agg
    raw = aggregate(values, mode)
    column = next(
        column for column in found.columns if column.key == metric.key
    )
    if column.data_type == "number" and raw is not None:
        raw = decimal_value(raw)
    result = wire_value(raw)
    return MetricValue(
        name=metric.name,
        value=result,
        value_kind=value_kind(raw),
        is_stale=found.is_stale,
        since=window.since,
        until=window.until,
        error="窗口内没有有效数据" if result is None else None,
        is_truncated=found.is_truncated and metric.mode == "window_agg",
    )

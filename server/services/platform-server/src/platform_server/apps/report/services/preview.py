"""试算编排：冻结数据取值、指标求值与正文节点折算。"""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from platform_server.apps.dataset.services import report_formula
from platform_server.apps.report.schemas.document import DocumentNode, MetricDef
from platform_server.apps.report.schemas.nodes import DataNodeSpec, SeriesSpec
from platform_server.apps.report.schemas.preview import (
    ChartSeries,
    MetricValue,
    NodeValue,
    PreviewOut,
    ReportApiResult,
    SeriesPoint,
)
from platform_server.apps.report.services.aggregation import (
    aggregate,
    decimal_value,
    format_value,
    formula_values,
    value_kind,
    wire_value,
)
from platform_server.apps.report.services.document import (
    BUSINESS_NODES,
    number_attr,
    text_attr,
    validate_template,
    walk_nodes,
)
from platform_server.apps.report.services.metrics import (
    MAX_OUTPUT_VALUES,
    PreviewContext,
    metric_window,
    resolve_metrics,
)
from platform_server.apps.report.services.source import SourceData
from platform_server.apps.report.services.table import build_table


async def preview(session: AsyncSession, context: PreviewContext) -> PreviewOut:
    """试算一份模板，所有降级显式返回。Args: session, context。"""
    checked = validate_template(context.template)
    if not checked.is_valid:
        return PreviewOut(
            is_valid=False,
            period=context.period,
            timezone=context.timezone,
            metrics=[],
            nodes={},
            warnings=[issue.message for issue in checked.issues],
        )
    metrics = await resolve_metrics(session, context)
    warnings = [f"{item.name}：{item.error}" for item in metrics if item.error]
    warnings.extend(
        f"{item.name}：取数已截断" for item in metrics if item.is_truncated
    )
    warnings.extend(
        f"{item.name}：使用较早的最新数据，非完整本期数据"
        for item in metrics
        if item.is_stale
    )
    nodes: dict[str, NodeValue] = {}
    for path, node in walk_nodes(context.template.doc_json):
        if node.type not in BUSINESS_NODES:
            continue
        try:
            nodes[path] = await _node_value(session, context, node, metrics)
            if nodes[path].is_stale:
                warnings.append(f"{path}：使用较早的最新数据")
            if nodes[path].is_truncated:
                warnings.append(f"{path}：表格或图表数据已截断")
        except (ValueError, AppError, report_formula.FormulaError) as error:
            message = (
                error.message if isinstance(error, AppError) else str(error)
            )
            warnings.append(f"{path}：{message}")
            nodes[path] = NodeValue(kind=node.type, text="[数据不可用]")
    return PreviewOut(
        is_valid=not warnings,
        period=context.period,
        timezone=context.timezone,
        metrics=metrics,
        nodes=nodes,
        warnings=warnings,
        api_results=_api_results(context),
        checked_at=datetime.now(UTC),
    )


def _api_results(context: PreviewContext) -> list[ReportApiResult]:
    results: list[ReportApiResult] = []
    for source in context.template.api_sources:
        found = context.api_data.get(f"api:{source.code}")
        if found is None:
            continue
        results.append(
            ReportApiResult(
                source_code=source.code,
                name=source.name,
                row_count=len(found.rows),
                columns=[column.name for column in found.columns],
                rows=[
                    [
                        format_value(
                            row.values.get(column.key),
                            column.data_type,
                            precision=None,
                        )
                        for column in found.columns
                    ]
                    for row in found.rows[:5]
                ],
            )
        )
    return results


async def _node_value(
    session: AsyncSession,
    context: PreviewContext,
    node: DocumentNode,
    metrics: list[MetricValue],
) -> NodeValue:
    if node.type in ("metricRef", "condText"):
        return _text_node(node, metrics)
    spec = DataNodeSpec.model_validate(node.attrs)
    if node.type == "dsChart":
        return await _chart_node(session, context, spec)
    metric = MetricDef(
        name="表格",
        table=spec.table,
        key=spec.keys[0] if spec.keys else "",
        window=spec.window,
        offset=spec.offset,
        anchor=spec.anchor,
    )
    found = await context.read(
        session, await metric_window(session, context, metric)
    )
    width = len(spec.keys) + 1
    remaining = (MAX_OUTPUT_VALUES - context.output_values) // width - 1
    if remaining < 1:
        raise ValueError("报告展示数据总量达到上限")
    bounded = spec.model_copy(update={"limit": min(spec.limit, remaining)})
    result = build_table(found, bounded, context.timezone)
    context.output_values += (len(result.rows) + 1) * width
    return result


def _text_node(node: DocumentNode, metrics: list[MetricValue]) -> NodeValue:
    expression = text_attr(node, "expr")
    references = report_formula.metric_references(expression)
    by_name = {metric.name: metric for metric in metrics}
    if any(by_name[name].error for name in references):
        raise ValueError("节点引用的指标不可用")
    value = _expression_value(expression, metrics)
    text = format_value(
        value,
        value_kind(value),
        (
            int(number_attr(node, "precision", 2))
            if node.type == "metricRef"
            else None
        ),
        text_attr(node, "unit") if node.type == "metricRef" else "",
    )
    return NodeValue(kind=node.type, text=text)


def _expression_value(expression: str, metrics: list[MetricValue]) -> object:
    direct = next(
        (
            metric
            for metric in metrics
            if expression.strip() == f"{{{metric.name}}}"
        ),
        None,
    )
    if direct is not None:
        return (
            decimal_value(direct.value)
            if direct.value_kind == "number"
            else direct.value
        )
    return report_formula.evaluate_metrics(expression, formula_values(metrics))


async def _chart_node(
    session: AsyncSession, context: PreviewContext, spec: DataNodeSpec
) -> NodeValue:
    if not spec.series:
        raise ValueError("图表尚未配置数据序列")
    results = [
        await _chart_series(session, context, spec, item)
        for item in spec.series
    ]
    return NodeValue(
        kind=spec.kind,
        title=spec.title,
        series=[result[0] for result in results],
        is_truncated=any(result[1] for result in results),
        is_stale=any(result[2] for result in results),
    )


async def _chart_series(
    session: AsyncSession,
    context: PreviewContext,
    spec: DataNodeSpec,
    item: SeriesSpec,
) -> tuple[ChartSeries, bool, bool]:
    metric = MetricDef(
        name="图表",
        table=item.table,
        key=item.key,
        window=spec.window,
        offset=spec.offset + item.offset,
        anchor=spec.anchor,
    )
    found = await context.read(
        session, await metric_window(session, context, metric)
    )
    column = next(
        (column for column in found.columns if column.key == item.key), None
    )
    if column is None:
        raise ValueError("图表引用的数据字段不存在")
    if column.data_type != "number":
        raise ValueError("图表只能选择数字类型的数据字段")
    remaining = MAX_OUTPUT_VALUES - context.output_values
    if remaining <= 0:
        raise ValueError("报告展示数据总量达到上限")
    values = _chart_values(found, item.key, spec, context.timezone)
    limit = min(spec.limit, remaining)
    kept = values[-limit:]
    if spec.order == "desc":
        kept.reverse()
    points = [
        SeriesPoint(ts=stamp, value=_chart_number(value))
        for stamp, value in kept
    ]
    context.output_values += len(points)
    return (
        ChartSeries(name=item.name or item.key, points=points),
        found.is_truncated or len(values) > limit,
        found.is_stale,
    )


def _chart_values(
    found: SourceData, key: str, spec: DataNodeSpec, timezone: str
) -> list[tuple[datetime, object]]:
    if spec.bucket == "none":
        return [(row.ts, row.values.get(key)) for row in found.rows]
    zone = ZoneInfo(timezone)
    grouped: dict[datetime, list[object]] = {}
    for row in found.rows:
        stamp = row.ts.astimezone(zone).replace(
            minute=0, second=0, microsecond=0
        )
        if spec.bucket in ("day", "month"):
            stamp = stamp.replace(hour=0)
        if spec.bucket == "month":
            stamp = stamp.replace(day=1)
        grouped.setdefault(stamp, []).append(row.values.get(key))
    return [
        (stamp, aggregate(values, spec.agg))
        for stamp, values in sorted(grouped.items())
    ]


def _chart_number(value: object) -> str | None:
    resolved = wire_value(value)
    return str(int(resolved)) if isinstance(resolved, bool) else resolved

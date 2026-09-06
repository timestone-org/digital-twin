"""试算编排：台账取数、指标求值、正文节点折算。"""

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from platform_server.apps.dataset.services import report_formula
from platform_server.apps.report.schemas.document import DocumentNode, MetricDef
from platform_server.apps.report.schemas.nodes import DataNodeSpec
from platform_server.apps.report.schemas.preview import (
    ChartSeries,
    MetricValue,
    NodeValue,
    PreviewOut,
    SeriesPoint,
)
from platform_server.apps.report.services.aggregation import (
    format_number,
    formula_values,
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
    )


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
    values = formula_values(metrics)
    value = report_formula.evaluate_metrics(expression, values)
    text = (
        format_number(
            value,
            int(number_attr(node, "precision", 2)),
            text_attr(node, "unit"),
        )
        if node.type == "metricRef"
        else str(value) if value is not None else "—"
    )
    return NodeValue(kind=node.type, text=text)


async def _chart_node(
    session: AsyncSession, context: PreviewContext, spec: DataNodeSpec
) -> NodeValue:
    if not spec.series:
        raise ValueError("图表尚未配置数据序列")
    series: list[ChartSeries] = []
    is_truncated = False
    is_stale = False
    for item in spec.series:
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
        if item.key not in {column.key for column in found.columns}:
            raise ValueError("图表引用的台账列不存在")
        is_truncated = is_truncated or found.is_truncated
        is_stale = is_stale or found.is_stale
        remaining = MAX_OUTPUT_VALUES - context.output_values
        if remaining <= 0:
            raise ValueError("报告展示数据总量达到上限")
        kept = found.rows[-remaining:]
        is_truncated = is_truncated or len(kept) < len(found.rows)
        context.output_values += len(kept)
        points = [
            SeriesPoint(
                ts=row.ts, value=_chart_number(row.values.get(item.key))
            )
            for row in kept
        ]
        series.append(ChartSeries(name=item.name or item.key, points=points))
    return NodeValue(
        kind=spec.kind,
        title=spec.title,
        series=series,
        is_truncated=is_truncated,
        is_stale=is_stale,
    )


def _chart_number(value: object) -> str | None:
    resolved = wire_value(value)
    return str(int(resolved)) if isinstance(resolved, bool) else resolved

"""试算编排：冻结数据取值、指标求值与正文节点折算。"""

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from platform_server.apps.dataset.services import report_formula
from platform_server.apps.report.schemas.document import DocumentNode, MetricDef
from platform_server.apps.report.schemas.nodes import DataNodeSpec
from platform_server.apps.report.schemas.preview import (
    MetricValue,
    NodeValue,
    PreviewOut,
    ReportApiResult,
)
from platform_server.apps.report.services.aggregation import (
    decimal_value,
    format_value,
    formula_values,
    value_kind,
)
from platform_server.apps.report.services.chart_data import chart_node
from platform_server.apps.report.services.document import (
    BUSINESS_NODES,
    node_label,
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

# 取数失败的节点占位；出稿前凭它拒绝整份报告
UNAVAILABLE_TEXT = "[数据不可用]"
# 尚未填表达式的节点占位，与 Word 成品里缺值节点同一句
UNCONFIGURED_TEXT = "[数据未配置]"


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
    warnings = _metric_warnings(context, metrics)
    nodes: dict[str, NodeValue] = {}
    for path, node in walk_nodes(context.template.doc_json):
        if node.type not in BUSINESS_NODES:
            continue
        try:
            nodes[path] = await _node_value(session, context, node, metrics)
            if nodes[path].is_stale:
                warnings.append(f"{node_label(path, node)}：使用较早的最新数据")
            if nodes[path].is_truncated:
                warnings.append(f"{node_label(path, node)}：数据已截断")
        except (ValueError, AppError, report_formula.FormulaError) as error:
            message = (
                error.message if isinstance(error, AppError) else str(error)
            )
            warnings.append(f"{node_label(path, node)}：{message}")
            nodes[path] = NodeValue(kind=node.type, text=UNAVAILABLE_TEXT)
    return PreviewOut(
        is_valid=not warnings,
        period=context.period,
        timezone=context.timezone,
        metrics=metrics,
        nodes=nodes,
        # ⚠ 去重：同一段里两处一样的节点报同一句，而前端按原文做列表键
        warnings=list(dict.fromkeys(warnings)),
        api_results=_api_results(context),
        checked_at=datetime.now(UTC),
    )


def _metric_warnings(
    context: PreviewContext, metrics: list[MetricValue]
) -> list[str]:
    """来源与指标两层的提示。

    ⚠ 没被任何指标引用的来源取数失败也要算进去：出稿那一路会因为它整份失败。
    Args: context, metrics。
    """
    warnings = list(dict.fromkeys(context.api_errors.values()))
    warnings.extend(
        f"{item.name}：{item.error}" for item in metrics if item.error
    )
    warnings.extend(
        f"{item.name}：取数已截断" for item in metrics if item.is_truncated
    )
    warnings.extend(
        f"{item.name}：使用较早的最新数据，非完整本期数据"
        for item in metrics
        if item.is_stale
    )
    return warnings


def _api_results(context: PreviewContext) -> list[ReportApiResult]:
    results: list[ReportApiResult] = []
    for source in context.template.api_sources:
        key = f"api:{source.code}"
        if key in context.api_errors:
            results.append(
                ReportApiResult(
                    source_code=source.code,
                    name=source.name,
                    row_count=0,
                    columns=[],
                    rows=[],
                    error=context.api_errors[key],
                )
            )
            continue
        found = context.api_data.get(key)
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
        # ⚠ 空表达式在校验里只是提示；交给公式引擎会抛错并让每次出稿失败
        if not text_attr(node, "expr"):
            return NodeValue(kind=node.type, text=UNCONFIGURED_TEXT)
        return _text_node(node, metrics, context.template.metrics)
    spec = DataNodeSpec.model_validate(node.attrs)
    if node.type == "dsChart":
        return await chart_node(session, context, spec)
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


def _precision(node: DocumentNode) -> int | None:
    """正文数字的小数位；显式 null 表示按原值输出。Args: node。"""
    if node.type != "metricRef":
        return None
    if "precision" in node.attrs and node.attrs["precision"] is None:
        return None
    return int(number_attr(node, "precision", 2))


def _text_node(
    node: DocumentNode,
    metrics: list[MetricValue],
    definitions: list[MetricDef],
) -> NodeValue:
    expression = text_attr(node, "expr")
    references = report_formula.metric_references(expression)
    by_name = {metric.name: metric for metric in metrics}
    if any(by_name[name].error for name in references):
        raise ValueError("节点引用的指标不可用")
    value = _expression_value(expression, metrics)
    text = format_value(
        value,
        value_kind(value),
        _precision(node),
        _unit(node, expression, definitions),
    )
    return NodeValue(kind=node.type, text=text)


def _unit(
    node: DocumentNode, expression: str, definitions: list[MetricDef]
) -> str:
    """正文数字的单位：节点自己的优先，没填时回落到直接引用的那个指标。

    Args: node, expression, definitions。
    """
    if node.type != "metricRef":
        return ""
    own = text_attr(node, "unit")
    if own:
        return own
    return next(
        (
            definition.unit or ""
            for definition in definitions
            if expression.strip() == f"{{{definition.name}}}"
        ),
        "",
    )


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

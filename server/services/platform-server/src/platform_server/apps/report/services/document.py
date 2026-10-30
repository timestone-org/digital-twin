"""文档限额、业务节点遍历与指标依赖校验。"""

import json
from collections.abc import Iterator
from graphlib import CycleError, TopologicalSorter

from pydantic import ValidationError

from platform_server.apps.dataset.services import report_formula
from platform_server.apps.report.schemas.api_source import ReportApiSource
from platform_server.apps.report.schemas.document import DocumentNode, MetricDef
from platform_server.apps.report.schemas.nodes import DataNodeSpec
from platform_server.apps.report.schemas.preview import (
    TemplateIssue,
    ValidationOut,
)
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.docx_tables import table_placements

BUSINESS_NODES = frozenset(("metricRef", "condText", "dsChart", "dsTable"))
MAX_DEPTH = 30
MAX_NODES = 5000
MAX_BYTES = 1_000_000
MAX_EXPRESSION_LENGTH = 2000


def walk_nodes(root: DocumentNode) -> Iterator[tuple[str, DocumentNode]]:
    """按内容路径遍历并拒绝超深、超大文档。Args: root。"""
    stack = [("", root, 0)]
    count = 0
    while stack:
        path, node, depth = stack.pop()
        count += 1
        if depth > MAX_DEPTH or count > MAX_NODES:
            raise ValueError("文档层级或节点数量超过上限")
        yield path, node
        for index in reversed(range(len(node.content))):
            child_path = (
                f"{path}.content.{index}" if path else f"content.{index}"
            )
            stack.append((child_path, node.content[index], depth + 1))


def text_attr(node: DocumentNode, key: str, default: str = "") -> str:
    value = node.attrs.get(key)
    return value if isinstance(value, str) else default


def number_attr(node: DocumentNode, key: str, default: float) -> float:
    value = node.attrs.get(key)
    return float(value) if isinstance(value, (int, float)) else default


def metric_order(metrics: list[MetricDef]) -> tuple[str, ...]:
    """依赖先行排列，拒绝未知引用与环。Args: metrics。"""
    names = {metric.name for metric in metrics}
    if len(names) != len(metrics):
        raise ValueError("指标名称不能重复")
    graph: dict[str, frozenset[str]] = {}
    for metric in metrics:
        refs = (
            report_formula.metric_references(metric.expr or "")
            if metric.mode == "expr"
            else frozenset[str]()
        )
        if refs - names:
            raise ValueError(f"指标「{metric.name}」引用了未定义指标")
        graph[metric.name] = refs
    try:
        return tuple(TopologicalSorter(graph).static_order())
    except CycleError as error:
        raise ValueError("指标表达式存在循环引用") from error


def validate_template(template: TemplateBody) -> ValidationOut:
    """校验模板结构及所有指标引用。Args: template。"""
    issues: list[TemplateIssue] = []
    try:
        if template.doc_json.type != "doc":
            raise ValueError("文档根节点必须为 doc")
        nodes = list(walk_nodes(template.doc_json))
        if (
            len(json.dumps(template.model_dump(), ensure_ascii=False).encode())
            > MAX_BYTES
        ):
            raise ValueError("模板体积超过上限")
        metric_order(template.metrics)
        sources = {
            f"api:{source.code}": source for source in template.api_sources
        }
        if len(sources) != len(template.api_sources):
            raise ValueError("API 数据来源编码不能重复")
        issues.extend(_metric_issues(template.metrics, sources))
        names = {metric.name for metric in template.metrics}
        for path, node in nodes:
            issues.extend(_node_issues(path, node, names, sources))
    except (ValueError, report_formula.FormulaError) as error:
        issues.append(
            TemplateIssue(scope="doc", where="doc_json", message=str(error))
        )
    return ValidationOut(
        is_valid=not any(issue.is_blocking for issue in issues), issues=issues
    )


def _node_issues(
    path: str,
    node: DocumentNode,
    names: set[str],
    sources: dict[str, ReportApiSource],
) -> list[TemplateIssue]:
    if node.type == "table":
        return _static_table_issues(path, node)
    if node.type in ("dsTable", "dsChart"):
        return _data_node_issues(path, node, sources)
    if node.type not in ("metricRef", "condText"):
        return []
    expression = text_attr(node, "expr")
    if not expression:
        return [
            TemplateIssue(
                scope="node",
                where=path,
                message="数据节点尚未配置",
                is_blocking=False,
            )
        ]
    try:
        if len(expression) > MAX_EXPRESSION_LENGTH:
            raise ValueError("表达式超过长度上限")
        if report_formula.metric_references(expression) - names:
            raise ValueError("节点引用了未定义指标")
    except (ValueError, report_formula.FormulaError) as error:
        return [TemplateIssue(scope="node", where=path, message=str(error))]
    return []


def _static_table_issues(path: str, node: DocumentNode) -> list[TemplateIssue]:
    try:
        table_placements(node.content)
    except ValueError as error:
        return [TemplateIssue(scope="node", where=path, message=str(error))]
    return []


def _check_api_metric(
    metric: MetricDef, sources: dict[str, ReportApiSource]
) -> None:
    table = metric.table or ""
    if not table.startswith("api:") or metric.mode == "expr":
        return
    source = sources.get(table)
    if source is None:
        raise ValueError("引用了未定义的第三方 API 数据来源")
    if metric.key not in {column.key for column in source.columns}:
        raise ValueError("引用了未定义的 API 映射字段")
    if metric.offset or metric.window or metric.anchor != "period":
        raise ValueError(
            "API 报告期偏移请在数据来源中设置，不能重复设置窗口或最新值锚点"
        )


def _metric_issues(
    metrics: list[MetricDef], sources: dict[str, ReportApiSource]
) -> list[TemplateIssue]:
    issues: list[TemplateIssue] = []
    for index, metric in enumerate(metrics):
        try:
            if metric.window:
                report_formula.parse_window(metric.window)
            _check_api_metric(metric, sources)
        except (ValueError, report_formula.FormulaError) as error:
            issues.append(
                TemplateIssue(
                    scope="metric", where=f"metrics.{index}", message=str(error)
                )
            )
    return issues


def _data_node_issues(
    path: str, node: DocumentNode, sources: dict[str, ReportApiSource]
) -> list[TemplateIssue]:
    try:
        spec = DataNodeSpec.model_validate(node.attrs)
        if spec.window:
            report_formula.parse_window(spec.window)
        references = (
            [(item.table, item.key, item.offset) for item in spec.series]
            if node.type == "dsChart"
            else [(spec.table, key, 0) for key in spec.keys]
        )
        if not references or any(
            not table or not key for table, key, _ in references
        ):
            raise ValueError("请选择数据来源和字段")
        for table, key, offset in references:
            metric = MetricDef(
                name="数据内容",
                table=table,
                key=key,
                offset=spec.offset + offset,
                window=spec.window,
                anchor=spec.anchor,
            )
            _check_api_metric(metric, sources)
            if node.type == "dsChart":
                _check_chart_column(metric, sources)
    except ValidationError as error:
        field = ".".join(str(part) for part in error.errors()[0]["loc"])
        return [
            TemplateIssue(
                scope="node",
                where=f"{path}.attrs.{field}",
                message="数据配置的字段类型或范围不正确，请检查条数、精度和报告期偏移",
            )
        ]
    except (ValueError, report_formula.FormulaError) as error:
        return [TemplateIssue(scope="node", where=path, message=str(error))]
    return []


def _check_chart_column(
    metric: MetricDef, sources: dict[str, ReportApiSource]
) -> None:
    source = sources.get(metric.table or "")
    if source is not None and any(
        column.key == metric.key and column.data_type != "number"
        for column in source.columns
    ):
        raise ValueError("图表只能选择数字类型的数据字段")

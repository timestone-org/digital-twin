"""文档限额、业务节点遍历与指标依赖校验。"""

import json
from collections.abc import Iterator
from graphlib import CycleError, TopologicalSorter

from platform_server.apps.dataset.services import report_formula
from platform_server.apps.report.schemas.document import DocumentNode, MetricDef
from platform_server.apps.report.schemas.preview import (
    TemplateIssue,
    ValidationOut,
)
from platform_server.apps.report.schemas.template import TemplateBody

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
        for metric in template.metrics:
            if metric.window:
                report_formula.parse_window(metric.window)
        names = {metric.name for metric in template.metrics}
        for path, node in nodes:
            issues.extend(_node_issues(path, node, names))
    except (ValueError, report_formula.FormulaError) as error:
        issues.append(
            TemplateIssue(scope="doc", where="doc_json", message=str(error))
        )
    return ValidationOut(
        is_valid=not any(issue.is_blocking for issue in issues), issues=issues
    )


def _node_issues(
    path: str, node: DocumentNode, names: set[str]
) -> list[TemplateIssue]:
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

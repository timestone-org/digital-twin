"""图校验：保存、导入与运行前跑的**同一份**实现。

⚠ 校验必须在**保存期**跑：参考实现写了完整的连线约束却全仓零调用，于是非法
连线要等运行到那一步才炸，长流水线里一个笔误代价极高
（docs/MODELING_DESIGN.md §12 第 7 条）。
"""

from dataclasses import dataclass
from typing import cast

from pydantic import ValidationError
from pydantic_core import ErrorDetails

from platform_server.apps.modeling.operators import (
    OperatorBase,
    registry,
)
from platform_server.apps.modeling.schemas.graph import (
    GraphEdge,
    GraphNode,
    PipelineGraph,
)
from platform_server.apps.modeling.services.graph_walk import (
    downstream_splits,
    fields_with_widget,
    known_keys_by_node,
    topological_order,
)

# 参数 schema 上「这是一个列引用」的标记，与算子侧的 `column_field` 同一个键
COLUMN_WIDGET = "column"
_WIDGET_KEY = "x-dt-widget"
# 少于两个节点时谈不上「谁没连进来」
_MIN_CONNECTED_NODES = 2

# pydantic 的报错类型 → 一句中文。它是给最终用户看的，不能出现英文与类型名
_COMPLAINTS: dict[str, str] = {
    "missing": "是必填的",
    "extra_forbidden": "这个算子不认识",
    "literal_error": "取值不在可选范围内",
    "enum": "取值不在可选范围内",
    "bool_parsing": "要填是 / 否",
    "int_parsing": "要填一个整数",
    "int_type": "要填一个整数",
    "float_parsing": "要填一个数",
    "float_type": "要填一个数",
    "string_type": "要填一段文字",
    "list_type": "要填一组值",
    "greater_than": "太小了",
    "greater_than_equal": "太小了",
    "less_than": "太大了",
    "less_than_equal": "太大了",
    "too_long": "填得太多了",
    "string_too_short": "不能留空",
}


@dataclass(frozen=True)
class GraphIssue:
    """一条校验问题。`node_id` / `edge_id` 给界面定位，二者都空表示整图问题。"""

    message: str
    node_id: str = ""
    edge_id: str = ""


def check_graph(graph: PipelineGraph) -> list[GraphIssue]:
    """把一张图的全部问题一次列出来，不在第一条就返回。

    ⚠ 逐条列出而不是遇错即停：用户改完一条再跑一次才发现第二条，是最劝退的
    交互。
    Args: graph。
    """
    issues = _check_nodes(graph)
    nodes = graph.node_by_id()
    issues += _check_edges(graph, nodes)
    if issues:
        return issues
    return (
        _check_ports_wired(graph)
        + _check_acyclic(graph)
        + _check_isolated(graph)
        + _check_columns(graph, nodes)
        + _check_fit_before_split(graph, nodes)
    )


def _check_nodes(graph: PipelineGraph) -> list[GraphIssue]:
    """节点 id 唯一、算子认识、参数能解析。

    Args: graph。
    """
    issues: list[GraphIssue] = []
    seen: set[str] = set()
    for node in graph.nodes:
        if node.id in seen:
            issues.append(GraphIssue("节点 id 重复", node_id=node.id))
        seen.add(node.id)
        if not registry.has(node.operator):
            issues.append(
                GraphIssue(f"不认识的算子「{node.operator}」", node_id=node.id)
            )
            continue
        issues += _check_config(node)
    if not graph.nodes:
        issues.append(GraphIssue("流水线是空的，先拖一个取数算子进来"))
    return issues


def _check_config(node: GraphNode) -> list[GraphIssue]:
    """一个节点的参数能不能被它的算子接受。

    Args: node。
    """
    try:
        registry.get(node.operator).CONFIG_MODEL.model_validate(node.config)
    except ValidationError as error:
        return [
            GraphIssue(
                f"参数「{_field_of(item)}」{_complaint_of(item)}",
                node_id=node.id,
            )
            for item in error.errors()
        ]
    return []


def _check_edges(
    graph: PipelineGraph, nodes: dict[str, GraphNode]
) -> list[GraphIssue]:
    """边的两端节点存在、端口存在、契约相等、输入端口不重复接线。

    Args: graph, nodes。
    """
    issues: list[GraphIssue] = []
    taken: set[tuple[str, str]] = set()
    for edge in graph.edges:
        if edge.from_node not in nodes or edge.to_node not in nodes:
            issues.append(GraphIssue("这条连线的一端已不存在", edge_id=edge.id))
            continue
        issues += _check_edge_ports(edge, nodes)
        if (edge.to_node, edge.to_port) in taken:
            issues.append(GraphIssue("同一个输入口接了两条线", edge_id=edge.id))
        taken.add((edge.to_node, edge.to_port))
    return issues


def _check_edge_ports(
    edge: GraphEdge, nodes: dict[str, GraphNode]
) -> list[GraphIssue]:
    """一条边两端的端口与契约。

    Args: edge, nodes。
    """
    source = registry.get(nodes[edge.from_node].operator)
    target = registry.get(nodes[edge.to_node].operator)
    out_port = next(
        (port for port in source.OUTPUTS if port.name == edge.from_port), None
    )
    in_port = next(
        (port for port in target.INPUTS if port.name == edge.to_port), None
    )
    if out_port is None or in_port is None:
        return [GraphIssue("这条连线接在一个不存在的端口上", edge_id=edge.id)]
    if out_port.contract != in_port.contract:
        return [
            GraphIssue(
                f"「{source.NAME}」的输出接不到「{target.NAME}」的这个入口上",
                edge_id=edge.id,
            )
        ]
    return []


def _check_ports_wired(graph: PipelineGraph) -> list[GraphIssue]:
    """必填的输入端口都接上了。

    Args: graph。
    """
    wired = {(edge.to_node, edge.to_port) for edge in graph.edges}
    return [
        GraphIssue(
            f"入口「{port.label or port.name}」还没接线", node_id=node.id
        )
        for node in graph.nodes
        for port in registry.get(node.operator).INPUTS
        if port.is_required and (node.id, port.name) not in wired
    ]


def _check_acyclic(graph: PipelineGraph) -> list[GraphIssue]:
    """图里不许有环。

    Args: graph。
    """
    if len(topological_order(graph)) == len(graph.nodes):
        return []
    return [GraphIssue("流水线里有环，数据会绕回自己")]


def _check_isolated(graph: PipelineGraph) -> list[GraphIssue]:
    """多于一个节点时，不许有谁一根线都没有。

    Args: graph。
    """
    if len(graph.nodes) < _MIN_CONNECTED_NODES:
        return []
    touched = {edge.from_node for edge in graph.edges} | {
        edge.to_node for edge in graph.edges
    }
    return [
        GraphIssue("这个节点没有连进流水线", node_id=node.id)
        for node in graph.nodes
        if node.id not in touched
    ]


def _check_columns(
    graph: PipelineGraph, nodes: dict[str, GraphNode]
) -> list[GraphIssue]:
    """列引用参数指向的列，必须在上游真的有。

    ⚠ 上游取数没有显式列清单时列集合是未知的，这一项跳过——宁可漏报也不误报。
    Args: graph, nodes。
    """
    issues: list[GraphIssue] = []
    known = known_keys_by_node(graph, nodes)
    for node in graph.nodes:
        keys = known.get(node.id)
        if keys is None:
            continue
        for name in _column_fields(registry.get(node.operator)):
            issues += _check_one_column(node, name, keys)
    return issues


def _check_one_column(
    node: GraphNode, field: str, keys: frozenset[str]
) -> list[GraphIssue]:
    """一个列引用参数里的每个列名。

    Args: node, field, keys。
    """
    raw: object = node.config.get(field)
    referenced = cast("list[object]", raw) if isinstance(raw, list) else [raw]
    return [
        GraphIssue(f"上游没有列「{value}」", node_id=node.id)
        for value in referenced
        if isinstance(value, str) and value and value not in keys
    ]


def _check_fit_before_split(
    graph: PipelineGraph, nodes: dict[str, GraphNode]
) -> list[GraphIssue]:
    """带拟合的算子与它下游的切分之间，不许改变行数、也不许有两个切分。

    ⚠ 这两条是防泄漏的前提：带拟合的算子按「同一份切法」只在训练行上算统计量，
    中间行数一变，算出来的训练行就与切分算子的不是同一批（设计文档 §5.3）。
    Args: graph, nodes。
    """
    issues: list[GraphIssue] = []
    for node in graph.nodes:
        if not registry.get(node.operator).REQUIRES_FIT:
            continue
        splits, resized = downstream_splits(graph, nodes, node.id)
        if len(splits) > 1:
            issues.append(
                GraphIssue(
                    "这一步下游有多个切分，说不清按哪一个防泄漏",
                    node_id=node.id,
                )
            )
        if splits and resized:
            issues.append(
                GraphIssue(
                    "这一步与下游的切分之间有会改变行数的算子，防泄漏会算错",
                    node_id=node.id,
                )
            )
    return issues


def _column_fields(operator: type[OperatorBase]) -> list[str]:
    """算子参数里哪些字段是列引用。

    Args: operator。
    """
    return fields_with_widget(
        operator.CONFIG_MODEL.model_json_schema(), COLUMN_WIDGET
    )


def _complaint_of(item: ErrorDetails) -> str:
    """把 pydantic 的英文报错换成一句中文。

    ⚠ 认不出来的类型原样透出英文而不是吞掉：一句看不懂的英文也比「参数不合法」
    有用，至少能搜。
    Args: item。
    """
    kind = str(item["type"])
    said = _COMPLAINTS.get(kind)
    return said if said is not None else str(item["msg"])


def _field_of(item: ErrorDetails) -> str:
    """报错落在哪个参数上。取不出来时给一个中性的占位。

    Args: item。
    """
    location = item["loc"]
    return str(location[0]) if location else "参数"

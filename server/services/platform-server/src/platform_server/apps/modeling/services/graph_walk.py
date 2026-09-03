"""图上的两趟走查：往下游找切分，以及沿着数据流推算「这一步看得见哪些列」。

拆出来是因为它们是纯拓扑计算，图校验与执行编排都要用
（docs/MODELING_DESIGN.md §5.3、§6.1）。
"""

from collections import deque
from dataclasses import dataclass
from typing import Any, cast

from pydantic import ValidationError

from platform_server.apps.modeling.operators import (
    ColumnKeys,
    ColumnsByPort,
    registry,
)
from platform_server.apps.modeling.schemas.graph import GraphNode, PipelineGraph

# 取数算子的列清单参数名。留空表示「取当前全部列」，那时列集合静态未知
SOURCE_COLUMNS_FIELD = "columns"
# 参数 schema 上「这是一个台账引用」的标记，与算子侧的 `table_field` 同一个键
_TABLE_WIDGET = "table"
_WIDGET_KEY = "x-dt-widget"


def downstream_splits(
    graph: PipelineGraph, nodes: dict[str, GraphNode], start: str
) -> tuple[list[str], bool]:
    """从一个节点往下游走，收集切分节点，并回答途中有没有算子改变行数。

    Args: graph, nodes, start。
    """
    following = _following(graph)
    splits: list[str] = []
    resized = False
    seen = {start}
    queue = list(following.get(start, ()))
    while queue:
        current = queue.pop()
        if current in seen:
            continue
        seen.add(current)
        operator = registry.get(nodes[current].operator)
        if operator.PROVIDES_SPLIT_PLAN:
            splits.append(current)
            continue
        resized = resized or operator.CHANGES_ROW_COUNT
        queue.extend(following.get(current, ()))
    return sorted(splits), resized


def split_plan_of(
    graph: PipelineGraph, nodes: dict[str, GraphNode], start: str
) -> dict[str, object] | None:
    """一个带拟合的算子该按哪份切分计划防泄漏；下游没有切分就给 None。

    ⚠ 计划取的是**校验过的**参数而不是图里那份原始 dict：图里只存用户显式设过
    的键，直接拿去用会缺 `method` / `test_ratio` 这些有默认值的项。
    Args: graph, nodes, start。
    """
    splits, _ = downstream_splits(graph, nodes, start)
    if len(splits) != 1:
        return None
    node = nodes[splits[0]]
    config = registry.get(node.operator).CONFIG_MODEL.model_validate(
        node.config
    )
    return config.model_dump()


@dataclass(frozen=True)
class NodeColumns:
    """一个节点各输入 / 输出端口上的列 key 与顺序。`None` = 静态推不出来。"""

    inputs: dict[str, ColumnKeys]
    outputs: dict[str, ColumnKeys]


def column_flow(
    graph: PipelineGraph, nodes: dict[str, GraphNode]
) -> dict[str, NodeColumns]:
    """沿数据流推算每个节点每个端口上的列。

    ⚠ 每一步怎么改列集，**问算子自己**（`describe_columns`）。过去这里写死的是
    「有上游就原样继承」——那等于假设没有任何算子会增删列，加进第一个时间特征 /
    独热就整条错，且不报错（docs/MODELING_PLATFORM_DESIGN.md D2）。
    ⚠ 推不出来时下游一律跟着未知，宁可漏报也不误报：取数没有显式列清单时，
    列集合要到运行期取完数才知道。
    Args: graph, nodes。
    """
    incoming = _incoming_ports(graph)
    flow: dict[str, NodeColumns] = {}
    for node_id in _order(graph):
        node = nodes[node_id]
        inputs = {
            port: _produced(flow, source, source_port)
            for port, (source, source_port) in incoming.get(node_id, {}).items()
        }
        flow[node_id] = NodeColumns(
            inputs=inputs, outputs=dict(_declared(node, inputs))
        )
    return flow


def known_keys_by_node(
    graph: PipelineGraph, nodes: dict[str, GraphNode]
) -> dict[str, frozenset[str] | None]:
    """每个节点在自己的输入上看得见哪些列。`None` = 静态推不出来。

    ⚠ 顺序在这一层被丢掉是**故意的**：它的两个消费者（保存期的列存在性校验、
    前端的列候选）都只问「在不在」。要顺序的地方用 `column_flow`。
    Args: graph, nodes。
    """
    return {
        node_id: _flattened(columns.inputs)
        for node_id, columns in column_flow(graph, nodes).items()
    }


def known_columns_by_node(
    graph: PipelineGraph, nodes: dict[str, GraphNode]
) -> dict[str, list[str] | None]:
    """每个节点在自己的输入上看得见哪些列，**保持列序**。`None` = 推不出来。

    ⚠ 前端的列选择器读的就是它。过去前端另写了一份「只按取数节点收窄」的口径，
    两份各自自洽而真跑起来对不上（docs/MODELING_PLATFORM_DESIGN.md D2）。
    Args: graph, nodes。
    """
    return {
        node_id: _ordered(columns.inputs)
        for node_id, columns in column_flow(graph, nodes).items()
    }


def _ordered(inputs: dict[str, ColumnKeys]) -> list[str] | None:
    if not inputs:
        return None
    keys: list[str] = []
    for produced in inputs.values():
        if produced is None:
            return None
        keys += [key for key in produced if key not in keys]
    return keys


def _declared(node: GraphNode, inputs: dict[str, ColumnKeys]) -> ColumnsByPort:
    """问算子：给这些输入列，它各个输出端口会有哪些列。

    ⚠ 参数要过一遍校验再交给算子：图里只存用户显式设过的键，直接拿原始 dict
    会缺掉有默认值的那些项。参数不合法时当成推不出来，由图校验去报那条。
    Args: node, inputs。
    """
    if not registry.has(node.operator):
        return {}
    operator = registry.get(node.operator)
    try:
        config = operator.CONFIG_MODEL.model_validate(node.config)
    except ValidationError:
        return {port.name: None for port in operator.OUTPUTS}
    return operator.describe_columns(config, inputs)


def _produced(
    flow: dict[str, NodeColumns], node_id: str, port: str
) -> ColumnKeys:
    known = flow.get(node_id)
    return None if known is None else known.outputs.get(port)


def _flattened(inputs: dict[str, ColumnKeys]) -> frozenset[str] | None:
    if not inputs:
        return None
    keys: set[str] = set()
    for produced in inputs.values():
        if produced is None:
            return None
        keys |= set(produced)
    return frozenset(keys)


def _following(graph: PipelineGraph) -> dict[str, tuple[str, ...]]:
    edges: dict[str, list[str]] = {}
    for edge in graph.edges:
        edges.setdefault(edge.from_node, []).append(edge.to_node)
    return {key: tuple(value) for key, value in edges.items()}


def _incoming_ports(
    graph: PipelineGraph,
) -> dict[str, dict[str, tuple[str, str]]]:
    """`{下游节点: {入口端口: (上游节点, 出口端口)}}`。

    ⚠ 按端口建键而不是只记上游节点：一个算子的两个输入端口可以接不同上游，
    只记节点会把两路的列混成一堆（线性回归的训练集与测试集正是这样）。
    Args: graph。
    """
    edges: dict[str, dict[str, tuple[str, str]]] = {}
    for edge in graph.edges:
        edges.setdefault(edge.to_node, {})[edge.to_port] = (
            edge.from_node,
            edge.from_port,
        )
    return edges


def topological_order(graph: PipelineGraph) -> list[str]:
    """拓扑序的节点 id。有环时只回环外的那些。

    Args: graph。
    """
    indegree = {node.id: 0 for node in graph.nodes}
    outgoing: dict[str, list[str]] = {node.id: [] for node in graph.nodes}
    for edge in graph.edges:
        if edge.from_node in outgoing and edge.to_node in indegree:
            outgoing[edge.from_node].append(edge.to_node)
            indegree[edge.to_node] += 1
    queue = deque(sorted(key for key, value in indegree.items() if value == 0))
    order: list[str] = []
    while queue:
        current = queue.popleft()
        order.append(current)
        for following in outgoing[current]:
            indegree[following] -= 1
            if indegree[following] == 0:
                queue.append(following)
    return order


def _order(graph: PipelineGraph) -> list[str]:
    """拓扑序；有环时回退到声明序，让图校验去报那个环。

    Args: graph。
    """
    order = topological_order(graph)
    if len(order) == len(graph.nodes):
        return order
    return [node.id for node in graph.nodes]


def source_table_codes(graph: PipelineGraph) -> tuple[str, ...]:
    """这张图用到了哪些台账，去重后按字典序。

    ⚠ 按参数 schema 上的**台账引用标记**去认，不按算子 code 判：那样加第二个
    取数算子时不必回来改这里（docs/MODELING_DESIGN.md 附录 B）。
    Args: graph。
    """
    codes: set[str] = set()
    for node in graph.nodes:
        if not registry.has(node.operator):
            continue
        for field in _table_fields(node.operator):
            value: object = node.config.get(field)
            if isinstance(value, str) and value:
                codes.add(value)
    return tuple(sorted(codes))


def _table_fields(operator_code: str) -> list[str]:
    return fields_with_widget(
        registry.get(operator_code).CONFIG_MODEL.model_json_schema(),
        _TABLE_WIDGET,
    )


def fields_with_widget(schema: dict[str, Any], widget: str) -> list[str]:
    """参数 schema 里挂着某个控件标记的字段名。

    ⚠ 列引用与台账引用都靠它认，不靠算子 code 判：加算子时不必回来改校验与
    反查（docs/MODELING_DESIGN.md 附录 B）。
    Args: schema, widget。
    """
    raw: object = schema.get("properties", {})
    if not isinstance(raw, dict):
        return []
    properties = cast("dict[str, object]", raw)
    return [
        name
        for name, spec in properties.items()
        if isinstance(spec, dict)
        and cast("dict[str, object]", spec).get(_WIDGET_KEY) == widget
    ]

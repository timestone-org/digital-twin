"""匹配同一切分后同一路径的训练与测试拟合算子。"""

import json
from collections import defaultdict
from dataclasses import dataclass
from typing import Literal

from pydantic import ValidationError

from platform_server.apps.modeling.operators import OperatorError, registry
from platform_server.apps.modeling.schemas.graph import (
    GraphEdge,
    GraphNode,
    PipelineGraph,
)
from platform_server.apps.modeling.services.graph_walk import topological_order

type _Side = Literal["train", "test"]
type _Step = tuple[str, str, str, str]
type _Key = tuple[str, tuple[_Step, ...], str, str]


@dataclass(frozen=True)
class FitReuse:
    """测试节点的参数来源，以及未能确认来源的测试节点。"""

    sources: dict[str, str]
    unpaired: frozenset[str]

    def source_for(self, node_id: str) -> str | None:
        """取测试节点的训练参数来源。Args: node_id。"""
        if node_id in self.unpaired:
            raise OperatorError(
                f"测试步骤「{node_id}」无法复用训练参数。请在同一个切分的"
                "训练分支保留唯一一个路径与配置一致的拟合步骤"
            )
        return self.sources.get(node_id)


@dataclass(frozen=True)
class _Branch:
    """起点相同、按算子和端口记录的单路数据流。"""

    split_id: str
    side: _Side
    steps: tuple[_Step, ...] = ()


def plan_fit_reuse(graph: PipelineGraph) -> FitReuse:
    """为每个测试拟合节点查找唯一且等价的训练节点。Args: graph。"""
    nodes = graph.node_by_id()
    branches, test_lineage = _branches(graph, nodes)
    training: dict[_Key, list[str]] = defaultdict(list)
    testing: dict[str, _Key] = {}
    unpaired: set[str] = set()
    for node in graph.nodes:
        if not _is_transform(node):
            continue
        branch = branches.get(node.id)
        config = _config_of(node)
        if node.id in test_lineage:
            if branch is None or branch.side != "test" or config is None:
                unpaired.add(node.id)
            else:
                testing[node.id] = (
                    branch.split_id,
                    branch.steps,
                    node.operator,
                    config,
                )
        elif (
            branch is not None and branch.side == "train" and config is not None
        ):
            key = (branch.split_id, branch.steps, node.operator, config)
            training[key].append(node.id)
    sources: dict[str, str] = {}
    for node_id, key in testing.items():
        matches = training.get(key, [])
        if len(matches) == 1:
            sources[node_id] = matches[0]
        else:
            unpaired.add(node_id)
    return FitReuse(sources, frozenset(unpaired))


def _branches(
    graph: PipelineGraph, nodes: dict[str, GraphNode]
) -> tuple[dict[str, _Branch], set[str]]:
    """识别单路分支，并跟踪合流中仍然存在的测试数据。Args: graph, nodes。"""
    incoming: dict[str, list[GraphEdge]] = defaultdict(list)
    for edge in graph.edges:
        if edge.from_node in nodes and edge.to_node in nodes:
            incoming[edge.to_node].append(edge)
    branches: dict[str, _Branch] = {}
    test_lineage: set[str] = set()
    for node_id in topological_order(graph):
        feeds = incoming[node_id]
        if any(
            edge.from_node in test_lineage
            or _split_side(nodes[edge.from_node], edge.from_port) == "test"
            for edge in feeds
        ):
            test_lineage.add(node_id)
        if len(feeds) != 1:
            continue
        edge = feeds[0]
        branch = _from_edge(edge, nodes[edge.from_node], branches)
        if branch is not None:
            branches[node_id] = branch
    return branches, test_lineage


def _from_edge(
    edge: GraphEdge, source: GraphNode, branches: dict[str, _Branch]
) -> _Branch | None:
    """沿单条输入边延续切分路径。Args: edge, source, branches。"""
    side = _split_side(source, edge.from_port)
    if side is not None:
        return _Branch(source.id, side)
    branch = branches.get(source.id)
    if branch is None:
        return None
    config = _config_of(source)
    if config is None:
        return None
    step = (source.operator, config, edge.from_port, edge.to_port)
    return _Branch(branch.split_id, branch.side, (*branch.steps, step))


def _split_side(source: GraphNode, port: str) -> _Side | None:
    """读取切分节点的训练或测试端口。Args: source, port。"""
    if port not in ("train", "test") or not registry.has(source.operator):
        return None
    if registry.get(source.operator).PROVIDES_SPLIT_PLAN:
        return "train" if port == "train" else "test"
    return None


def _config_of(node: GraphNode) -> str | None:
    """比较生效配置，包括算子默认值。Args: node。"""
    if not registry.has(node.operator):
        return None
    config = registry.get(node.operator).CONFIG_MODEL
    try:
        return json.dumps(
            config.model_validate(node.config).model_dump(mode="json"),
            sort_keys=True,
        )
    except ValidationError:
        return None


def _is_transform(node: GraphNode) -> bool:
    """只选需要拟合的预处理和特征工程。Args: node。"""
    if not registry.has(node.operator):
        return False
    operator = registry.get(node.operator)
    return operator.REQUIRES_FIT and operator.CATEGORY in {
        "feature",
        "preprocess",
    }

"""有界有向计量拓扑的路径、传输损耗与节点守恒。"""

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal

from platform_server.apps.modeling.operators.energy_rule_config import (
    MAX_TRACE_PATHS,
    EnergyFlowEdge,
    EnergyRulesConfig,
    configured_topology,
    topology_order,
)
from platform_server.apps.modeling.operators.energy_rule_math import (
    decimal_text,
    nonnegative_of,
)


@dataclass(frozen=True)
class FlowReading:
    """来源端计量和抵达目标端的能源量。"""

    edge: EnergyFlowEdge
    measured: Decimal
    received: Decimal


def trace_energy(
    config: EnergyRulesConfig, row: Mapping[str, object]
) -> dict[str, object]:
    """每条观测保留可核对的计量路径和差额；Args: config, row。"""
    edges = configured_topology(config)
    flows = tuple(_read_flow(edge, row) for edge in edges)
    nodes = topology_order(edges)
    places = config.parameters.decimal_places
    balances = [_node_balance(node, flows, config) for node in nodes]
    supply, consumption, loss, imbalance = _totals(flows, nodes)
    return {
        "unit": edges[0].unit,
        "edges": [_edge_result(flow, places) for flow in flows],
        "nodes": balances,
        "paths": trace_paths(edges),
        "total_supply": decimal_text(supply, places),
        "total_consumption": decimal_text(consumption, places),
        "total_edge_loss": decimal_text(loss, places),
        "total_node_imbalance": decimal_text(imbalance, places),
        "conservation_residual": decimal_text(
            supply - consumption - loss - imbalance, places
        ),
        "is_balanced": all(item["is_balanced"] for item in balances),
        "balance_scope": "metered_internal_nodes",
        "summary_value": float(
            sum(abs(_imbalance(node, flows)) for node in nodes)
        ),
    }


def _read_flow(edge: EnergyFlowEdge, row: Mapping[str, object]) -> FlowReading:
    measured = nonnegative_of(row, edge.column)
    return FlowReading(
        edge=edge, measured=measured, received=measured * edge.efficiency
    )


def _edge_result(flow: FlowReading, places: int) -> dict[str, object]:
    return {
        "source": flow.edge.source,
        "target": flow.edge.target,
        "column": flow.edge.column,
        "unit": flow.edge.unit,
        "efficiency": str(flow.edge.efficiency),
        "input": decimal_text(flow.measured, places),
        "delivered": decimal_text(flow.received, places),
        "loss": decimal_text(flow.measured - flow.received, places),
    }


def _node_balance(
    node: str, flows: tuple[FlowReading, ...], config: EnergyRulesConfig
) -> dict[str, object]:
    incoming = sum(
        (flow.received for flow in flows if flow.edge.target == node),
        Decimal(0),
    )
    outgoing = sum(
        (flow.measured for flow in flows if flow.edge.source == node),
        Decimal(0),
    )
    has_incoming = any(flow.edge.target == node for flow in flows)
    has_outgoing = any(flow.edge.source == node for flow in flows)
    imbalance = (
        incoming - outgoing if has_incoming and has_outgoing else Decimal(0)
    )
    places = config.parameters.decimal_places
    return {
        "node": node,
        "incoming": decimal_text(incoming, places),
        "outgoing": decimal_text(outgoing, places),
        "external_supply": decimal_text(
            outgoing if not has_incoming else Decimal(0), places
        ),
        "external_consumption": decimal_text(
            incoming if not has_outgoing else Decimal(0), places
        ),
        "imbalance": decimal_text(imbalance, places),
        "is_boundary": not (has_incoming and has_outgoing),
        "is_balanced": abs(imbalance)
        <= Decimal(str(config.parameters.balance_tolerance)),
    }


def _imbalance(node: str, flows: tuple[FlowReading, ...]) -> Decimal:
    incoming = [flow.received for flow in flows if flow.edge.target == node]
    outgoing = [flow.measured for flow in flows if flow.edge.source == node]
    if not incoming or not outgoing:
        return Decimal(0)
    return sum(incoming, Decimal(0)) - sum(outgoing, Decimal(0))


def _totals(
    flows: tuple[FlowReading, ...], nodes: tuple[str, ...]
) -> tuple[Decimal, Decimal, Decimal, Decimal]:
    sources = {flow.edge.source for flow in flows}
    targets = {flow.edge.target for flow in flows}
    supply = sum(
        (flow.measured for flow in flows if flow.edge.source not in targets),
        Decimal(0),
    )
    consumption = sum(
        (flow.received for flow in flows if flow.edge.target not in sources),
        Decimal(0),
    )
    loss = sum((flow.measured - flow.received for flow in flows), Decimal(0))
    imbalance = sum((_imbalance(node, flows) for node in nodes), Decimal(0))
    return supply, consumption, loss, imbalance


def trace_paths(edges: tuple[EnergyFlowEdge, ...]) -> list[list[str]]:
    """列出结构路径并限制分支展开；Args: edges。"""
    targets = {edge.target for edge in edges}
    roots = tuple(
        dict.fromkeys(
            edge.source for edge in edges if edge.source not in targets
        )
    )
    pending = [[root] for root in roots]
    paths: list[list[str]] = []
    while pending:
        path = pending.pop(0)
        children = [edge.target for edge in edges if edge.source == path[-1]]
        if children:
            pending.extend([*path, child] for child in children)
        else:
            paths.append(path)
        if len(paths) + len(pending) > MAX_TRACE_PATHS:
            raise ValueError("能源流向路径数量超过上限")
    return paths

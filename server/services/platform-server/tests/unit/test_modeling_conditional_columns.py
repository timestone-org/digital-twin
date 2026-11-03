"""条件列引用只检查当前会参与计算的字段。"""

from platform_server.apps.modeling.schemas.graph import GraphEdge, PipelineGraph
from platform_server.apps.modeling.services.graph_check import check_graph
from unit.modeling_fakes import node


def calculation_graph(*, right_mode: str | None) -> PipelineGraph:
    config: dict[str, object] = {
        "left_column": "energy",
        "right_column": "old_column",
    }
    if right_mode is not None:
        config["right_mode"] = right_mode
    return PipelineGraph(
        nodes=[
            node(
                "source",
                "ledger_source",
                table_code="energy",
                columns=["energy"],
            ),
            node("math", "column_math", **config),
        ],
        edges=[
            GraphEdge(
                id="edge",
                from_node="source",
                from_port="frame",
                to_node="math",
                to_port="frame",
            )
        ],
    )


def test_constant_calculation_ignores_retained_inactive_column() -> None:
    assert check_graph(calculation_graph(right_mode="constant")) == []


def test_default_mode_uses_operator_default_for_column_visibility() -> None:
    assert check_graph(calculation_graph(right_mode=None)) == []


def test_column_calculation_still_rejects_missing_active_column() -> None:
    issues = check_graph(calculation_graph(right_mode="column"))
    assert len(issues) == 1
    assert "old_column" in issues[0].message
    assert issues[0].node_id == "math"

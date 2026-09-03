"""列在图上怎么流：静态声明推一遍，真跑一遍，两者必须一致。

⚠ 这一组盯的是 `describe_columns` 这条**声明**（docs/MODELING_PLATFORM_DESIGN.md
D2 / D3）。声明写错不会让任何一步报错，它只会让入口契约算错——而入口契约错的
表现是「第三方被要求提供一列管线自己造的东西」。
"""

from platform_server.apps.modeling.operators import registry
from platform_server.apps.modeling.schemas.graph import GraphNode, PipelineGraph
from platform_server.apps.modeling.services.graph_walk import (
    column_flow,
    known_keys_by_node,
)
from platform_server.apps.modeling.services.run_executor import execute_graph
from unit.modeling_fakes import (
    DirectRunner,
    execution_of,
    linear_frame,
    linear_graph,
    node,
)

TABLE = "energy_h"
PICKED = ["温度", "负荷", "能耗"]


def _nodes(graph: PipelineGraph) -> dict[str, GraphNode]:
    return graph.node_by_id()


def test_the_source_declares_the_columns_it_was_configured_to_take() -> None:
    """取数节点的输出列就是参数里挑的那几列，且保持挑选顺序。"""
    graph = linear_graph()
    flow = column_flow(graph, _nodes(graph))
    assert flow["s"].outputs["frame"] == tuple(PICKED)


def test_an_open_ended_source_makes_everything_downstream_unknown() -> None:
    """取数留空 = 取全部列，静态推不出来，下游一律跟着未知。

    ⚠ 宁可漏报也不误报：这时候把候选收窄，用户会看到「我那一列不见了」。
    """
    graph = PipelineGraph(
        nodes=[
            node("s", "ledger_source", table_code=TABLE, columns=[]),
            node("f", "fill_missing"),
        ],
        edges=list(linear_graph().edges[:1]),
    )
    flow = column_flow(graph, _nodes(graph))
    assert flow["s"].outputs["frame"] is None
    assert flow["f"].inputs["frame"] is None
    assert known_keys_by_node(graph, _nodes(graph))["f"] is None


def test_the_scored_frame_is_not_the_training_columns() -> None:
    """打分帧是新造的两列。

    ⚠ 用默认的恒等实现会把训练集那一堆特征列当成打分帧的列，于是评估节点的
    列候选里出现一串根本不存在的名字。
    """
    graph = linear_graph()
    flow = column_flow(graph, _nodes(graph))
    assert flow["m"].outputs["scored"] == ("y_true", "y_pred")
    assert flow["e"].inputs["scored"] == ("y_true", "y_pred")


def test_both_split_outputs_carry_the_same_columns() -> None:
    """切分两路出口的列集相同——它切的是行，不是列。"""
    graph = linear_graph()
    flow = column_flow(graph, _nodes(graph))
    assert flow["p"].outputs["train"] == flow["p"].outputs["test"]
    assert flow["p"].outputs["train"] == tuple(PICKED)


async def test_the_declaration_matches_what_the_operators_really_did() -> None:
    """逐节点比对：声明推出来的列，与真跑一遍记下来的列一致。

    ⚠ 这是**唯一**能逮到「加了算子却忘了覆盖 `describe_columns`」的闸。忘了的
    表现不是报错，是入口契约悄悄错一列。
    ⚠ 取数不在核对范围内：`should_drop_empty_columns` 开着时它运行期会丢列，
    声明那份是上界。它 `ENABLED_IN_SERVING=False`，不进推理链，故不影响契约。
    """
    graph = linear_graph()
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(80)})
    outcome = await execute_graph(graph, execution=execution)
    flow = column_flow(graph, _nodes(graph))
    for item in outcome.nodes:
        if registry.get(item.operator).CATEGORY == "source":
            continue
        actual_in = {
            port: tuple(keys) for port, keys in item.io["inputs"].items()
        }
        declared = registry.get(item.operator).describe_columns(
            registry.get(item.operator).CONFIG_MODEL.model_validate(
                _nodes(graph)[item.node_id].config
            ),
            actual_in,
        )
        for port, keys in item.io["outputs"].items():
            assert declared[port] == tuple(keys), (item.operator, port)
        assert flow[item.node_id].inputs == actual_in, item.operator

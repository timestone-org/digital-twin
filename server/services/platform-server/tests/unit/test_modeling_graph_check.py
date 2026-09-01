"""图校验的用例。每条规则一个用例，且每条都断言报错是**中文人话**。"""

from platform_server.apps.modeling.schemas.graph import (
    GraphEdge,
    PipelineGraph,
)
from platform_server.apps.modeling.services.graph_check import check_graph
from unit.modeling_fakes import linear_graph, node


def messages(graph: PipelineGraph) -> list[str]:
    """把问题折成一串文案，便于断言。

    Args: graph。
    """
    return [issue.message for issue in check_graph(graph)]


def test_the_minimal_pipeline_is_valid() -> None:
    """五类算子各一个的最小闭环必须一条问题都没有。"""
    assert check_graph(linear_graph()) == []


def test_an_empty_pipeline_says_so() -> None:
    """空流水线给一句能照着做的话，不是「校验失败」。"""
    assert messages(PipelineGraph()) == ["流水线是空的，先拖一个取数算子进来"]


def test_an_unknown_operator_is_rejected() -> None:
    """图里出现注册表不认识的算子码即拒。"""
    graph = PipelineGraph(nodes=[node("x", "custom_code")])
    assert messages(graph) == ["不认识的算子「custom_code」"]


def test_missing_required_config_is_reported_in_chinese() -> None:
    """必填参数缺失报的是「是必填的」，不是 pydantic 的英文。"""
    graph = PipelineGraph(nodes=[node("p", "split_dataset")])
    assert "参数「target_column」是必填的" in messages(graph)


def test_an_unknown_config_key_is_rejected() -> None:
    """多带一个参数就拒——不然客户端会以为那个拼错的键生效了。"""
    graph = PipelineGraph(
        nodes=[node("p", "split_dataset", target_column="能耗", nope=1)]
    )
    assert "参数「nope」这个算子不认识" in messages(graph)


def test_out_of_range_config_is_reported() -> None:
    """越界的数值参数当场报。"""
    graph = PipelineGraph(
        nodes=[node("p", "split_dataset", target_column="能耗", test_ratio=9.0)]
    )
    assert "参数「test_ratio」太大了" in messages(graph)


def test_contract_mismatch_is_rejected() -> None:
    """两端契约不等即不许连线。"""
    graph = linear_graph()
    graph.edges.append(
        GraphEdge(
            id="bad",
            from_node="m",
            from_port="model",
            to_node="f",
            to_port="frame",
        )
    )
    assert "「线性回归」的输出接不到「填缺失」的这个入口上" in messages(graph)


def test_an_unknown_port_is_rejected() -> None:
    """接在不存在的端口上即拒——参考实现要等运行到那一步才炸。"""
    graph = linear_graph()
    graph.edges[0] = GraphEdge(
        id="e1",
        from_node="s",
        from_port="没有这个口",
        to_node="f",
        to_port="frame",
    )
    assert "这条连线接在一个不存在的端口上" in messages(graph)


def test_two_edges_into_one_input_are_rejected() -> None:
    """一个输入口只能接一条线。"""
    graph = linear_graph()
    graph.edges.append(
        GraphEdge(
            id="dup",
            from_node="s",
            from_port="frame",
            to_node="f",
            to_port="frame",
        )
    )
    assert "同一个输入口接了两条线" in messages(graph)


def test_a_missing_wire_on_a_required_port_is_reported() -> None:
    """必填入口没接线要说清楚是哪个口。"""
    graph = linear_graph()
    graph.edges = [edge for edge in graph.edges if edge.id != "e5"]
    assert "入口「测试集」还没接线" in messages(graph)


def test_a_cycle_is_rejected() -> None:
    """图里不许有环。两个节点互相喂对方，各自的入口都只接了一条线。"""
    graph = PipelineGraph(
        nodes=[node("a", "fill_missing"), node("b", "fill_missing")],
        edges=[
            GraphEdge(
                id="ab",
                from_node="a",
                from_port="frame",
                to_node="b",
                to_port="frame",
            ),
            GraphEdge(
                id="ba",
                from_node="b",
                from_port="frame",
                to_node="a",
                to_port="frame",
            ),
        ],
    )
    assert "流水线里有环，数据会绕回自己" in messages(graph)


def test_an_isolated_node_is_reported() -> None:
    """一根线都没有的节点要被点名。"""
    graph = linear_graph()
    graph.nodes.append(node("lonely", "fill_missing"))
    assert "这个节点没有连进流水线" in messages(graph)


def test_a_column_typo_is_caught_at_save_time() -> None:
    """列名打错在**保存期**就报，不必等运行时取完数才知道。"""
    graph = linear_graph()
    graph.nodes[1].config = {"columns": ["没有这一列"]}
    assert "上游没有列「没有这一列」" in messages(graph)


def test_column_checks_are_skipped_when_the_source_lists_no_columns() -> None:
    """取数没有显式列清单时列集合静态未知，这一项跳过——宁可漏报也不误报。"""
    graph = linear_graph()
    graph.nodes[0].config = {"table_code": "energy_h"}
    graph.nodes[1].config = {"columns": ["运行期才知道有没有"]}
    assert check_graph(graph) == []


def test_two_splits_downstream_of_a_fitting_operator_are_rejected() -> None:
    """带拟合的算子下游有两个切分时，说不清按哪一个防泄漏。"""
    graph = linear_graph()
    graph.nodes.append(node("p2", "split_dataset", target_column="能耗"))
    graph.edges.append(
        GraphEdge(
            id="e7",
            from_node="z",
            from_port="frame",
            to_node="p2",
            to_port="frame",
        )
    )
    assert "这一步下游有多个切分，说不清按哪一个防泄漏" in messages(graph)

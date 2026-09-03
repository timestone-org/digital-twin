"""滞后与滚动统计，以及它们让整条流水线不可服务这件事。

⚠ 「不可服务」那条分支在这两个算子出现之前**没有任何算子能触发它**——判定写了、
原因文案写了，却从没跑过。这一组把它跑起来（docs/MODELING_DESIGN.md §7.6）。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.publish_service import inspect_run
from platform_server.apps.modeling.services.run_executor import (
    RunOutcome,
    execute_graph,
)
from unit.modeling_fakes import (
    DirectRunner,
    edge,
    execution_of,
    linear_frame,
    linear_graph,
    node,
)

KEY = "读数"


def _frame(values: list[float | None]) -> Frame:
    return Frame(
        columns=(FrameColumn(key=KEY, name=KEY, dtype="number"),),
        rows=tuple((value,) for value in values),
    )


def _made(code: str, frame: Frame, **config: Any) -> Frame:
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    produced = operator.run({"frame": frame})["frame"]
    assert isinstance(produced, Frame)
    return produced


def test_a_lag_moves_earlier_rows_forward() -> None:
    """滞后 1 期就是上一行的值。"""
    got = _made("lag_feature", _frame([1.0, 2.0, 3.0]), columns=[KEY], lags=[1])
    assert got.values_of(f"{KEY}@lag1") == [None, 1.0, 2.0]


def test_the_rows_without_enough_history_are_blank_not_zero() -> None:
    """头几行没有那么多历史，那几格是空值。

    ⚠ 填 0 会把「还没有历史」说成「历史上是 0」，而模型学到的是后者。
    """
    got = _made("lag_feature", _frame([1.0, 2.0]), columns=[KEY], lags=[2])
    assert got.values_of(f"{KEY}@lag2") == [None, None]


def test_several_lags_make_several_columns() -> None:
    """每一期一列，列名带期数。"""
    got = _made(
        "lag_feature", _frame([1.0, 2.0, 3.0]), columns=[KEY], lags=[2, 1]
    )
    assert got.keys == (KEY, f"{KEY}@lag1", f"{KEY}@lag2")


def test_a_rolling_mean_is_hand_checkable() -> None:
    """滚动均值手算核对，窗口不满的那几行是空值。"""
    got = _made(
        "rolling_feature",
        _frame([1.0, 2.0, 3.0, 4.0]),
        columns=[KEY],
        window=2,
        stats=["mean"],
    )
    assert got.values_of(f"{KEY}@mean2") == [None, 1.5, 2.5, 3.5]


def test_each_rolling_stat_gets_its_own_column() -> None:
    """要几个统计量就出几列。"""
    got = _made(
        "rolling_feature",
        _frame([1.0, 3.0]),
        columns=[KEY],
        window=2,
        stats=["min", "max"],
    )
    assert got.values_of(f"{KEY}@min2") == [None, 1.0]
    assert got.values_of(f"{KEY}@max2") == [None, 3.0]


def test_a_window_of_only_blanks_stays_blank() -> None:
    """窗口内全是空值时那一格还是空的，不是 0。"""
    got = _made(
        "rolling_feature",
        _frame([None, None]),
        columns=[KEY],
        window=2,
        stats=["mean"],
    )
    assert got.values_of(f"{KEY}@mean2") == [None, None]


def test_an_out_of_range_lag_is_refused() -> None:
    """越界的期数当场说清楚。"""
    with pytest.raises(OperatorError, match="滞后期数"):
        _made("lag_feature", _frame([1.0]), columns=[KEY], lags=[0])


def test_the_declaration_matches_what_lagging_really_makes() -> None:
    """声明造哪几列，与真跑一遍造出来的一致。"""
    operator = registry.get("lag_feature")
    config = operator.CONFIG_MODEL.model_validate(
        {"columns": [KEY], "lags": [1, 2]}
    )
    declared = operator.describe_columns(config, {"frame": (KEY,)})
    got = _made(
        "lag_feature", _frame([1.0, 2.0, 3.0]), columns=[KEY], lags=[1, 2]
    )
    assert declared["frame"] == got.keys


async def test_a_pipeline_with_a_window_feature_cannot_be_published() -> None:
    """带窗口特征的流水线训得出来，但发布时明说上不了线。

    ⚠ 推理时只有一行，拿它算「上一行的值」算出来的是空——每一列看着都正常，
    而预测值与训练时完全不是一回事。
    """
    graph = linear_graph()
    graph.nodes.insert(1, node("w", "lag_feature", columns=["温度"], lags=[1]))
    graph.edges = [item for item in graph.edges if item.id != "e1"]
    graph.edges.insert(0, edge("e1a", "s", "frame", "w", "frame"))
    graph.edges.insert(1, edge("e1b", "w", "frame", "f", "frame"))
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(60)})
    outcome = await execute_graph(graph, execution=execution)
    assert outcome.status == "succeeded"

    verdict = inspect_run(graph, _records_of(outcome))
    assert verdict.is_servable is False
    assert "窗口" in verdict.reason


def _records_of(outcome: RunOutcome) -> dict[str, NodeRecord]:
    """把一次运行的逐节点结果摆成发布侧读到的那个形状。

    Args: outcome。
    """
    return {
        item.node_id: NodeRecord(
            preview=dict(item.preview), fitted=item.fitted, io=dict(item.io)
        )
        for item in outcome.nodes
    }

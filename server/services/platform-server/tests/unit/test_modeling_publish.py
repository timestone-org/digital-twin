"""发布判定的用例：跑一遍真图 → 发布 → 拿发布件真预测一次。

⚠ 这一组的立论是「跑通了」不等于「上线能用」。整条链路里唯一能证明发布件真
的可用的动作，是**拿它算一个数出来并与手算核对**——只编译、只看 servable 标志
都证明不了（docs/MODELING_PLATFORM_DESIGN.md 缺陷 A）。
"""

from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

import pytest

from platform_server.apps.modeling.operators import OperatorError
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.model_schema import build_schema
from platform_server.apps.modeling.services.publish_service import inspect_run
from platform_server.apps.modeling.services.run_executor import (
    RunOutcome,
    execute_graph,
)
from platform_server.apps.modeling.services.serving import (
    SERVING_FORMAT_V1,
    compile_model,
)
from unit.modeling_fakes import (
    INTERCEPT,
    SLOPE_LOAD,
    SLOPE_TEMP,
    DirectRunner,
    edge,
    execution_of,
    linear_frame,
    linear_graph,
    node,
)

# 拿去预测的那一行，与它手算出来的答案
SAMPLE_TEMPERATURE = 25.0
SAMPLE_LOAD = 430.0
EXPECTED = (
    SLOPE_TEMP * SAMPLE_TEMPERATURE + SLOPE_LOAD * SAMPLE_LOAD + INTERCEPT
)


async def _run() -> tuple[PipelineGraph, dict[str, NodeRecord]]:
    """跑一遍**带标准化**的最小闭环，回图与逐节点记录。"""
    graph = linear_graph()
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(120)})
    return graph, _records_of(await execute_graph(graph, execution=execution))


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


async def test_a_standardized_pipeline_publishes_and_really_predicts() -> None:
    """带标准化的流水线发布出来的件，算出来的数与手算一致。

    ⚠ 这一条是修复前必红的那一条：拟合参数没落库时，标准化会在推理期拿单行
    重新拟合、当场除零，`predict` 抛「只有一个取值」。
    """
    graph, records = await _run()
    verdict = inspect_run(graph, records)
    assert verdict.is_servable is True, verdict.reason
    got = compile_model(verdict.serving).predict(
        [SAMPLE_TEMPERATURE, SAMPLE_LOAD]
    )
    assert got == pytest.approx(EXPECTED, rel=1e-6)


async def test_the_scales_learned_in_training_are_the_ones_shipped() -> None:
    """发布件里标准化那一步的尺度，就是训练时学到的那一份。"""
    graph, records = await _run()
    shipped = _step_of(inspect_run(graph, records).serving, "standardize")
    assert shipped["fitted"] == records["z"].fitted


async def test_a_step_without_its_parameters_is_refused() -> None:
    """该带参数的一步空着就不许上线，且原因里指名是哪一步。

    ⚠ 空参数不报错，它让那一步在推理时拿单行重算——必须在发布这一刻拦下。
    """
    graph, records = await _run()
    records["z"] = replace(records["z"], fitted={})
    verdict = inspect_run(graph, records)
    assert verdict.is_servable is False
    assert "标准化" in verdict.reason


async def test_a_run_from_before_the_columns_existed_is_refused() -> None:
    """历史运行没有拟合参数那一列，读不到就拒绝发布而不是当成空的照发。"""
    graph, records = await _run()
    records = {
        node_id: replace(record, fitted=None)
        for node_id, record in records.items()
    }
    verdict = inspect_run(graph, records)
    assert verdict.is_servable is False
    assert "重跑" in verdict.reason


async def test_the_entry_contract_is_what_the_caller_must_supply() -> None:
    """入口契约是取数挑的那几列**去掉目标列**，且保持挑选顺序。

    ⚠ 顺序是契约的一部分：绑定按位置把形参映射到特征上，重排会让存量绑定静默
    错位（docs/MODELING_PLATFORM_DESIGN.md D5）。
    """
    graph, records = await _run()
    entry = inspect_run(graph, records).serving["entry_columns"]
    assert [item["key"] for item in entry] == ["温度", "负荷"]
    assert all(item["dtype"] == "number" for item in entry)


async def test_each_step_declares_the_columns_it_will_really_see() -> None:
    """逐步的期望列是从入口正推出来的，不再是所有步骤同一份特征列。"""
    graph, records = await _run()
    steps = inspect_run(graph, records).serving["steps"]
    for step in steps:
        assert step["expected_input_columns"] == ["温度", "负荷"]
    assert steps[-1]["operator"] == "linear_regression"


async def test_a_version_published_before_the_upgrade_still_predicts() -> None:
    """头一版可服务表示照旧加载、照旧算出同一个数。

    ⚠ 模型版本不可变：历史版本必须按它当初的口径继续算。这条路一改，从某天起
    某几列的历史值与新值口径不同，而没有任何一处会报错。
    """
    graph, records = await _run()
    serving = inspect_run(graph, records).serving
    legacy = {
        "format_version": SERVING_FORMAT_V1,
        "task": serving["task"],
        "input_columns": [item["key"] for item in serving["entry_columns"]],
        "steps": serving["steps"],
    }
    got = compile_model(legacy).predict([SAMPLE_TEMPERATURE, SAMPLE_LOAD])
    assert got == pytest.approx(EXPECTED, rel=1e-6)


async def test_the_signature_says_what_to_feed_the_model() -> None:
    """模型签名逐列给出标签、单位、类型与训练区间，输出那一格说清算的是什么。"""
    graph, records = await _run()
    signature = inspect_run(graph, records).signature
    assert [item["key"] for item in signature["inputs"]] == ["温度", "负荷"]
    temperature = signature["inputs"][0]
    assert temperature["label"] == "环境温度"
    assert temperature["unit"] == "℃"
    assert (
        temperature["training_stats"]["max"]
        > temperature["training_stats"]["min"]
    )
    assert signature["output"]["key"] == "能耗"
    assert signature["output"]["task"] == "regression"
    assert signature["derived"] == []


async def test_a_filled_column_is_optional_and_says_what_it_falls_back_to() -> (
    None
):
    """推理链头一步就把空值填上的列，调用方可以不给，并给出会填成什么。"""
    graph, records = await _run()
    inputs = inspect_run(graph, records).signature["inputs"]
    fills = records["f"].fitted or {}
    for item in inputs:
        assert item["is_required"] is False
        assert item["default_on_missing"] == pytest.approx(fills[item["key"]])


async def test_a_fill_behind_a_scaler_does_not_make_a_column_optional() -> None:
    """填充排在标准化后面时那一列仍然必填。

    ⚠ 这条不能省：那时候这一列在被填之前就已经被读过了，不给它照样算错——
    而界面上会写着「可缺省」（docs/MODELING_PLATFORM_DESIGN.md D7）。
    """
    graph, records = await _run()
    verdict = inspect_run(graph, records)
    swapped = list(reversed(verdict.serving["steps"][:2]))
    signature = build_schema(
        entry=[
            {
                "key": item.key,
                "label": item.label,
                "unit": item.unit,
                "dtype": item.dtype,
                "stats": item.stats,
            }
            for item in verdict.entry_columns
        ],
        steps=[*swapped, *verdict.serving["steps"][2:]],
        target={"key": "能耗"},
        task="regression",
    )
    assert all(item["is_required"] for item in signature["inputs"])


def test_an_unreadable_serving_format_is_refused() -> None:
    """认不出的版本号当场抛，不猜、不回退到某一版。"""
    with pytest.raises(OperatorError):
        compile_model(
            {"format_version": "9.9", "entry_columns": [], "steps": []}
        )


async def _with_time_feature() -> tuple[PipelineGraph, dict[str, NodeRecord]]:
    """在取数与填缺失之间插一个时间特征，跑一遍。"""
    graph = linear_graph()
    graph.nodes.insert(1, node("t", "time_feature", parts=["hour"]))
    graph.edges = [item for item in graph.edges if item.id != "e1"]
    graph.edges.insert(0, edge("e1a", "s", "frame", "t", "frame"))
    graph.edges.insert(1, edge("e1b", "t", "frame", "f", "frame"))
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(120)})
    return graph, _records_of(await execute_graph(graph, execution=execution))


async def test_derived_columns_stay_out_of_the_entry_contract() -> None:
    """管线自己造的列不进入口契约，调用方只给原始那两列。

    ⚠ 这是第二期那套地基的验收：把 `ts_hour` 列进契约，第三方就会被要求提供
    一列管线自己会造的东西（docs/MODELING_PLATFORM_DESIGN.md D4）。
    """
    graph, records = await _with_time_feature()
    verdict = inspect_run(graph, records)
    assert verdict.is_servable is True, verdict.reason
    entry = [item["key"] for item in verdict.serving["entry_columns"]]
    assert entry == ["温度", "负荷"]
    assert "ts_hour" in verdict.feature_keys


async def test_each_step_sees_the_columns_that_exist_by_then() -> None:
    """逐步的期望列跟着链路长出来，不再是所有步骤同一份。"""
    graph, records = await _with_time_feature()
    steps = inspect_run(graph, records).serving["steps"]
    assert steps[0]["operator"] == "time_feature"
    assert steps[0]["expected_input_columns"] == ["温度", "负荷"]
    assert steps[1]["expected_input_columns"] == ["温度", "负荷", "ts_hour"]


async def test_the_signature_lists_the_derived_column_apart() -> None:
    """签名把派生列单列一栏，并标出要一个时刻。"""
    graph, records = await _with_time_feature()
    signature = inspect_run(graph, records).signature
    assert [item["key"] for item in signature["inputs"]] == ["温度", "负荷"]
    assert [item["key"] for item in signature["derived"]] == ["ts_hour"]
    assert signature["requires_timestamp"] is True


async def test_such_a_model_refuses_to_predict_without_a_moment() -> None:
    """带时间特征的模型没给时刻时当场说清楚。

    ⚠ 拿「现在」顶替会让同一行在不同时候算出不同的数。
    """
    graph, records = await _with_time_feature()
    compiled = compile_model(inspect_run(graph, records).serving)
    assert compiled.requires_timestamp is True
    with pytest.raises(OperatorError, match="时刻"):
        compiled.predict([SAMPLE_TEMPERATURE, SAMPLE_LOAD])


async def test_with_a_moment_it_predicts_a_number() -> None:
    """给了时刻就算得出数。"""
    graph, records = await _with_time_feature()
    compiled = compile_model(inspect_run(graph, records).serving)
    got = compiled.predict(
        [SAMPLE_TEMPERATURE, SAMPLE_LOAD],
        datetime(2026, 1, 5, 1, 0, tzinfo=UTC),
    )
    assert got is not None


def _step_of(serving: dict[str, Any], operator: str) -> dict[str, Any]:
    """发布件里某个算子那一步。

    Args: serving, operator。
    """
    for step in serving["steps"]:
        if step["operator"] == operator:
            return dict(step)
    raise AssertionError(f"发布件里没有 {operator} 这一步")

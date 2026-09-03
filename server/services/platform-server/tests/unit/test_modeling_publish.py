"""发布判定的用例：跑一遍真图 → 发布 → 拿发布件真预测一次。

⚠ 这一组的立论是「跑通了」不等于「上线能用」。整条链路里唯一能证明发布件真
的可用的动作，是**拿它算一个数出来并与手算核对**——只编译、只看 servable 标志
都证明不了（docs/MODELING_PLATFORM_DESIGN.md 缺陷 A）。
"""

from dataclasses import replace
from typing import Any

import pytest

from platform_server.apps.modeling.operators import OperatorError
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.publish_service import (
    NodeRecord,
    inspect_run,
)
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
    execution_of,
    linear_frame,
    linear_graph,
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


def test_an_unreadable_serving_format_is_refused() -> None:
    """认不出的版本号当场抛，不猜、不回退到某一版。"""
    with pytest.raises(OperatorError):
        compile_model(
            {"format_version": "9.9", "entry_columns": [], "steps": []}
        )


def _step_of(serving: dict[str, Any], operator: str) -> dict[str, Any]:
    """发布件里某个算子那一步。

    Args: serving, operator。
    """
    for step in serving["steps"]:
        if step["operator"] == operator:
            return dict(step)
    raise AssertionError(f"发布件里没有 {operator} 这一步")

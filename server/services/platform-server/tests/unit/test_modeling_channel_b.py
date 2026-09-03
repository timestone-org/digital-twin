"""通道 B 的发布与推理：模型本体在对象存储里，可服务表示里只有列序。

⚠ 这一组的立论是「一份产物元信息证明不了那些字节还读得回来」：发布那一步必须
真把它取回来、真算一行；取不回来时版本要以**不可服务**落库并写清原因，而不是
上线后每一格都空着（docs/MODELING_PLATFORM_DESIGN.md D9 / D10）。
"""

from datetime import datetime
from typing import Any

import pytest

from platform_server.apps.modeling.operators import OperatorError
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.artifact_store import (
    ArtifactRejected,
    load,
    meta_of,
    model_key,
    run_key,
    seal,
)
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.publish_service import (
    inspect_run,
    model_artifact,
)
from platform_server.apps.modeling.services.run_executor import (
    RunOutcome,
    execute_graph,
)
from platform_server.apps.modeling.services.serving import compile_model
from unit.modeling_fakes import (
    DirectRunner,
    edge,
    execution_of,
    linear_frame,
    linear_graph,
    node,
)

RUN_ID = "0198f0c0-0000-7000-8000-000000000001"
MODEL_NODE = "m"
SAMPLE_TEMPERATURE = 25.0
SAMPLE_LOAD = 430.0


def _tree_graph() -> PipelineGraph:
    """与线性那条同形，只把建模那一步换成树回归。"""
    return PipelineGraph(
        nodes=[
            node(
                "s",
                "ledger_source",
                table_code="energy_h",
                columns=["温度", "负荷", "能耗"],
            ),
            node("f", "fill_missing"),
            node("p", "split_dataset", target_column="能耗"),
            node(MODEL_NODE, "tree_regressor", n_estimators=12),
            node("e", "regression_metrics"),
        ],
        edges=[
            edge("e1", "s", "frame", "f", "frame"),
            edge("e2", "f", "frame", "p", "frame"),
            edge("e3", "p", "train", MODEL_NODE, "train"),
            edge("e4", "p", "test", MODEL_NODE, "test"),
            edge("e5", MODEL_NODE, "scored", "e", "scored"),
        ],
    )


async def _run() -> tuple[PipelineGraph, dict[str, NodeRecord], object]:
    """跑一遍树那条闭环，回图、逐节点记录，以及加载回来的模型本体。"""
    graph = _tree_graph()
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(120)})
    outcome = await execute_graph(graph, execution=execution)
    return graph, _records_of(outcome), _estimator_of(outcome)


def _records_of(outcome: RunOutcome) -> dict[str, NodeRecord]:
    """摆成发布侧读到的形状，产物那一栏按落库时的样子填。

    Args: outcome。
    """
    return {
        item.node_id: NodeRecord(
            preview=dict(item.preview),
            fitted=item.fitted,
            io=dict(item.io),
            artifact=(
                None
                if item.artifact is None
                else meta_of(item.artifact, run_key(RUN_ID, item.node_id))
            ),
        )
        for item in outcome.nodes
    }


def _estimator_of(outcome: RunOutcome) -> object:
    """把封存件按加载路径解回来——测的是那条真路径，不是训练时那个对象。

    Args: outcome。
    """
    for item in outcome.nodes:
        if item.artifact is not None:
            return load(
                item.artifact.payload,
                digest=item.artifact.digest,
                format_version=item.artifact.format_version,
                runtime=item.artifact.runtime,
            )
    raise AssertionError("这次运行没有产出任何二进制产物")


async def test_a_tree_pipeline_publishes_and_really_predicts() -> None:
    """树那条链发布得出来，且拿加载回来的本体真算得出一个数。"""
    graph, records, estimator = await _run()
    verdict = inspect_run(graph, records, estimator)
    assert verdict.is_servable is True, verdict.reason
    got = compile_model(verdict.serving, estimator=estimator).predict(
        [SAMPLE_TEMPERATURE, SAMPLE_LOAD]
    )
    assert isinstance(got, float)


async def test_the_version_says_it_lives_in_the_binary_channel() -> None:
    """版本上记的通道是 binary，产物元信息一并带出来。"""
    graph, records, estimator = await _run()
    verdict = inspect_run(graph, records, estimator)
    assert verdict.channel == "binary"
    assert verdict.artifact["object_key"] == run_key(RUN_ID, MODEL_NODE)


async def test_a_run_without_its_artifact_is_refused() -> None:
    """产物没落下来时拒绝上线，且说清是产物没了而不是别的。

    ⚠ 这一条是「没配对象存储」那条路的守门人：那时候训练照样跑通、`fitted`
    照样有一份列序，唯独产物是空的。
    """
    graph, records, _ = await _run()
    records[MODEL_NODE] = NodeRecord(
        preview=records[MODEL_NODE].preview,
        fitted=records[MODEL_NODE].fitted,
        io=records[MODEL_NODE].io,
        artifact=None,
    )
    verdict = inspect_run(graph, records, None)
    assert verdict.is_servable is False
    assert "二进制产物" in verdict.reason


async def test_a_missing_estimator_is_refused_not_crashed() -> None:
    """产物记着、本体却没装进来时给一句不可服务，不是 500。"""
    graph, records, _ = await _run()
    verdict = inspect_run(graph, records, None)
    assert verdict.is_servable is False
    assert "二进制产物" in verdict.reason


async def test_the_serving_json_carries_no_model_bytes() -> None:
    """可服务表示里只有列序，一个模型参数都没有。

    ⚠ 反过来就是把几十 MB 塞进一列 JSONB：版本列表页要全量读版本表。
    """
    graph, records, estimator = await _run()
    step = _model_step(inspect_run(graph, records, estimator).serving)
    assert list(step["fitted"]) == ["feature_keys"]


async def test_the_artifact_meta_is_found_before_inspection() -> None:
    """发布那一侧能在 `inspect_run` 之前就问出产物在哪。"""
    graph, records, _ = await _run()
    assert model_artifact(graph, records)["object_key"] == run_key(
        RUN_ID, MODEL_NODE
    )


async def test_a_json_channel_pipeline_has_no_artifact() -> None:
    """线性那条链一个字节都不产，`model_artifact` 给空字典。"""
    graph = linear_graph()
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(120)})
    records = _records_of(await execute_graph(graph, execution=execution))
    assert model_artifact(graph, records) == {}


async def test_compiling_without_the_body_says_so() -> None:
    """编译期就拦：这一步要产物而产物没给。

    ⚠ 不拦的表现不是报错，是那一步说自己「还没有拟合结果」——两句话指向的
    修法完全不同。
    """
    graph, records, estimator = await _run()
    serving = inspect_run(graph, records, estimator).serving
    with pytest.raises(OperatorError, match="还没有加载进来"):
        compile_model(serving)


def test_a_tampered_artifact_is_refused() -> None:
    """字节被改过时拒载，不是照读。"""
    sealed = seal([1, 2, 3])
    with pytest.raises(ArtifactRejected, match="摘要"):
        load(
            sealed.payload + b"x",
            digest=sealed.digest,
            format_version=sealed.format_version,
            runtime=sealed.runtime,
        )


def test_the_model_key_is_built_from_the_version_id() -> None:
    """版本自己的键由服务端按版本 id 拼，请求里的字符串进不来。"""
    assert model_key(RUN_ID) == f"modeling/models/{RUN_ID}/model.pkl"


def _model_step(serving: dict[str, Any]) -> dict[str, Any]:
    """可服务表示里建模那一步。

    Args: serving。
    """
    for step in serving["steps"]:
        if step["operator"] == "tree_regressor":
            assert isinstance(step, dict)
            return step
    raise AssertionError("可服务表示里没有建模那一步")


async def test_batch_and_row_by_row_agree() -> None:
    """整批算与逐行算，每一行的数逐个相同。

    ⚠ 这是批量相位唯一的正确性论据：`predict_many` 把整条推理链在一张 n 行的
    帧上跑一遍，而 `predict` 一次跑一行。中间任何一步若依赖「整张帧」（比如
    偷偷重新拟合一次尺度），两者就会分道扬镳——而两边都不报错。
    """
    graph, records, estimator = await _run()
    compiled = compile_model(
        inspect_run(graph, records, estimator).serving, estimator=estimator
    )
    rows: list[tuple[list[float | None], datetime | None]] = [
        ([20.0 + step, 400.0 + step * 3], None) for step in range(12)
    ]
    assert compiled.predict_many(rows) == [
        compiled.predict(args, at) for args, at in rows
    ]


async def test_a_row_with_a_missing_argument_stays_out_of_the_batch() -> None:
    """实参有空的那一行答案是 None，且不把缺失值喂进变换链。"""
    graph, records, estimator = await _run()
    compiled = compile_model(
        inspect_run(graph, records, estimator).serving, estimator=estimator
    )
    answers = compiled.predict_many(
        [([None, 400.0], None), ([20.0, 400.0], None)]
    )
    assert answers[0] is None
    assert answers[1] is not None


async def test_a_binary_model_wants_to_be_batched() -> None:
    """通道 B 如实说「整批算划算」——批量相位靠这一句决定跑不跑。"""
    graph, records, estimator = await _run()
    compiled = compile_model(
        inspect_run(graph, records, estimator).serving, estimator=estimator
    )
    assert compiled.should_batch is True


async def test_a_json_model_does_not_ask_to_be_batched() -> None:
    """通道 A 一行就是几个乘加，为它多跑一趟收集是净亏。"""
    graph = linear_graph()
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(120)})
    records = _records_of(await execute_graph(graph, execution=execution))
    compiled = compile_model(inspect_run(graph, records).serving)
    assert compiled.should_batch is False

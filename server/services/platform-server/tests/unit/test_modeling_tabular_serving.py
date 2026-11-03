"""新增行级变换在真实训练、发布与单行和批量推理间保持一致。"""

from dataclasses import replace

import pytest

from platform_server.apps.modeling.operators import Frame, FrameColumn, registry
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.publish_service import (
    Publishable,
    inspect_run,
)
from platform_server.apps.modeling.services.run_executor import execute_graph
from platform_server.apps.modeling.services.serving import compile_model
from unit.modeling_fakes import (
    DirectRunner,
    edge,
    execution_of,
    linear_frame,
    node,
)


async def published(
    code: str, config: dict[str, object], source: Frame | None = None
) -> Publishable:
    """运行完整图并从节点记录构建发布判定。Args: code, config, source。"""
    graph = PipelineGraph(
        nodes=[
            node("s", "ledger_source", table_code="energy_h"),
            node("t", code, **config),
            node("f", "fill_missing"),
            node("p", "split_dataset", target_column="能耗"),
            node("m", "linear_regression"),
        ],
        edges=[
            edge("st", "s", "frame", "t", "frame"),
            edge("tf", "t", "frame", "f", "frame"),
            edge("fp", "f", "frame", "p", "frame"),
            edge("pm1", "p", "train", "m", "train"),
            edge("pm2", "p", "test", "m", "test"),
        ],
    )
    outcome = await execute_graph(
        graph,
        execution=execution_of(
            DirectRunner(),
            frames={"s": source if source is not None else linear_frame(120)},
        ),
    )
    assert outcome.status == "succeeded", [
        (item.node_id, item.error_text) for item in outcome.nodes
    ]
    records = {
        item.node_id: NodeRecord(
            preview=dict(item.preview), fitted=item.fitted, io=dict(item.io)
        )
        for item in outcome.nodes
    }
    return inspect_run(graph, records)


@pytest.mark.parametrize(
    ("code", "config"),
    [
        (
            "numeric_transform",
            {"method": "affine", "factor": 2.0, "offset": 3.0},
        ),
        (
            "replace_values",
            {"columns": ["温度"], "match": -999.0, "replacement": 0.0},
        ),
        (
            "column_math",
            {"left_column": "温度", "constant": 2.0, "method": "multiply"},
        ),
        ("binning", {"columns": ["温度"], "boundaries": [20.0, 25.0]}),
    ],
)
async def test_scalar_transforms_publish_and_replay_in_single_and_batch(
    code: str, config: dict[str, object]
) -> None:
    verdict = await published(code, config)
    assert verdict.is_servable, verdict.reason
    assert [item["key"] for item in verdict.signature["inputs"]] == [
        "温度",
        "负荷",
    ]
    assert code in [step["operator"] for step in verdict.serving["steps"]]
    model = compile_model(verdict.serving)
    assert model.predict([25.0, 430.0]) == pytest.approx(1345.0)
    assert model.predict_many(
        [([25.0, 430.0], None), ([24.0, 450.0], None)]
    ) == pytest.approx([1345.0, 1403.0])


@pytest.mark.parametrize(
    ("code", "config"),
    [
        ("difference", {"columns": ["温度"]}),
        ("cumulative_stats", {"columns": ["温度"]}),
        ("rank_rows", {"column": "温度"}),
    ],
)
async def test_context_dependent_transforms_are_explicitly_unservable(
    code: str, config: dict[str, object]
) -> None:
    verdict = await published(code, config)
    assert not verdict.is_servable
    assert "历史窗口" in verdict.reason


async def test_text_pipeline_refuses_numeric_input_serving() -> None:
    original = linear_frame(120)
    source = replace(
        original,
        columns=(
            *original.columns,
            FrameColumn(
                key="name", name="名称", dtype="string", role="ignored"
            ),
        ),
        rows=tuple((*row, " A ") for row in original.rows),
    )
    verdict = await published("text_transform", {"columns": ["name"]}, source)
    assert not verdict.is_servable
    assert "文本列" in verdict.reason


@pytest.mark.parametrize(
    "code",
    [
        "numeric_transform",
        "replace_values",
        "difference",
        "cumulative_stats",
        "binning",
        "describe_stats",
        "correlation",
    ],
)
def test_numeric_defaults_exclude_split_target_before_role_assignment(
    code: str,
) -> None:
    source = linear_frame(8)
    operator, _ = registry.build(code, {})
    operator.bind_runtime(
        tz_offset_minutes=480, split_plan={"target_column": "能耗"}
    )
    output = operator.run({"frame": source})["frame"]
    assert isinstance(output, Frame)
    if code in {"describe_stats", "correlation"}:
        assert all("能耗" not in row[:2] for row in output.rows)
    else:
        assert output.values_of("能耗") == source.values_of("能耗")
        assert not any(key.startswith("能耗_") for key in output.keys)

"""发布签名与缺省推理一致，历史格式保留既有结果。"""

import pytest

from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.model_schema import build_schema
from platform_server.apps.modeling.services.publish_service import (
    Publishable,
    inspect_run,
)
from platform_server.apps.modeling.services.run_executor import execute_graph
from platform_server.apps.modeling.services.serving import (
    SERVING_FORMAT_VERSION,
    compile_model,
)
from unit.modeling_fakes import (
    DirectRunner,
    execution_of,
    linear_frame,
    linear_graph,
    node,
)


async def published_with_default() -> Publishable:
    graph = linear_graph()
    graph.nodes[1] = node(
        "f", "fill_missing", strategy="constant", value=7.0, columns=["温度"]
    )
    outcome = await execute_graph(
        graph,
        execution=execution_of(DirectRunner(), frames={"s": linear_frame(120)}),
    )
    records = {
        item.node_id: NodeRecord(
            preview=dict(item.preview), fitted=item.fitted, io=dict(item.io)
        )
        for item in outcome.nodes
    }
    verdict = inspect_run(graph, records)
    assert verdict.is_servable, verdict.reason
    return verdict


async def test_published_optional_input_uses_its_learned_default() -> None:
    verdict = await published_with_default()
    temperature = verdict.signature["inputs"][0]
    assert temperature["is_required"] is False
    assert temperature["default_on_missing"] == 7.0
    compiled = compile_model(verdict.serving)
    assert verdict.serving["format_version"] == "2.1"
    assert compiled.predict([None, 430.0]) == pytest.approx(1309.0)
    assert compiled.predict_many([([None, 430.0], None)]) == pytest.approx(
        [1309.0]
    )


async def test_new_signatures_describe_absent_and_explicit_null_inputs() -> (
    None
):
    signature = (await published_with_default()).signature
    assert signature["inputs"][0]["missing_policy"] == {
        "on_missing": "fitted_default",
        "on_null": "fitted_default",
    }
    assert signature["inputs"][1]["missing_policy"] == {
        "on_missing": "reject",
        "on_null": "return_null",
    }


def test_anomaly_signature_requires_inputs_despite_leading_fill() -> None:
    signature = build_schema(
        entry=[{"key": "电流"}, {"key": "频率"}],
        steps=[
            {"operator": "fill_missing", "fitted": {"电流": 7.0}},
            {"operator": "anomaly_distance", "fitted": {}},
        ],
        target={"key": "anomaly_score"},
        task="anomaly_detection",
    )
    for item in signature["inputs"]:
        assert item["is_required"] is True
        assert item["default_on_missing"] is None
        assert "missing_policy" not in item


@pytest.mark.parametrize("task", ["regression", "classification"])
def test_supervised_signatures_keep_fitted_default_policy(task: str) -> None:
    signature = build_schema(
        entry=[{"key": "电流"}],
        steps=[{"operator": "fill_missing", "fitted": {"电流": 7.0}}],
        target={"key": "目标"},
        task=task,
    )
    item = signature["inputs"][0]
    assert item["is_required"] is False
    assert item["default_on_missing"] == 7.0
    assert item["missing_policy"] == {
        "on_missing": "fitted_default",
        "on_null": "fitted_default",
    }


def test_rule_signature_does_not_describe_predict_missing_policy() -> None:
    signature = build_schema(
        entry=[{"key": "能耗"}],
        steps=[{"operator": "energy_rules", "fitted": {}}],
        target={"key": "results", "dtype": "object"},
        task="rule_calculation",
    )
    assert signature["inputs"][0]["is_required"] is True
    assert signature["inputs"][0]["default_on_missing"] is None
    assert "missing_policy" not in signature["inputs"][0]


@pytest.mark.parametrize("format_version", ["1.0", "2.0"])
async def test_historical_formats_keep_null_results(
    format_version: str,
) -> None:
    serving = (await published_with_default()).serving
    serving["format_version"] = format_version
    serving["input_columns"] = ["温度", "负荷"]
    compiled = compile_model(serving)
    assert compiled.predict([None, 430.0]) is None
    assert compiled.predict([25.0, 430.0]) == pytest.approx(1345.0)
    assert compiled.predict_many(
        [([None, 430.0], None), ([25.0, 430.0], None)]
    ) == [None, pytest.approx(1345.0)]


async def test_uncovered_null_stays_null_and_present_zero_is_preserved() -> (
    None
):
    compiled = compile_model((await published_with_default()).serving)
    assert compiled.predict([7.0, None]) is None
    assert compiled.predict([0.0, 430.0]) == pytest.approx(1295.0)
    assert compiled.predict_many(
        [([7.0, None], None), ([0.0, 430.0], None), ([None, 430.0], None)]
    ) == [None, pytest.approx(1295.0), pytest.approx(1309.0)]
    assert compiled.predict_many([]) == []


async def test_a_later_leading_fill_only_supplies_unfilled_inputs() -> None:
    serving = (await published_with_default()).serving
    later = {
        "operator": "fill_missing",
        "config": {},
        "fitted": {"温度": 9.0, "负荷": 11.0},
        "expected_input_columns": ["温度", "负荷"],
    }
    serving["steps"].insert(1, later)
    signature = build_schema(
        entry=[{"key": "温度"}, {"key": "负荷"}],
        steps=serving["steps"],
        target={"key": "能耗"},
        task="regression",
    )
    assert [item["default_on_missing"] for item in signature["inputs"]] == [
        7.0,
        11.0,
    ]
    compiled = compile_model(serving)
    assert compiled.predict([None, None]) == pytest.approx(52.0)
    assert compiled.predict_many([([None, None], None)]) == pytest.approx(
        [52.0]
    )


async def test_a_fill_after_preprocessing_does_not_supply_an_input() -> None:
    serving = (await published_with_default()).serving
    serving["steps"][:2] = reversed(serving["steps"][:2])
    signature = build_schema(
        entry=[{"key": "温度"}, {"key": "负荷"}],
        steps=serving["steps"],
        target={"key": "能耗"},
        task="regression",
    )
    assert all(item["is_required"] for item in signature["inputs"])
    compiled = compile_model(serving)
    assert compiled.predict([None, 430.0]) is None
    assert compiled.predict_many([([None, 430.0], None)]) == [None]


@pytest.mark.parametrize("invalid_default", [True, "7", None, float("inf")])
def test_invalid_fitted_defaults_never_make_inputs_optional(
    invalid_default: object,
) -> None:
    steps = [{"operator": "fill_missing", "fitted": {"x": invalid_default}}]
    signature = build_schema(
        entry=[{"key": "x"}], steps=steps, target={}, task="regression"
    )
    assert signature["inputs"][0]["is_required"] is True
    compiled = compile_model(
        {
            "format_version": SERVING_FORMAT_VERSION,
            "entry_columns": [{"key": "x"}],
            "steps": steps,
        }
    )
    assert compiled.predict([None]) is None
    assert compiled.predict_many([([None], None)]) == [None]

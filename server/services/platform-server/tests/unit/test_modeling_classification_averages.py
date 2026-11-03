"""多分类汇总与未定义项保持显式语义，旧指定类口径不变。"""

import json

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    MetricsPayload,
    registry,
)


def scored_frame() -> Frame:
    return Frame(
        columns=(
            FrameColumn(key="y_true", name="真实", dtype="number"),
            FrameColumn(key="y_pred", name="预测", dtype="number"),
        ),
        rows=(
            (0.0, 0.0),
            (0.0, 0.0),
            (0.0, 1.0),
            (1.0, 1.0),
            (1.0, 2.0),
            (2.0, 2.0),
        ),
    )


@pytest.mark.parametrize(
    ("average", "precision", "recall", "f1"),
    [("macro", 2 / 3, 13 / 18, 59 / 90), ("weighted", 3 / 4, 2 / 3, 61 / 90)],
)
def test_multiclass_averages_match_hand_calculated_counts(
    average: str, precision: float, recall: float, f1: float
) -> None:
    operator, _ = registry.build("classification_metrics", {"average": average})
    payload = operator.run({"scored": scored_frame()})["metrics"]
    assert isinstance(payload, MetricsPayload)
    assert payload.metrics["accuracy"] == pytest.approx(2 / 3)
    assert payload.metrics["precision"] == pytest.approx(precision)
    assert payload.metrics["recall"] == pytest.approx(recall)
    assert payload.metrics["f1"] == pytest.approx(f1)
    assert payload.metrics["f1_macro"] == pytest.approx(59 / 90)
    assert payload.metrics["f1_weighted"] == pytest.approx(61 / 90)
    assert (
        "平均" in payload.positive_label_text
        or "加权" in payload.positive_label_text
    )


def test_default_classification_keeps_existing_one_vs_rest_result_shape() -> (
    None
):
    operator, _ = registry.build("classification_metrics", {})
    payload = operator.run({"scored": scored_frame()})["metrics"]
    assert isinstance(payload, MetricsPayload)
    assert payload.metrics == {
        "accuracy": 2 / 3,
        "precision": 0.5,
        "recall": 0.5,
        "f1": 0.5,
    }


def test_macro_precision_excludes_undefined_class_but_f1_zero_is_defined() -> (
    None
):
    operator, _ = registry.build("classification_metrics", {"average": "macro"})
    frame = Frame(columns=scored_frame().columns, rows=((0.0, 0.0), (1.0, 0.0)))
    payload = operator.run({"scored": frame})["metrics"]
    assert isinstance(payload, MetricsPayload)
    assert payload.metrics["precision"] == pytest.approx(0.5)
    assert payload.metrics["recall"] == pytest.approx(0.5)
    assert payload.metrics["f1"] == pytest.approx(1 / 3)


@pytest.mark.parametrize("average", ["macro", "weighted"])
def test_aggregate_report_does_not_mislabel_average_as_an_absent_class(
    average: str,
) -> None:
    operator, _ = registry.build("classification_metrics", {"average": average})
    operator.run({"scored": scored_frame()})
    text = json.dumps(
        [block.payload for block in operator.report()], ensure_ascii=False
    )
    assert "一次都没出现过" not in text
    assert "不对应单一正类" in text

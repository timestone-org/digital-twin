"""正常工况校准、组合异常、空输入和参数封存边界。"""

from dataclasses import replace
from typing import Any

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    ModelPayload,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.anomaly_stats import (
    DistanceProfile,
    score_row,
)
from platform_server.apps.modeling.operators.frame import select_rows
from unit.anomaly_fakes import normal_frame, training_pair


def trained():
    operator, _ = registry.build("anomaly_distance", {})
    operator.run(training_pair())
    return operator


def probe(*rows: tuple[float | None, ...]) -> Frame:
    return Frame(columns=normal_frame().columns, rows=rows)


def test_joint_distance_flags_combination_anomaly_within_marginal_ranges() -> (
    None
):
    operator = trained()
    normal, current, temperature, combination = operator.predict_rows(
        probe((33.65, 40, 71), (70, 40, 71), (33.65, 40, 150), (37, 33, 68))
    )
    assert 0 <= normal < 1
    assert all(score > 1 for score in (current, temperature, combination))
    for column, value in enumerate((37, 33, 68)):
        values = [row[column] for row in normal_frame().rows]
        assert min(values) <= value <= max(values)


def test_json_parameters_round_trip_and_batch_order_is_stable() -> None:
    operator = trained()
    payload = operator.dump_fitted()
    assert payload is not None
    registry.get("anomaly_distance").validate_fitted(payload)
    restored, _ = registry.build("anomaly_distance", {})
    restored.load_fitted(payload)
    cases = probe((33.65, 40, 71), (37, 33, 68))
    assert restored.predict_rows(cases) == pytest.approx(
        operator.predict_rows(cases)
    )
    assert set(payload["center"]) == {"电流", "频率", "温度"}


def test_test_data_never_changes_fitted_parameters_or_calibration() -> None:
    pair = training_pair()
    first, _ = registry.build("anomaly_distance", {})
    first.run(pair)
    pair["test"] = replace(
        pair["test"], rows=tuple((70.0, 60.0, 150.0) for _ in pair["test"].rows)
    )
    second, _ = registry.build("anomaly_distance", {})
    result = second.run(pair)
    assert first.dump_fitted() == second.dump_fitted()
    payload = result["model"]
    assert isinstance(payload, ModelPayload)
    assert payload.target_key is None
    assert payload.task == "anomaly_detection"


def test_untrained_detector_cannot_predict_or_claim_a_report() -> None:
    operator, _ = registry.build("anomaly_distance", {})
    assert operator.report() == ()
    assert operator.dump_fitted() == {}
    with pytest.raises(OperatorError, match="尚未训练"):
        operator.predict_rows(probe((33.65, 40, 71)))


@pytest.mark.parametrize("value", [None, float("nan"), float("inf"), 1e101])
def test_bad_sensor_values_are_never_a_normal_score(
    value: float | None,
) -> None:
    with pytest.raises(OperatorError):
        trained().predict_rows(probe((value, 40, 71)))


def test_constant_features_still_detect_a_change() -> None:
    source = normal_frame(100)
    flat = replace(
        source,
        columns=(FrameColumn(key="频率", name="频率", dtype="number"),),
        rows=tuple((50.0,) for _ in source.rows),
    )
    operator, _ = registry.build("anomaly_distance", {})
    operator.run(
        {
            "train": select_rows(flat, list(range(80))),
            "test": select_rows(flat, list(range(80, 100))),
        }
    )
    assert operator.predict_rows(
        replace(flat, rows=((50.0,), (51.0,)), index=None)
    ) == pytest.approx([0.0, 200000.0])


@pytest.mark.parametrize(
    "config", [{"quantile": 0.9}, {"shrinkage": 0}, {"scale_floor": 0}]
)
def test_invalid_detector_parameters_are_rejected(
    config: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        registry.build("anomaly_distance", config)


@pytest.mark.parametrize(
    "kind",
    ["few", "overlap", "empty", "missing_time", "unsorted", "role", "columns"],
)
def test_invalid_training_layout_is_rejected(kind: str) -> None:
    pair = training_pair()
    train = pair["train"]
    if kind == "few":
        train = select_rows(train, list(range(79)))
    if kind == "overlap":
        pair["test"] = train
    if kind == "empty":
        train = replace(train, rows=(), index=())
    if kind == "missing_time":
        train = replace(train, index=None)
    if kind == "unsorted":
        train = replace(train, index=tuple(reversed(train.index or ())))
    if kind == "role":
        train = replace(
            train,
            columns=tuple(
                replace(column, role="target") for column in train.columns
            ),
        )
    if kind == "columns":
        pair["test"] = replace(
            pair["test"], columns=tuple(reversed(train.columns))
        )
    pair["train"] = train
    with pytest.raises(OperatorError):
        registry.build("anomaly_distance", {})[0].run(pair)


@pytest.mark.parametrize(
    "kind",
    [
        "missing",
        "scale",
        "nan",
        "asymmetry",
        "indefinite",
        "duplicate",
        "incomplete",
    ],
)
def test_corrupted_parameters_fail_closed(kind: str) -> None:
    data: dict[str, Any] = dict(trained().dump_fitted() or {})
    if kind == "missing":
        data["center"] = {}
    if kind == "scale":
        data["scale"]["电流"] = 0
    if kind == "nan":
        data["distance_threshold"] = float("nan")
    if kind == "asymmetry":
        data["precision"]["电流"]["频率"] = 123
    if kind == "indefinite":
        data["precision"]["电流"]["电流"] = -1
    if kind == "incomplete":
        data["precision"]["电流"] = {}
    if kind == "duplicate":
        data["feature_keys"] = ["电流", "电流", "温度"]
    with pytest.raises(OperatorError, match="参数"):
        registry.build("anomaly_distance", {})[0].load_fitted(data)


def test_exact_threshold_is_not_an_anomaly() -> None:
    profile = DistanceProfile(
        feature_keys=("x",),
        center={"x": 0},
        scale={"x": 1},
        precision={"x": {"x": 1}},
        distance_threshold=4,
    )
    assert score_row(profile, [2]) == 1
    assert score_row(profile, [2.1]) > 1
    with pytest.raises(OperatorError):
        score_row(profile, [])
    with pytest.raises(OperatorError):
        score_row(profile, [1e200])


def test_split_has_no_target_and_preserves_chronological_holdout() -> None:
    operator, _ = registry.build("split_samples", {})
    result = operator.run({"frame": normal_frame(100)})
    assert result["train"].row_count == 80
    assert result["test"].row_count == 20
    assert result["train"].index[-1] < result["test"].index[0]
    assert all(column.role == "feature" for column in result["train"].columns)


def test_split_refuses_an_insufficient_holdout() -> None:
    with pytest.raises(OperatorError, match="不足"):
        registry.build("split_samples", {})[0].run({"frame": normal_frame(90)})


def test_feature_count_is_bounded() -> None:
    pair = training_pair()
    for port, frame in pair.items():
        pair[port] = replace(
            frame,
            columns=tuple(
                FrameColumn(
                    key=f"sensor_{seat}", name=str(seat), dtype="number"
                )
                for seat in range(17)
            ),
            rows=tuple(tuple(1.0 for _ in range(17)) for _ in frame.rows),
        )
    with pytest.raises(OperatorError, match="16"):
        registry.build("anomaly_distance", {})[0].run(pair)


def test_anomaly_report_items_have_readable_names() -> None:
    step = trained().report()[0]
    assert [item.get("name") for item in step.payload["items"]] == [
        "未判异常",
        "判为异常",
    ]


def test_anomaly_counts_use_a_renderable_categorical_chart() -> None:
    chart = trained().report()[1]
    assert chart.kind == "breakdown"
    assert chart.tier == 1
    assert chart.payload["is_primary"] is True
    assert [item.get("name") for item in chart.payload["items"]] == [
        "未判异常",
        "判为异常",
    ]

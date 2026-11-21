"""时间特征在推理时沿用训练时的业务时区，而不是按 UTC 算。

⚠ 按 UTC 算出来的小时也在 0-23 之间，预测照样出数，看不出错。
"""

from datetime import UTC, datetime
from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
)
from platform_server.apps.modeling.services.serving import (
    _apply,
    _Step,
    compile_model,
    has_legacy_utc_time_features,
    serving_format_for_steps,
)
from unit.test_modeling_tabular_serving import published

# UTC 01:00 在东八区是 09:00
MONDAY_UTC_MS = int(datetime(2026, 1, 5, 1, 0, tzinfo=UTC).timestamp() * 1000)


def _one_row() -> Frame:
    """一行温度，带时刻。"""
    return Frame(
        columns=(FrameColumn(key="温度", name="温度", dtype="number"),),
        rows=((25.0,),),
        index=(MONDAY_UTC_MS,),
    )


def _hour_after(fitted: dict[str, object]) -> object:
    """按一份落库的时间特征步骤推理一行，取造出的小时。

    Args: fitted。
    """
    step = _Step(
        operator="time_feature",
        config={"parts": ["hour"]},
        fitted=dict(fitted),
        expected=(),
    )
    return _apply(step, _one_row(), None).values_of("ts_hour")[0]


async def test_publish_freezes_the_business_offset_into_the_step() -> None:
    verdict = await published("time_feature", {"parts": ["hour"]})
    assert verdict.is_servable, verdict.reason
    assert verdict.serving["format_version"] == "2.1"
    step = next(
        item
        for item in verdict.serving["steps"]
        if item["operator"] == "time_feature"
    )
    assert step["fitted"] == {"tz_offset_minutes": 480}


def test_serving_uses_the_frozen_offset() -> None:
    assert _hour_after({"tz_offset_minutes": 480}) == 9.0


def test_versions_without_a_frozen_offset_keep_their_old_output() -> None:
    assert _hour_after({}) == 1.0


TRANSITIONS = (
    "2026-03-08T06:30+00:00",
    "2026-03-08T07:30+00:00",
    "2026-11-01T05:30+00:00",
    "2026-11-01T06:30+00:00",
    "2026-11-01T07:30+00:00",
)


def _hour_model(version: str, fitted: dict[str, object]) -> dict[str, Any]:
    return {
        "format_version": version,
        "task": "regression",
        "input_columns": ["x"],
        "entry_columns": [{"key": "x"}],
        "steps": [
            {
                "operator": "time_feature",
                "config": {"parts": ["hour"]},
                "fitted": fitted,
                "expected_input_columns": ["x"],
            },
            {
                "operator": "linear_regression",
                "config": {},
                "fitted": {"coef": {"ts_hour": 1.0}, "intercept": 0.0},
                "expected_input_columns": ["x", "ts_hour"],
            },
        ],
    }


@pytest.mark.parametrize(
    ("version", "fitted", "expected"),
    [
        ("1.0", {}, [6.0, 7.0, 5.0, 6.0, 7.0]),
        ("2.0", {"tz_offset_minutes": -300}, [1.0, 2.0, 0.0, 1.0, 2.0]),
        ("2.1", {"tz_offset_minutes": -300}, [1.0, 2.0, 0.0, 1.0, 2.0]),
        ("2.2", {"timezone": "America/New_York"}, [1.0, 3.0, 1.0, 1.0, 2.0]),
        ("2.2", {"timezone": "UTC"}, [6.0, 7.0, 5.0, 6.0, 7.0]),
    ],
)
def test_model_uses_the_time_rule_frozen_in_its_version(
    version: str, fitted: dict[str, object], expected: list[float]
) -> None:
    serving = _hour_model(version, fitted)
    model = compile_model(serving)
    rows = [([1.0], datetime.fromisoformat(value)) for value in TRANSITIONS]
    assert model.predict_many(rows) == expected
    assert has_legacy_utc_time_features(serving) == (not fitted)


def test_unknown_named_timezone_does_not_silently_predict_in_utc() -> None:
    serving = _hour_model("2.2", {"timezone": "Unknown/Fixture"})
    model = compile_model(serving)
    with pytest.raises(OperatorError, match="业务时区"):
        model.predict([1.0], datetime.fromisoformat(TRANSITIONS[0]))


def test_named_timezone_format_requires_a_frozen_zone() -> None:
    with pytest.raises(OperatorError, match="业务时区"):
        compile_model(_hour_model("2.2", {}))


def test_publish_format_follows_frozen_timezone() -> None:
    assert (
        serving_format_for_steps(
            _hour_model("2.1", {"timezone": "America/New_York"})["steps"]
        )
        == "2.2"
    )
    assert (
        serving_format_for_steps(
            _hour_model("2.1", {"tz_offset_minutes": -300})["steps"]
        )
        == "2.1"
    )

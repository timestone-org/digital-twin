"""模型预测输入保持数值类型，并显式携带时区。"""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.errors import PredictRequestInvalid
from platform_server.apps.modeling.schemas import OpenModelPredictIn
from platform_server.apps.modeling.services.open_model_service import (
    _as_number,
    _row_moment,
)


@pytest.mark.parametrize("is_value", [True, False])
def test_prediction_input_rejects_boolean_values(is_value: bool) -> None:
    with pytest.raises(ValidationError):
        OpenModelPredictIn.model_validate({"rows": [{"temperature": is_value}]})


@pytest.mark.parametrize("value", [0, 25, 25.5, None])
def test_prediction_input_preserves_numeric_and_null_values(
    value: int | float | None,
) -> None:
    payload = OpenModelPredictIn.model_validate(
        {"rows": [{"temperature": value}]}
    )
    assert payload.rows[0]["temperature"] == value


def test_prediction_does_not_coerce_a_numeric_string() -> None:
    payload = OpenModelPredictIn.model_validate(
        {"rows": [{"temperature": "25.5"}]}
    )
    with pytest.raises(PredictRequestInvalid):
        _as_number(payload.rows[0]["temperature"], "temperature", 0)


@pytest.mark.parametrize(
    "value",
    [
        "2026-11-04",
        "2026-11-04T00:00:00",
        "not-a-time",
        1793721600000,
    ],
)
def test_prediction_timestamp_rejects_missing_timezone(
    value: str | int,
) -> None:
    with pytest.raises(PredictRequestInvalid):
        _row_moment({"__ts__": value}, 0)


@pytest.mark.parametrize(
    "value", ["2026-11-04T00:00:00Z", "2026-11-04T08:00:00+08:00"]
)
def test_prediction_timestamp_normalizes_explicit_offsets(value: str) -> None:
    assert _row_moment({"__ts__": value}, 0) == datetime(
        2026, 11, 4, tzinfo=UTC
    )


def test_prediction_without_a_timestamp_preserves_missing_value() -> None:
    assert _row_moment({}, 0) is None
    assert _row_moment({"__ts__": None}, 0) is None

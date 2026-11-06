"""模型预测输入保持数值类型，并显式携带时区。"""

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast

import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.errors import PredictRequestInvalid
from platform_server.apps.modeling.models import (
    ModelingDeployment,
    ModelVersion,
)
from platform_server.apps.modeling.schemas import OpenModelPredictIn
from platform_server.apps.modeling.services import open_model_service
from platform_server.apps.modeling.services.open_model_service import (
    OpenModelDeps,
    ResolvedCall,
    _as_number,
    _row_moment,
    predict_and_record,
)

BAD_REQUEST = 400


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
    "value", [float("inf"), float("-inf"), float("nan"), 10**400]
)
def test_prediction_rejects_a_number_that_is_not_finite(
    value: float | int,
) -> None:
    payload = OpenModelPredictIn.model_validate({"rows": [{"x": value}]})
    with pytest.raises(PredictRequestInvalid):
        _as_number(payload.rows[0]["x"], "x", 0)


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


class OverflowingModel:
    """有限输入算出非有限结果的模型。"""

    def __init__(self, answers: list[float | None]) -> None:
        self._answers = answers

    def predict_many(self, _rows: object) -> list[float | None]:
        """回预设的结果。Args: _rows。"""
        return self._answers


def resolved_call() -> ResolvedCall:
    version = SimpleNamespace(
        task="regression",
        version=1,
        signature_json={"inputs": [{"key": "x", "is_required": True}]},
    )
    deployment = SimpleNamespace(
        id=uuid.uuid4(), code="model", max_rows_per_call=10
    )
    return ResolvedCall(
        deployment=cast("ModelingDeployment", deployment),
        version=cast("ModelVersion", version),
        user_id=uuid.uuid4(),
    )


@pytest.mark.parametrize("answer", [float("inf"), float("-inf"), float("nan")])
async def test_a_result_that_is_not_finite_is_a_recorded_failure(
    monkeypatch: pytest.MonkeyPatch, answer: float
) -> None:
    """有限输入溢出成 inf：拒绝并记 400，不能记成一次成功。"""
    recorded: list[int] = []

    async def compiled(*_args: object) -> OverflowingModel:
        return OverflowingModel([1.0, answer])

    async def record(
        _deps: object,
        _resolved: object,
        _started: float,
        status: int,
        *_: object,
    ) -> None:
        recorded.append(status)

    monkeypatch.setattr(open_model_service, "_compiled", compiled)
    monkeypatch.setattr(open_model_service, "record_call", record)
    with pytest.raises(PredictRequestInvalid, match="第 2 行"):
        await predict_and_record(
            cast("AsyncSession", object()),
            deps=cast("OpenModelDeps", object()),
            resolved=resolved_call(),
            payload=OpenModelPredictIn.model_validate(
                {"rows": [{"x": 1.0}, {"x": 1e308}]}
            ),
        )
    assert recorded == [BAD_REQUEST]


async def test_a_blank_result_is_still_an_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """算不出的行回 null 是约定，不是溢出。"""

    async def compiled(*_args: object) -> OverflowingModel:
        return OverflowingModel([None, 2.5])

    monkeypatch.setattr(open_model_service, "_compiled", compiled)
    monkeypatch.setattr(open_model_service, "_warnings_of", lambda *_: [])
    answer = await open_model_service.predict(
        cast("AsyncSession", object()),
        deps=cast("OpenModelDeps", object()),
        resolved=resolved_call(),
        payload=OpenModelPredictIn.model_validate(
            {"rows": [{"x": 1.0}, {"x": 2.0}]}
        ),
    )
    assert answer.predictions == [None, 2.5]

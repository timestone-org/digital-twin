"""入参时刻必须带时区：裸时刻会被当成服务端本地时间，或在比较时炸成 500。"""

import pytest
from pydantic import ValidationError

from platform_server.apps.hvac.schemas import (
    PredictIn,
    RecommendIn,
    StartupRebuildIn,
)

NAIVE = "2026-01-31T08:00:00"
AWARE = "2026-01-31T08:00:00Z"


def test_a_predict_moment_without_a_timezone_is_rejected() -> None:
    with pytest.raises(ValidationError):
        PredictIn.model_validate({"running_set": ["K11"], "at": NAIVE})
    accepted = PredictIn.model_validate({"running_set": ["K11"], "at": AWARE})
    assert accepted.at is not None
    assert accepted.at.tzinfo is not None


def test_a_recommend_moment_without_a_timezone_is_rejected() -> None:
    with pytest.raises(ValidationError):
        RecommendIn.model_validate({"at": NAIVE})
    assert RecommendIn.model_validate({"at": AWARE}).at is not None


@pytest.mark.parametrize("field", ["window_start", "window_end"])
def test_a_rebuild_bound_without_a_timezone_is_rejected(field: str) -> None:
    with pytest.raises(ValidationError):
        StartupRebuildIn.model_validate({field: NAIVE})
    assert StartupRebuildIn.model_validate({field: AWARE}) is not None

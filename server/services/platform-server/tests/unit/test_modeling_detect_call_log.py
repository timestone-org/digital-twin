"""异常检测的调用记录与真实结果一致：自己的校验失败要记，判不出来不记成成功。"""

import uuid
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.errors import (
    DeploymentUnservable,
    PredictRequestInvalid,
)
from platform_server.apps.modeling.operators.anomaly import TASK_ANOMALY
from platform_server.apps.modeling.schemas.detection import OpenModelDetectIn
from platform_server.apps.modeling.services import detection
from platform_server.apps.modeling.services.open_model_service import (
    OpenModelDeps,
    ResolvedCall,
)


def _resolved(task: str) -> ResolvedCall:
    """Args: task。"""
    version = SimpleNamespace(
        task=task, signature_json={"inputs": [{"key": "温度"}]}, version=1
    )
    return ResolvedCall(
        deployment=cast("Any", SimpleNamespace(id=uuid.uuid4(), code="d")),
        version=cast("Any", version),
        user_id=uuid.uuid4(),
    )


@pytest.fixture
def recorded(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """记下每一条调用记录的状态码。"""
    statuses: list[int] = []

    async def record(
        deps: Any, resolved: Any, started: float, status: int, code: Any
    ) -> None:
        del deps, resolved, started, code
        statuses.append(status)

    monkeypatch.setattr(detection.open_model_service, "record_call", record)
    return statuses


async def _detect(resolved: ResolvedCall, value: object) -> None:
    """Args: resolved, value。"""
    await detection.detect(
        cast("AsyncSession", object()),
        deps=cast("OpenModelDeps", object()),
        resolved=resolved,
        payload=OpenModelDetectIn.model_validate({"rows": [{"温度": value}]}),
    )


async def test_a_rejected_row_is_recorded(recorded: list[int]) -> None:
    with pytest.raises(PredictRequestInvalid):
        await _detect(_resolved(TASK_ANOMALY), "热")
    assert recorded == [400]


async def test_a_missing_score_is_not_recorded_as_success(
    recorded: list[int], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def predicted(*args: Any, **kwargs: Any) -> object:
        del args, kwargs
        return SimpleNamespace(model=None, predictions=[None], warnings=[])

    monkeypatch.setattr(detection.open_model_service, "predict", predicted)
    with pytest.raises(DeploymentUnservable):
        await _detect(_resolved(TASK_ANOMALY), 1.0)
    assert recorded == [410]

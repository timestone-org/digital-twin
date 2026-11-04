"""旧部署回执补齐调用地址，保留首次任务和已有字段。"""

import pytest
from pydantic import JsonValue
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.protocols import ModelTask
from platform_server.apps.modeling.schemas import ModelDeploymentOut
from platform_server.apps.modeling.services.task_replay import payload_with_task


def _receipt(task: ModelTask) -> dict[str, JsonValue]:
    return {
        "id": "01900000-0000-7000-8000-000000000001",
        "code": "original-service",
        "model_version_id": "01900000-0000-7000-8000-000000000002",
        "model_name": "首次模型",
        "model_version": 1,
        "task": task,
        "name": "首次部署",
        "description": None,
        "is_enabled": True,
        "is_servable": True,
        "unservable_reason": None,
        "max_rows_per_call": 200,
        "rate_limit_per_minute": 60,
        "key_count": 0,
        "created_by_name": None,
        "created_at": "2026-10-30T00:00:00Z",
        "updated_at": "2026-10-30T00:00:00Z",
    }


@pytest.mark.parametrize(
    ("task", "action"),
    [
        ("regression", "predict"),
        ("classification", "predict"),
        ("anomaly_detection", "detect"),
        ("rule_calculation", "calculate"),
    ],
)
async def test_deployment_receipt_urls_follow_its_frozen_task(
    task: ModelTask, action: str
) -> None:
    receipt = _receipt(task)
    async with AsyncSession() as session:
        payload = await payload_with_task(session, ModelDeploymentOut, receipt)
    result = ModelDeploymentOut.model_validate(payload)
    assert result.signature_url == (
        "/api/v1/platform/open-models/original-service"
    )
    assert result.invoke_url == (
        f"/api/v1/platform/open-models/original-service:{action}"
    )
    assert result.task == task
    assert result.model_version == 1
    assert "invoke_url" not in receipt
    assert "signature_url" not in receipt


@pytest.mark.parametrize("existing_field", ["invoke_url", "signature_url"])
async def test_deployment_receipt_preserves_saved_urls(
    existing_field: str,
) -> None:
    receipt = _receipt("regression")
    receipt[existing_field] = "/saved-original-path"
    async with AsyncSession() as session:
        payload = await payload_with_task(session, ModelDeploymentOut, receipt)
    assert payload[existing_field] == "/saved-original-path"
    assert payload["invoke_url"]
    assert payload["signature_url"]

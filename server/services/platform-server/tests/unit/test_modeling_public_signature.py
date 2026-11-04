"""对外签名提供任务、调用地址和输入参数，并保留冻结版本语义。"""

import pytest

from platform_server.apps.modeling.models import ModelingModelVersion
from platform_server.apps.modeling.services.open_model_service import (
    public_signature,
)


@pytest.mark.parametrize(
    ("task", "action"),
    [
        ("regression", "predict"),
        ("classification", "predict"),
        ("anomaly_detection", "detect"),
        ("rule_calculation", "calculate"),
    ],
)
def test_public_signature_identifies_task_and_strips_training_stats(
    task: str, action: str
) -> None:
    version = ModelingModelVersion(
        task=task,
        signature_json={
            "format_version": "1.0",
            "requires_timestamp": True,
            "inputs": [
                {
                    "key": "temperature",
                    "label": "温度",
                    "unit": "℃",
                    "dtype": "number",
                    "is_required": False,
                    "default_on_missing": 0.0,
                    "missing_policy": {
                        "on_missing": "fitted_default",
                        "on_null": "fitted_default",
                    },
                    "training_stats": {"min": 10, "max": 30},
                }
            ],
            "derived": [],
            "output": {"task": task, "key": "target", "dtype": "number"},
        },
    )
    result = public_signature(version, code="temperature-model")
    data = result.model_dump(exclude_unset=True)
    assert data["task"] == task
    assert data["invoke_url"] == (
        f"/api/v1/platform/open-models/temperature-model:{action}"
    )
    assert data["timestamp_key"] == "__ts__"
    assert result.inputs[0].default_on_missing == 0.0
    assert result.inputs[0].missing_policy is not None
    assert "training_stats" not in str(data)
    assert "training_stats" in version.signature_json["inputs"][0]


def test_legacy_signature_keeps_missing_policies_absent() -> None:
    version = ModelingModelVersion(
        task="regression",
        signature_json={
            "inputs": [{"key": "x", "is_required": False}],
            "output": {"task": "regression"},
        },
    )
    data = public_signature(version, code="legacy").model_dump(
        exclude_unset=True
    )
    assert "missing_policy" not in data["inputs"][0]
    assert "default_on_missing" not in data["inputs"][0]
    assert data["timestamp_key"] is None


def test_empty_legacy_signature_still_exposes_the_pinned_task() -> None:
    version = ModelingModelVersion(task="classification", signature_json={})
    result = public_signature(version, code="legacy")
    assert result.task == "classification"
    assert result.output.task == "classification"
    assert result.inputs == []
